import { CITY_TRACKS_BY_ID } from '../catalog/city-tracks';
import { analyzeLayout, preferenceNotes } from '../layout-analysis/analyze';
import {
  DEFAULT_PREFERENCES,
  GenerationPreferences,
  PlacedPart,
  TrackLayout,
} from '../../shared/models/track';
import { remainingInventory, unusedItems, openPorts } from './connections';
import { closeWithFlex } from './flex-closer';
import { applyFeatures, placeParking, placeRemainingSpecials } from './features';
import { GenContext, inventoryMap, rng } from './place';
import { scoreLayout, layoutIsValid } from './score';
import { planTopology } from './topology';
import { growStockTree } from './tree';
import { curveCircle, inflateLoop, loopCloses, organicRing, pointToPoint, wanderHomeLoop } from './wander';

export interface GenerateOptions {
  seed?: number;
  timeoutMs?: number;
  previous?: PlacedPart[];
}

function finalize(
  parts: PlacedPart[],
  inventory: Record<string, number>,
  prefs: GenerationPreferences,
  message?: string,
): TrackLayout {
  const catalog = CITY_TRACKS_BY_ID;
  const allowFlex = (inventory['curve-22'] ?? 0) !== 15;
  const withFlex = closeWithFlex(parts, catalog, remainingInventory(inventory, parts), allowFlex);
  const labeled = withFlex.map((part, index) => ({ ...part, label: index + 1 }));
  const layout = analyzeLayout(labeled, catalog, unusedItems(inventory, labeled), message);
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

function buildCore(inventory: Record<string, number>, ctx: GenContext, preferWander: boolean): PlacedPart[] {
  const curves = inventory['curve-22'] ?? 0;
  const straights = inventory['straight-16'] ?? 0;
  if (curves >= 16) {
    if (preferWander || straights + curves > 40) {
      const wandered = wanderHomeLoop(inventory, ctx);
      if (wandered && loopCloses(wandered, ctx.catalog)) {
        return wandered;
      }
    }
    const ring = organicRing(inventory, ctx);
    if (ring && loopCloses(ring, ctx.catalog)) {
      return ring;
    }
    const wandered = wanderHomeLoop(inventory, ctx);
    if (wandered && loopCloses(wandered, ctx.catalog)) {
      return wandered;
    }
    const circle = curveCircle(ctx, 16);
    if (circle) {
      return inflateLoop(circle, inventory, ctx);
    }
  }
  return pointToPoint(inventory, ctx);
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
  return opens.length === 0 || parkingOpens;
}

function buildCandidate(
  inventory: Record<string, number>,
  prefs: GenerationPreferences,
  ctx: GenContext,
  preferWander: boolean,
  seed: number,
  attempt: number,
): PlacedPart[] {
  const plan = planTopology(inventory, prefs);
  const treeCtx: GenContext = {
    ...ctx,
    random: rng((seed + attempt * 9973) >>> 0),
    deadline: Math.min(ctx.deadline - 1400, Date.now() + 900),
  };
  const grown =
    attempt === 2 && Date.now() < ctx.deadline - 1400
      ? growStockTree(inventory, plan, treeCtx)
      : null;
  const treeOk = grown && treeClosedEnough(grown, plan, ctx.catalog);
  const active = treeOk ? treeCtx : ctx;
  let parts = treeOk
    ? grown
    : buildCore(reserveForFeatures(inventory, plan), ctx, preferWander);
  if (parts.length === 0) {
    parts = pointToPoint(inventory, ctx);
  }
  parts = applyFeatures(parts, inventory, plan, active);
  const keepPark = plan.parking * 6;
  parts = inflateLoop(parts, inventory, active, 16, keepPark);
  parts = placeRemainingSpecials(parts, inventory, active, plan.parking);
  parts = inflateLoop(parts, inventory, active, 18, keepPark);
  parts = placeParking(parts, inventory, active, plan.parking);
  parts = inflateLoop(parts, inventory, active, 12, 0);
  return parts;
}

export function generateLayout(
  items: { partId: string; quantity: number }[],
  prefs: GenerationPreferences = DEFAULT_PREFERENCES,
  options: GenerateOptions = {},
): TrackLayout {
  const inventory = inventoryMap(items);
  const seed = options.seed ?? 1;
  const random = rng(seed);
  const timeoutMs = options.timeoutMs ?? 2800;
  const deadline = Date.now() + timeoutMs;
  const catalog = CITY_TRACKS_BY_ID;
  const candidates: TrackLayout[] = [];

  if (Object.values(inventory).every((qty) => !qty)) {
    return finalize([], inventory, prefs, 'layout.noPieces');
  }

  const fifteenCurves = (inventory['curve-22'] ?? 0) === 15;
  const previousKey = options.previous?.length ? poseKey(options.previous) : '';
  let attempts = 0;
  while (Date.now() < deadline && attempts < 10) {
    attempts += 1;
    const ctx: GenContext = { catalog, random, deadline, seq: attempts * 100 };
    const parts = buildCandidate(inventory, prefs, ctx, attempts % 2 === 0, seed, attempts);
    const layout = finalize(parts, inventory, prefs, 'layout.organicLoop');
    candidates.push(layout);
    if (
      layout.score.routeBonus > 0 &&
      layout.unfinishedPorts === 0 &&
      layout.parkingSpots.length === prefs.targetParkingSpots &&
      unusedRigidTrack(layout) < 8 &&
      poseKey(layout.parts) !== previousKey
    ) {
      break;
    }
  }

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
  pool.sort((a, b) => b.score.total - a.score.total);
  const distinct = previousKey ? pool.filter((layout) => poseKey(layout.parts) !== previousKey) : pool;
  const best = (distinct.length ? distinct : pool)[0];
  if (best.parts.length === 0) {
    best.message = 'layout.couldNotPlace';
  }
  return best;
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
