import { planTopology, maxParkingSpots, clampParking } from './topology';

describe('planTopology', () => {
  it('caps parking at the number of switches', () => {
    expect(maxParkingSpots(0)).toBe(0);
    expect(maxParkingSpots(1)).toBe(1);
    expect(maxParkingSpots(4)).toBe(2);
    expect(clampParking(2, 1)).toBe(1);
    expect(clampParking(2, 0)).toBe(0);
  });

  it('pairs leftover switches into dual routes', () => {
    const plan = planTopology(
      { 'switch-left': 2, 'switch-right': 2, 'double-crossover': 1 },
      { targetParkingSpots: 0 },
    );
    expect(plan.parking).toBe(0);
    expect(plan.dualRoutes).toBe(2);
    expect(plan.keerlussen).toBe(0);
    expect(plan.crossovers).toBe(1);
  });

  it('uses one switch for parking and pairs the rest', () => {
    const plan = planTopology(
      { 'switch-left': 2, 'switch-right': 1 },
      { targetParkingSpots: 1 },
    );
    expect(plan.parking).toBe(1);
    expect(plan.dualRoutes).toBe(1);
    expect(plan.keerlussen).toBe(0);
  });

  it('turns an odd leftover switch into a keerlus when parking is off', () => {
    const plan = planTopology({ 'switch-left': 1 }, { targetParkingSpots: 0 });
    expect(plan.parking).toBe(0);
    expect(plan.dualRoutes).toBe(0);
    expect(plan.keerlussen).toBe(1);
  });

  it('leaves an odd leftover unused when parking is on so the graph can close', () => {
    const plan = planTopology(
      { 'switch-left': 2, 'switch-right': 2 },
      { targetParkingSpots: 1 },
    );
    expect(plan.parking).toBe(1);
    expect(plan.dualRoutes).toBe(1);
    expect(plan.keerlussen).toBe(0);
  });
});
