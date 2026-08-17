import { GenerationPreferences } from '../../shared/models/track';

export type ParkingCount = 0 | 1 | 2;

export interface TopologyPlan {
  parking: ParkingCount;
  dualRoutes: number;
  keerlussen: number;
  crossovers: number;
  crossings: number;
  switchCount: number;
}

export function switchCountOf(inventory: Record<string, number>): number {
  return (inventory['switch-left'] ?? 0) + (inventory['switch-right'] ?? 0);
}

export function maxParkingSpots(switchCount: number): ParkingCount {
  if (switchCount <= 0) {
    return 0;
  }
  return switchCount === 1 ? 1 : 2;
}

export function clampParking(target: number, switchCount: number): ParkingCount {
  const max = maxParkingSpots(switchCount);
  const spots = Math.min(Math.max(0, Math.floor(target)), max);
  return spots >= 2 ? 2 : spots >= 1 ? 1 : 0;
}

export function planTopology(
  inventory: Record<string, number>,
  prefs: GenerationPreferences,
): TopologyPlan {
  const switchCount = switchCountOf(inventory);
  const parking = clampParking(prefs.targetParkingSpots, switchCount);
  let remaining = Math.max(0, switchCount - parking);
  const dualRoutes = Math.floor(remaining / 2);
  remaining -= dualRoutes * 2;
  // An odd leftover switch plus parking would be an even number of 3-port pieces,
  // which cannot close with only parking ends open. Leave that switch unused.
  return {
    parking,
    dualRoutes,
    keerlussen: parking > 0 ? 0 : remaining,
    crossovers: inventory['double-crossover'] ?? 0,
    crossings: inventory['crossing-90'] ?? 0,
    switchCount,
  };
}
