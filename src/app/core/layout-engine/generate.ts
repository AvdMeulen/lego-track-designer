import { analyzeLayout, preferenceNotes } from '../layout-analysis/analyze';
import { CITY_TRACKS_BY_ID } from '../catalog/city-tracks';
import {
  DEFAULT_PREFERENCES,
  GenerationPreferences,
  PlacedPart,
  TrackLayout,
  TrackPart,
} from '../../shared/models/track';
import { placementCollides } from './collide';
import { detectConnections, remainingInventory, unusedItems } from './connections';
import { closeWithFlex } from './flex-closer';
import { attachPart, WorldPort, worldPorts } from './geometry';
import { openPorts } from './connections';

export interface GenerateOptions {
  seed?: number;
  timeoutMs?: number;
}

const RIGID_ORDER = [
  'straight-16',
  'curve-22',
  'switch-left',
  'switch-right',
  'crossing-90',
  'double-crossover',
  'buffer-stop',
];

function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function inventoryMap(items: { partId: string; quantity: number }[]): Record<string, number> {
  return Object.fromEntries(items.map((item) => [item.partId, item.quantity]));
}

function scoreLayout(layout: TrackLayout, prefs: GenerationPreferences): number {
  const parkingDelta = Math.abs(layout.parkingSpots.length - prefs.targetParkingSpots);
  const reverse = prefs.preferReversingRoute ? layout.reverseOptions.length * 8 : 0;
  const pieces = prefs.preferMorePieces ? layout.parts.length : 0;
  const compact = prefs.compact ? layout.score.compactness * 10 : 0;
  const loop = layout.score.routeBonus * 12;
  const specials = layout.score.specialsBonus * 8;
  return (
    40 -
    parkingDelta * 10 +
    reverse +
    pieces +
    compact +
    loop +
    specials -
    layout.score.unfinishedPenalty * 3 -
    layout.score.flexPenalty * 6
  );
}

function finalize(
  parts: PlacedPart[],
  inventory: Record<string, number>,
  prefs: GenerationPreferences,
  message?: string,
): TrackLayout {
  const catalog = CITY_TRACKS_BY_ID;
  const withFlex = closeWithFlex(parts, catalog, remainingInventory(inventory, parts), prefs.allowFlexCloses);
  const labeled = withFlex.map((part, index) => ({ ...part, label: index + 1 }));
  const layout = analyzeLayout(labeled, catalog, unusedItems(inventory, labeled), message);
  layout.notes = preferenceNotes(layout, prefs, inventory);
  if (layout.notes.length) {
    layout.message = layout.notes.join(' ');
  }
  layout.score.total = scoreLayout(layout, prefs);
  return layout;
}

function neighborsOf(
  instanceId: string,
  parts: PlacedPart[],
  catalog: Record<string, TrackPart>,
): string[] {
  return detectConnections(parts, catalog)
    .filter((connection) => connection.fromInstanceId === instanceId || connection.toInstanceId === instanceId)
    .map((connection) =>
      connection.fromInstanceId === instanceId ? connection.toInstanceId : connection.fromInstanceId,
    );
}

function tryAttach(
  part: TrackPart,
  localPortId: string,
  target: WorldPort,
  existing: PlacedPart[],
  catalog: Record<string, TrackPart>,
  instanceId: string,
  label: number,
): PlacedPart | null {
  const pose = attachPart(part, localPortId, target);
  const candidate: PlacedPart = { instanceId, partId: part.id, label, ...pose };
  const ignore = [target.instanceId, ...neighborsOf(target.instanceId, existing, catalog)];
  if (placementCollides(candidate, existing, catalog, ignore)) {
    return null;
  }
  return candidate;
}

function buildSequence(sequence: string[], catalog: Record<string, TrackPart>): PlacedPart[] | null {
  if (sequence.length === 0) {
    return null;
  }
  const parts: PlacedPart[] = [
    { instanceId: 'p1', partId: sequence[0], label: 1, x: 0, y: 0, rotation: 0 },
  ];
  for (let i = 1; i < sequence.length; i += 1) {
    const part = catalog[sequence[i]];
    const opens = openPorts(parts, catalog);
    if (opens.length === 0) {
      return parts;
    }
    const head = opens[opens.length - 1];
    const pose = attachPart(part, part.ports[0].id, head);
    parts.push({ instanceId: `p${i + 1}`, partId: part.id, label: i + 1, ...pose });
  }
  return parts;
}

function roundedLoopSequence(inventory: Record<string, number>): string[] | null {
  const curves = inventory['curve-22'] ?? 0;
  const straights = inventory['straight-16'] ?? 0;
  if (curves < 16) {
    return null;
  }
  const perSide = Math.floor(straights / 4);
  const leftoverStraights = straights % 4;
  const sequence: string[] = [];
  for (let side = 0; side < 4; side += 1) {
    for (let i = 0; i < perSide + (side < leftoverStraights ? 1 : 0); i += 1) {
      sequence.push('straight-16');
    }
    for (let i = 0; i < 4; i += 1) {
      sequence.push('curve-22');
    }
  }
  return sequence;
}

function pointToPointSequence(inventory: Record<string, number>): string[] | null {
  const curves = inventory['curve-22'] ?? 0;
  const straights = inventory['straight-16'] ?? 0;
  if (curves + straights < 2) {
    return null;
  }
  const sequence: string[] = [];
  if ((inventory['buffer-stop'] ?? 0) > 0) {
    sequence.push('buffer-stop');
  }
  for (let i = 0; i < straights; i += 1) {
    sequence.push('straight-16');
  }
  for (let i = 0; i < Math.min(curves, 8); i += 1) {
    sequence.push('curve-22');
  }
  if ((inventory['buffer-stop'] ?? 0) > 1) {
    sequence.push('buffer-stop');
  }
  return sequence.length ? sequence : null;
}

function isSwitchPort(port: WorldPort, parts: PlacedPart[], catalog: Record<string, TrackPart>): boolean {
  const owner = parts.find((item) => item.instanceId === port.instanceId);
  return !!owner && catalog[owner.partId].category === 'switch';
}

function insertSwitchesIntoLoop(
  parts: PlacedPart[],
  inventory: Record<string, number>,
): PlacedPart[] {
  const result = parts.map((part) => ({ ...part }));
  const switchIds = (['switch-left', 'switch-right'] as const).filter((id) => (inventory[id] ?? 0) > 0);
  const straightIndexes = result
    .map((part, index) => (part.partId === 'straight-16' ? index : -1))
    .filter((index) => index >= 0);
  if (switchIds.length === 0 || straightIndexes.length === 0) {
    return result;
  }

  const picks =
    switchIds.length > 1 && straightIndexes.length > 1
      ? [straightIndexes[0], straightIndexes[Math.floor(straightIndexes.length / 2)]]
      : [straightIndexes[0]];

  switchIds.slice(0, picks.length).forEach((id, index) => {
    const target = picks[index];
    result[target] = { ...result[target], partId: id };
  });
  return result;
}

function growOpenBranches(
  parts: PlacedPart[],
  inventory: Record<string, number>,
  catalog: Record<string, TrackPart>,
  prefs: GenerationPreferences,
): PlacedPart[] {
  const result = [...parts];
  const prefer = ['straight-16', 'curve-22', 'switch-left', 'switch-right'];
  if (prefs.targetParkingSpots > 0) {
    prefer.push('buffer-stop');
  }

  let progress = true;
  while (progress) {
    progress = false;
    const left = remainingInventory(inventory, result);
    const opens = openPorts(result, catalog).sort((a, b) => {
      const score = (port: WorldPort) => {
        if (!isSwitchPort(port, result, catalog)) {
          return 1;
        }
        return port.id === 'diverge' ? 4 : 3;
      };
      return score(b) - score(a);
    });
    for (const open of opens) {
      for (const type of prefer) {
        if ((left[type] ?? 0) <= 0) {
          continue;
        }
        const part = catalog[type];
        const placed = tryAttach(
          part,
          part.ports[0].id,
          open,
          result,
          catalog,
          `br${result.length + 1}`,
          result.length + 1,
        );
        if (placed) {
          result.push(placed);
          progress = true;
          break;
        }
      }
      if (progress) {
        break;
      }
    }
  }
  return result;
}

function parallelFromCrossover(
  inventory: Record<string, number>,
  catalog: Record<string, TrackPart>,
  prefs: GenerationPreferences,
): PlacedPart[] | null {
  if ((inventory['double-crossover'] ?? 0) < 1 || (inventory['straight-16'] ?? 0) < 2) {
    return null;
  }
  const start: PlacedPart[] = [
    { instanceId: 'dc1', partId: 'double-crossover', label: 1, x: 0, y: 0, rotation: 0 },
  ];
  return growOpenBranches(start, inventory, catalog, prefs);
}

function addSiding(
  parts: PlacedPart[],
  inventory: Record<string, number>,
  catalog: Record<string, TrackPart>,
): PlacedPart[] {
  const left = remainingInventory(inventory, parts);
  if ((left['straight-16'] ?? 0) <= 0) {
    return parts;
  }
  const opens = openPorts(parts, catalog).filter((port) => {
    const owner = parts.find((item) => item.instanceId === port.instanceId);
    return owner && catalog[owner.partId].category === 'switch';
  });
  if (opens.length === 0) {
    return parts;
  }
  const result = [...parts];
  const straight = catalog['straight-16'];
  const placed = tryAttach(
    straight,
    'a',
    opens[0],
    result,
    catalog,
    `sid-${result.length + 1}`,
    result.length + 1,
  );
  if (!placed) {
    return parts;
  }
  result.push(placed);
  if ((left['buffer-stop'] ?? 0) > 0) {
    const end = worldPorts(straight, placed).find((port) => port.id === 'b');
    if (end) {
      const buffer = tryAttach(
        catalog['buffer-stop'],
        'a',
        end,
        result,
        catalog,
        `buf-${result.length + 1}`,
        result.length + 1,
      );
      if (buffer) {
        result.push(buffer);
      }
    }
  }
  return result;
}

function search(
  inventory: Record<string, number>,
  _prefs: GenerationPreferences,
  random: () => number,
  deadline: number,
  startParts?: PlacedPart[],
): PlacedPart[] {
  const catalog = CITY_TRACKS_BY_ID;
  const seedId = RIGID_ORDER.find((id) => (inventory[id] ?? 0) > 0 && catalog[id].ports.length >= 1);
  const start: PlacedPart[] =
    startParts && startParts.length
      ? startParts
      : seedId
        ? [{ instanceId: 'p1', partId: seedId, label: 1, x: 0, y: 0, rotation: 0 }]
        : [];
  if (start.length === 0) {
    return [];
  }
  let best = start;

  const visit = (parts: PlacedPart[]) => {
    if (Date.now() > deadline) {
      return;
    }
    if (parts.length > best.length) {
      best = parts;
    }
    const left = remainingInventory(inventory, parts);
    const opens = openPorts(parts, catalog);
    if (opens.length === 0 || parts.length > 40) {
      return;
    }

    const types = RIGID_ORDER.filter((id) => (left[id] ?? 0) > 0).sort(() => random() - 0.5);
    const switchOpens = opens.filter((port) => isSwitchPort(port, parts, catalog));
    const otherOpens = opens.filter((port) => !isSwitchPort(port, parts, catalog)).sort(() => random() - 0.5).slice(0, 2);
    const ports = [...switchOpens, ...otherOpens];
    let attempts = 0;
    for (const open of ports) {
      for (const type of types) {
        const part = catalog[type];
        for (const local of part.ports) {
          if (Date.now() > deadline || attempts > 18) {
            return;
          }
          attempts += 1;
          const candidate = tryAttach(
            part,
            local.id,
            open,
            parts,
            catalog,
            `p${parts.length + 1}`,
            parts.length + 1,
          );
          if (candidate) {
            visit([...parts, candidate]);
          }
        }
      }
    }
  };

  visit(start);
  return best;
}

export function generateLayout(
  items: { partId: string; quantity: number }[],
  prefs: GenerationPreferences = DEFAULT_PREFERENCES,
  options: GenerateOptions = {},
): TrackLayout {
  const inventory = inventoryMap(items);
  const catalog = CITY_TRACKS_BY_ID;
  const random = rng(options.seed ?? 1);
  const deadline = Date.now() + (options.timeoutMs ?? 2200);
  const candidates: TrackLayout[] = [];

  const loopSeq = roundedLoopSequence(inventory);
  if (loopSeq) {
    const parts = buildSequence(loopSeq, catalog);
    if (parts) {
      const withSwitches = insertSwitchesIntoLoop(parts, inventory);
      const branched = growOpenBranches(withSwitches, inventory, catalog, prefs);
      const withSiding =
        prefs.targetParkingSpots > 0 && (inventory['switch-left'] ?? 0) + (inventory['switch-right'] ?? 0) > 0
          ? addSiding(branched, inventory, catalog)
          : branched;
      candidates.push(finalize(withSiding, inventory, prefs, 'Rounded loop from curves and straights'));
    }
  }

  const parallels = parallelFromCrossover(inventory, catalog, prefs);
  if (parallels) {
    candidates.push(finalize(parallels, inventory, prefs, 'Parallel tracks from a double crossover'));
  }

  const lineSeq = pointToPointSequence(inventory);
  if (lineSeq && (!prefs.loopPlusParking || !loopSeq)) {
    const parts = buildSequence(lineSeq, catalog);
    if (parts) {
      candidates.push(finalize(parts, inventory, prefs, 'Point-to-point route'));
    }
  }

  if ((inventory['switch-left'] ?? 0) + (inventory['switch-right'] ?? 0) > 0) {
    const switchId = (inventory['switch-left'] ?? 0) > 0 ? 'switch-left' : 'switch-right';
    const seeded: PlacedPart[] = [{ instanceId: 's1', partId: switchId, label: 1, x: 0, y: 0, rotation: 0 }];
    const branched = growOpenBranches(seeded, inventory, catalog, prefs);
    const withSiding = addSiding(branched, inventory, catalog);
    const grown = search(inventory, prefs, random, deadline, withSiding);
    candidates.push(finalize(grown, inventory, prefs, 'Switch-led network'));
  }

  const searched = search(inventory, prefs, random, deadline);
  if (searched.length) {
    candidates.push(finalize(searched, inventory, prefs, 'Search layout'));
  }

  if (candidates.length === 0) {
    return finalize([], inventory, prefs, 'No pieces to place');
  }

  const looped = candidates.filter((layout) => layout.score.routeBonus > 0);
  const pool = prefs.loopPlusParking && looped.length ? looped : candidates;
  pool.sort((a, b) => b.score.total - a.score.total);
  const best = pool[0];
  if (best.parts.length === 0) {
    best.message = 'Could not place a layout with the current inventory.';
  }
  return best;
}

export function emptyLayout(): TrackLayout {
  return finalize([], {}, DEFAULT_PREFERENCES, 'No design yet');
}
