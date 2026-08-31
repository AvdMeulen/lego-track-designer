import { FloorPlan } from '../../shared/models/floor-plan';
import { CITY_TRACKS_BY_ID } from '../catalog/city-tracks';
import { placementHitsRoom, seedInsideFloor } from '../floor-plan/space';
import { analyzeLayout, preferenceNotes } from '../layout-analysis/analyze';
import {
  DEFAULT_PREFERENCES,
  GenerationPreferences,
  PlacedPart,
  TrackLayout,
} from '../../shared/models/track';
import { remainingInventory, unusedItems, openPorts } from './connections';
import { closeOpenHeads, exploreSpace } from './explore';
import { addInnerLoops, tracePerimeter } from './perimeter';
import { approachThenFlex, closeWithFlex } from './flex-closer';
import { applyCrossover, applyRouteFeatures, placeParking, placeRemainingSpecials } from './features';
import { GenContext, inventoryMap, rng } from './place';
import { layoutIsValid, scoreLayout } from './score';
import { planTopology } from './topology';
import { growStockTree } from './tree';
import {
  curveCircle,
  inflateLoop,
  loopCloses,
  organicRing,
  pointToPoint,
  wanderHomeLoop,
} from './wander';

export type GeneratePhase =
  | 'core'
  | 'guides'
  | 'paths'
  | 'switches'
  | 'join'
  | 'crossover'
  | 'routes'
  | 'inflate'
  | 'parking'
  | 'keerlus'
  | 'candidate'
  | 'done';

export interface GeneratePhaseSnapshot {
  phase: GeneratePhase;
  attempt: number;
  layout: TrackLayout;
}

export interface GenerateOptions {
  seed?: number;
  timeoutMs?: number;
  previous?: PlacedPart[];
  floorPlan?: FloorPlan | null;
  onPhase?: (snapshot: GeneratePhaseSnapshot) => void | Promise<void>;
}

interface GenerateStep {
  phase: GeneratePhase;
  attempt: number;
  parts?: PlacedPart[];
  layout?: TrackLayout;
}

function finalize(
  parts: PlacedPart[],
  inventory: Record<string, number>,
  prefs: GenerationPreferences,
  message?: string,
  floorPlan?: FloorPlan | null,
): TrackLayout {
  const catalog = CITY_TRACKS_BY_ID;
  const allowFlex = (inventory['curve-22'] ?? 0) !== 15;
  let ready = parts;
  const leftover = remainingInventory(inventory, parts);
  if (allowFlex && (leftover['flex-track'] ?? 0) > 0) {
    const opens = openPorts(parts, catalog);
    if (opens.length === 2) {
      ready =
        approachThenFlex(parts, opens[0], opens[1], inventory, {
          catalog,
          random: () => 0.5,
          deadline: Date.now() + 800,
          seq: 9000,
          floorPlan,
        }) ?? parts;
    }
  }
  const withFlex = closeWithFlex(ready, catalog, remainingInventory(inventory, ready), allowFlex, floorPlan);
  const labeled = withFlex.map((part, index) => ({ ...part, label: index + 1 }));
  const layout = analyzeLayout(labeled, catalog, unusedItems(inventory, labeled), message, prefs);
  layout.notes = preferenceNotes(layout, prefs, inventory);
  if (layout.notes.length) {
    layout.message = layout.notes.join(' ');
  }
  layout.score.total = scoreLayout(layout, prefs);
  return layout;
}

function reserveForFeatures(
  inventory: Record<string, number>,
  plan: { dualRoutes: number; keerlussen: number; crossovers: number; crossings: number; parking: number },
): Record<string, number> {
  const totalCurves = inventory['curve-22'] ?? 0;
  const reservedCurves = Math.min(
    totalCurves,
    plan.dualRoutes * 6 + plan.keerlussen * 16 + plan.crossovers * 16 + plan.crossings * 8,
  );
  const straights = inventory['straight-16'] ?? 0;
  const reservedPark = Math.min(plan.parking * 6, Math.max(0, straights - 8));
  const extraLoops = plan.dualRoutes + plan.keerlussen + plan.crossovers + plan.crossings;
  const reservedJoin = extraLoops > 0 ? Math.min(4 * extraLoops, Math.max(0, straights - reservedPark - 8)) : 0;
  return {
    ...inventory,
    'curve-22': Math.max(0, totalCurves - reservedCurves),
    'straight-16': Math.max(0, straights - reservedPark - reservedJoin),
    'switch-left': 0,
    'switch-right': 0,
    'double-crossover': 0,
    'crossing-90': 0,
    'flex-track': 0,
  };
}

function fitsRoom(parts: PlacedPart[], ctx: GenContext): boolean {
  if (!ctx.floorPlan) {
    return true;
  }
  return parts.every((part) => !placementHitsRoom(part, ctx.catalog, ctx.floorPlan!));
}

function buildCore(inventory: Record<string, number>, ctx: GenContext, preferWander: boolean): PlacedPart[] {
  const curves = inventory['curve-22'] ?? 0;
  const straights = inventory['straight-16'] ?? 0;
  const total = straights + curves;
  if (ctx.floorPlan) {
    const wanderMs = total > 80 ? 850 : 650;
    const wanderCtx: GenContext = {
      ...ctx,
      deadline: Math.min(ctx.deadline - 1000, Date.now() + wanderMs),
    };
    const wandered = wanderHomeLoop(inventory, wanderCtx);
    if (wandered && loopCloses(wandered, ctx.catalog) && fitsRoom(wandered, ctx)) {
      return wandered;
    }
    const line = pointToPoint(inventory, ctx);
    return fitsRoom(line, ctx) ? line : [];
  }
  if (curves >= 16) {
    const wanderMs = total > 80 ? 850 : 650;
    const wanderCtx: GenContext = {
      ...ctx,
      deadline: Math.min(ctx.deadline - 1000, Date.now() + wanderMs),
    };
    if (preferWander || total > 40) {
      const wandered = wanderHomeLoop(inventory, wanderCtx);
      if (wandered && loopCloses(wandered, ctx.catalog) && fitsRoom(wandered, ctx)) {
        return wandered;
      }
    }
    const ring = organicRing(inventory, ctx);
    if (ring && loopCloses(ring, ctx.catalog) && fitsRoom(ring, ctx)) {
      return ring;
    }
    if (Date.now() < wanderCtx.deadline) {
      const wandered = wanderHomeLoop(inventory, wanderCtx);
      if (wandered && loopCloses(wandered, ctx.catalog) && fitsRoom(wandered, ctx)) {
        return wandered;
      }
    }
    const circle = curveCircle(ctx, 16);
    if (circle && fitsRoom(circle, ctx)) {
      return inflateLoop(circle, inventory, ctx);
    }
  }
  const line = pointToPoint(inventory, ctx);
  return fitsRoom(line, ctx) ? line : [];
}

function previewLayout(
  parts: PlacedPart[],
  inventory: Record<string, number>,
  prefs: GenerationPreferences,
  message: string,
): TrackLayout {
  const labeled = parts.map((part, index) => ({ ...part, label: index + 1 }));
  const layout = analyzeLayout(labeled, CITY_TRACKS_BY_ID, unusedItems(inventory, labeled), message, prefs);
  layout.score.total = scoreLayout(layout, prefs);
  return layout;
}

function applyPause(clock: { deadline: number }, ctx: GenContext, extra: GenContext | null, pause: number | void): void {
  if (typeof pause !== 'number' || pause <= 0) {
    return;
  }
  clock.deadline += pause;
  ctx.deadline = clock.deadline;
  if (extra && extra !== ctx) {
    extra.deadline = clock.deadline;
  }
}

function treeClosedEnough(
  parts: PlacedPart[],
  plan: { parking: number },
  catalog: GenContext['catalog'],
): boolean {
  if (parts.length < 8) {
    return false;
  }
  const opens = openPorts(parts, catalog).filter((port) => !port.instanceId.startsWith('sid'));
  const parkingOpens =
    plan.parking > 0 &&
    opens.length <= plan.parking &&
    opens.every((port) => port.id === 'diverge' || port.instanceId.startsWith('sid'));
  if (opens.length !== 0 && !parkingOpens) {
    return false;
  }
  const used = parts.filter((part) => part.partId === 'straight-16' || part.partId === 'curve-22').length;
  return used >= 24;
}

function* buildCandidateSteps(
  inventory: Record<string, number>,
  prefs: GenerationPreferences,
  ctx: GenContext,
  preferWander: boolean,
  seed: number,
  attempt: number,
  clock: { deadline: number },
): Generator<GenerateStep, PlacedPart[], number | void> {
  const plan = planTopology(inventory, prefs);
  if (ctx.floorPlan) {
    const periCtx: GenContext = {
      ...ctx,
      random: rng((seed + attempt * 9973 + 17) >>> 0),
      deadline: Math.min(ctx.deadline - 600, Date.now() + 2800),
      variant: seed + attempt,
    };
    let explored = tracePerimeter(inventory, periCtx);
    applyPause(clock, ctx, periCtx, yield { phase: 'paths', attempt, parts: explored });
    if (explored.length < 8) {
      const exploreCtx: GenContext = {
        ...ctx,
        random: rng((seed + attempt * 9973) >>> 0),
        deadline: Math.min(ctx.deadline - 800, Date.now() + 1800),
      };
      explored = exploreSpace(inventory, exploreCtx, prefs);
      applyPause(clock, ctx, exploreCtx, yield { phase: 'paths', attempt, parts: explored });
    }
    if (explored.length >= 8) {
      let parts = closeOpenHeads(explored, inventory, {
        ...ctx,
        deadline: Math.max(ctx.deadline, Date.now() + 900),
      }, 0);
      if (openPorts(parts, ctx.catalog).length > 0 && Date.now() < ctx.deadline - 400) {
        const wandered = wanderHomeLoop(inventory, {
          ...ctx,
          deadline: Math.min(ctx.deadline - 200, Date.now() + 700),
        });
        if (
          wandered &&
          loopCloses(wandered, ctx.catalog) &&
          fitsRoom(wandered, ctx) &&
          (wandered.length > parts.length ||
            (openPorts(parts, ctx.catalog).length > 0 && wandered.length >= 24))
        ) {
          parts = wandered;
        }
      }
      applyPause(clock, ctx, ctx, yield { phase: 'core', attempt, parts });
      const keepPark = plan.parking * 6;
      const leftover = remainingInventory(inventory, parts);
      const rigidLeft = (leftover['straight-16'] ?? 0) + (leftover['curve-22'] ?? 0);
      const keepFeatures = plan.crossovers + plan.dualRoutes > 0 ? Math.min(12, Math.floor(rigidLeft * 0.15)) : 0;
      const opensBeforeInflate = openPorts(parts, ctx.catalog).length;
      const inflated = inflateLoop(parts, inventory, ctx, 12, keepPark + keepFeatures, false, null);
      if (openPorts(inflated, ctx.catalog).length <= opensBeforeInflate) {
        parts = inflated;
      }
      parts = closeOpenHeads(parts, inventory, ctx, 0);
      const closedCore = parts;
      const mainClosed = openPorts(parts, ctx.catalog).length === 0;
      if (mainClosed) {
        const afterCrossover = applyCrossover(parts, inventory, plan, ctx);
        if (afterCrossover !== parts) {
          parts = afterCrossover;
          applyPause(clock, ctx, ctx, yield { phase: 'crossover', attempt, parts });
        }
        parts = applyRouteFeatures(parts, inventory, plan, ctx);
        applyPause(clock, ctx, ctx, yield { phase: 'switches', attempt, parts });
        if (!parts.some((part) => part.partId === 'double-crossover')) {
          const afterCrossover = applyCrossover(parts, inventory, plan, ctx);
          if (afterCrossover !== parts) {
            parts = afterCrossover;
          }
        }
        parts = closeOpenHeads(parts, inventory, ctx, 0);
        if (openPorts(parts, ctx.catalog).length > 0) {
          parts = closedCore;
        }
      }
      const fillCtx: GenContext = { ...ctx, deadline: Math.min(ctx.deadline, Date.now() + 1400) };
      if (openPorts(parts, ctx.catalog).length === 0) {
        parts = addInnerLoops(parts, inventory, fillCtx, keepPark);
      }
      const opensBeforeFillInflate = openPorts(parts, ctx.catalog).length;
      const filledInflate = inflateLoop(parts, inventory, ctx, 8, keepPark, false, null);
      if (openPorts(filledInflate, ctx.catalog).length <= opensBeforeFillInflate) {
        parts = filledInflate;
      }
      const beforeSpecials = parts;
      if (openPorts(parts, ctx.catalog).length === 0) {
        parts = placeRemainingSpecials(parts, inventory, ctx, plan.parking);
      }
      parts = placeParking(parts, inventory, ctx, plan.parking);
      parts = closeOpenHeads(parts, inventory, ctx, plan.parking);
      if (
        openPorts(beforeSpecials, ctx.catalog).length === 0 &&
        openPorts(parts, ctx.catalog).length > plan.parking
      ) {
        parts = beforeSpecials;
      }
      const afterPark = remainingInventory(inventory, parts);
      if ((afterPark['straight-16'] ?? 0) + (afterPark['curve-22'] ?? 0) > 16) {
        const extraCtx: GenContext = { ...ctx, deadline: Math.min(ctx.deadline, Date.now() + 900) };
        if (openPorts(parts, ctx.catalog).length === 0) {
          parts = addInnerLoops(parts, inventory, extraCtx, 0);
        }
        if (plan.parking > 0) {
          const retryPark = placeParking(parts, inventory, ctx, plan.parking);
          if (openPorts(retryPark, ctx.catalog).length <= plan.parking) {
            parts = retryPark;
          }
        }
      }
      applyPause(clock, ctx, ctx, yield { phase: 'parking', attempt, parts });
      return parts;
    }
  }

  const rigid = (inventory['straight-16'] ?? 0) + (inventory['curve-22'] ?? 0);
  const treeMs = rigid > 80 ? 1500 : 1100;
  const treeCtx: GenContext = {
    ...ctx,
    random: rng((seed + attempt * 9973) >>> 0),
    deadline: Math.min(ctx.deadline - 900, Date.now() + treeMs),
  };
  const tryTree =
    Date.now() < ctx.deadline - 900 && (rigid > 80 ? attempt === 1 : attempt === 2);
  const grown = tryTree ? growStockTree(inventory, plan, treeCtx) : null;
  const treeOk = grown && treeClosedEnough(grown, plan, ctx.catalog) && fitsRoom(grown, ctx);
  const active = treeOk ? { ...treeCtx, deadline: ctx.deadline } : ctx;
  let parts = treeOk
    ? grown
    : buildCore(reserveForFeatures(inventory, plan), ctx, preferWander);
  if (parts.length === 0) {
    parts = pointToPoint(inventory, ctx);
  }
  applyPause(clock, ctx, active, yield { phase: 'core', attempt, parts });

  const afterCrossover = applyCrossover(parts, inventory, plan, active);
  if (afterCrossover !== parts) {
    parts = afterCrossover;
    applyPause(clock, ctx, active, yield { phase: 'crossover', attempt, parts });
  }

  const afterRoutes = applyRouteFeatures(parts, inventory, plan, active);
  if (afterRoutes !== parts) {
    parts = afterRoutes;
    applyPause(clock, ctx, active, yield { phase: 'routes', attempt, parts });
  } else {
    parts = afterRoutes;
  }

  const beforeInflate = parts;
  const keepPark = plan.parking * 6;
  parts = inflateLoop(parts, inventory, active, 14, keepPark, true);
  parts = inflateLoop(parts, inventory, active, 16, keepPark);
  parts = placeRemainingSpecials(parts, inventory, active, plan.parking);
  parts = inflateLoop(parts, inventory, active, 18, keepPark);
  if (parts !== beforeInflate) {
    applyPause(clock, ctx, active, yield { phase: 'inflate', attempt, parts });
  }

  const beforePark = parts;
  parts = placeParking(parts, inventory, active, plan.parking);
  parts = closeOpenHeads(parts, inventory, active, plan.parking);
  parts = inflateLoop(parts, inventory, active, 12, 0);
  if (parts !== beforePark) {
    applyPause(clock, ctx, active, yield { phase: 'parking', attempt, parts });
  }
  return parts;
}

function snapshotOf(
  phase: GeneratePhase,
  attempt: number,
  parts: PlacedPart[],
  inventory: Record<string, number>,
  prefs: GenerationPreferences,
): GeneratePhaseSnapshot {
  return {
    phase,
    attempt,
    layout: previewLayout(parts, inventory, prefs, `phase.${phase}`),
  };
}

function* generateLayoutSteps(
  items: { partId: string; quantity: number }[],
  prefs: GenerationPreferences,
  options: GenerateOptions,
): Generator<GenerateStep, TrackLayout, number | void> {
  const inventory = inventoryMap(items);
  const seed = options.seed ?? 1;
  const random = rng(seed);
  const clock = { deadline: Date.now() + (options.timeoutMs ?? 4000) };
  const catalog = CITY_TRACKS_BY_ID;
  const candidates: TrackLayout[] = [];

  if (Object.values(inventory).every((qty) => !qty)) {
    return finalize([], inventory, prefs, 'layout.noPieces');
  }

  const fifteenCurves = (inventory['curve-22'] ?? 0) === 15;
  const previousKey = options.previous?.length ? poseKey(options.previous) : '';
  let attempts = 0;
  while (Date.now() < clock.deadline && attempts < 10) {
    attempts += 1;
    const ctx: GenContext = {
      catalog,
      random,
      deadline: clock.deadline,
      seq: attempts * 100,
      floorPlan: options.floorPlan,
      origin: options.floorPlan ? seedInsideFloor(options.floorPlan) : undefined,
    };
    const parts = yield* buildCandidateSteps(
      inventory,
      prefs,
      ctx,
      attempts % 2 === 0,
      seed,
      attempts,
      clock,
    );
    const layout = finalize(parts, inventory, prefs, 'layout.organicLoop', options.floorPlan);
    candidates.push(layout);
    applyPause(
      clock,
      ctx,
      null,
      yield { phase: 'candidate', attempt: attempts, layout },
    );
    if (
      layout.score.routeBonus > 0 &&
      layout.unfinishedPorts === 0 &&
      poseKey(layout.parts) !== previousKey &&
      layout.parkingSpots.length === prefs.targetParkingSpots &&
      unusedRigidTrack(layout) < 24
    ) {
      break;
    }
  }

  const best = pickBest(candidates, inventory, fifteenCurves, previousKey, prefs);
  applyPause(clock, { catalog, random, deadline: clock.deadline, seq: 0 }, null, yield {
    phase: 'done',
    attempt: Math.max(1, attempts),
    layout: best,
  });
  return best;
}

function pickBest(
  candidates: TrackLayout[],
  inventory: Record<string, number>,
  fifteenCurves: boolean,
  previousKey: string,
  prefs: GenerationPreferences,
): TrackLayout {
  if (candidates.length === 0) {
    return finalize([], inventory, prefs, 'layout.couldNotPlace');
  }
  const usable = fifteenCurves
    ? candidates.filter((layout) => layout.score.routeBonus === 0)
    : candidates;
  const looped = usable.filter((layout) => layout.score.routeBonus > 0);
  const closedWell = looped.filter((layout) => layout.unfinishedPorts === 0);
  const parked = closedWell.filter((layout) => layout.parkingSpots.length === prefs.targetParkingSpots);
  const preferred = parked.length ? parked : closedWell.length ? closedWell : looped;
  const valid = preferred.filter((layout) => layoutIsValid(layout, inventory));
  const pool = valid.length
    ? valid
    : preferred.length
      ? preferred
      : closedWell.length
        ? closedWell
        : looped.length
          ? looped
          : usable.length
            ? usable
            : candidates;
  const distinct = previousKey ? pool.filter((layout) => poseKey(layout.parts) !== previousKey) : pool;
  const ranked = distinct.length ? distinct : pool;
  ranked.sort((a, b) => {
    const unfinished = a.unfinishedPorts - b.unfinishedPorts;
    if (unfinished !== 0) {
      return unfinished;
    }
    const park =
      Math.abs(a.parkingSpots.length - prefs.targetParkingSpots) -
      Math.abs(b.parkingSpots.length - prefs.targetParkingSpots);
    if (park !== 0) {
      return park;
    }
    const unused = unusedRigidTrack(a) - unusedRigidTrack(b);
    if (unused !== 0) {
      return unused;
    }
    return b.score.total - a.score.total;
  });
  const best = ranked[0];
  if (best.parts.length === 0) {
    best.message = 'layout.couldNotPlace';
  }
  return best;
}

export function generateLayout(
  items: { partId: string; quantity: number }[],
  prefs: GenerationPreferences = DEFAULT_PREFERENCES,
  options: GenerateOptions = {},
): TrackLayout {
  const steps = generateLayoutSteps(items, prefs, options);
  let step = steps.next();
  while (!step.done) {
    step = steps.next(0);
  }
  return step.value;
}

export async function generateLayoutAsync(
  items: { partId: string; quantity: number }[],
  prefs: GenerationPreferences = DEFAULT_PREFERENCES,
  options: GenerateOptions = {},
): Promise<TrackLayout> {
  const inventory = inventoryMap(items);
  const steps = generateLayoutSteps(items, prefs, options);
  let step = steps.next();
  while (!step.done) {
    const started = Date.now();
    if (options.onPhase) {
      await options.onPhase(toSnapshot(step.value, inventory, prefs));
    }
    step = steps.next(Date.now() - started);
  }
  return step.value;
}

function toSnapshot(
  step: GenerateStep,
  inventory: Record<string, number>,
  prefs: GenerationPreferences,
): GeneratePhaseSnapshot {
  if (step.layout) {
    return { phase: step.phase, attempt: step.attempt, layout: step.layout };
  }
  return snapshotOf(step.phase, step.attempt, step.parts ?? [], inventory, prefs);
}

function unusedRigidTrack(layout: TrackLayout): number {
  return layout.unusedInventory
    .filter((item) => item.partId === 'straight-16' || item.partId === 'curve-22')
    .reduce((sum, item) => sum + item.quantity, 0);
}

function poseKey(parts: PlacedPart[]): string {
  return parts
    .map((part) => `${part.partId}:${Math.round(part.x)}:${Math.round(part.y)}:${Math.round(part.rotation)}`)
    .sort()
    .join('|');
}

export function emptyLayout(): TrackLayout {
  return finalize([], {}, DEFAULT_PREFERENCES, 'layout.noDesign');
}
