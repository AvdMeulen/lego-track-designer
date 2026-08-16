import {
  parkingSidingFixture,
  pointToPointFixture,
  reversingLoopFixture,
  wyeFixture,
} from '../layout-engine/fixtures';
import { preferenceNotes } from './analyze';

describe('layout analysis', () => {
  it('marks an open siding as parking and dead-end reverse', () => {
    const layout = parkingSidingFixture();
    expect(layout.parkingSpots.some((spot) => spot.clearLengthStuds >= 16)).toBeTrue();
    expect(layout.reverseOptions.some((option) => option.kind === 'dead-end')).toBeTrue();
    expect(layout.marks.some((mark) => mark.kind === 'parking')).toBeTrue();
  });

  it('does not treat a point-to-point run as parking', () => {
    const layout = pointToPointFixture();
    expect(layout.parkingSpots.length).toBe(0);
  });

  it('detects a reversing loop when a switch sits on a cycle', () => {
    const layout = reversingLoopFixture();
    expect(layout.reverseOptions.some((option) => option.kind === 'reversing-loop')).toBeTrue();
    expect(layout.marks.some((mark) => mark.kind === 'reverse')).toBeTrue();
  });

  it('detects a wye from three connected switches', () => {
    const layout = wyeFixture();
    expect(layout.reverseOptions.some((option) => option.kind === 'wye')).toBeTrue();
  });

  it('explains missing parking and an oversized flex gap', () => {
    const notes = preferenceNotes(
      {
        ...parkingSidingFixture(),
        parkingSpots: [],
        reverseOptions: [],
        unfinishedPorts: 2,
        unusedInventory: [{ partId: 'flex-track', quantity: 1 }],
      },
      { targetParkingSpots: 1 },
      { 'switch-left': 0, 'flex-track': 1 },
    );
    expect(notes.some((note) => note.includes('note.noSpareSwitch'))).toBeTrue();
    expect(notes.some((note) => note.includes('note.gapTooLarge'))).toBeTrue();
  });
});
