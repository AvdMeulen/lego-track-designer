import { CITY_TRACKS_BY_ID } from '../catalog/city-tracks';
import {
  parkingSidingFixture,
  passingSidingFixture,
  pointToPointFixture,
  reversingLoopFixture,
  wyeFixture,
} from '../layout-engine/fixtures';
import { analyzeLayout, preferenceNotes, refreshReverseAnalysis } from './analyze';

describe('layout analysis', () => {
  it('marks an open siding as parking and dead-end reverse', () => {
    const layout = parkingSidingFixture();
    expect(layout.parkingSpots.some((spot) => spot.clearLengthStuds >= 16)).toBeTrue();
    expect(layout.reverseOptions.some((option) => option.kind === 'dead-end')).toBeTrue();
    expect(layout.marks.some((mark) => mark.kind === 'parking')).toBeTrue();
  });

  it('hides parking when the builder asked for none', () => {
    const fixture = parkingSidingFixture();
    const layout = analyzeLayout(fixture.parts, CITY_TRACKS_BY_ID, [], fixture.message, {
      targetParkingSpots: 0,
    });
    expect(layout.parkingSpots.length).toBe(0);
    expect(layout.marks.some((mark) => mark.kind === 'parking')).toBeFalse();
  });

  it('does not treat a point-to-point run as parking', () => {
    const layout = pointToPointFixture();
    expect(layout.parkingSpots.length).toBe(0);
  });

  it('only counts a switch diverge siding as parking, not an open main line', () => {
    const layout = parkingSidingFixture();
    expect(layout.parkingSpots.length).toBe(1);
    expect(layout.parkingSpots[0].endInstanceId).toBe('sid1');
  });

  it('detects a reversing loop when a balloon returns to the same switch', () => {
    const layout = reversingLoopFixture();
    expect(layout.reverseOptions.some((option) => option.kind === 'reversing-loop')).toBeTrue();
    expect(layout.marks.some((mark) => mark.kind === 'reverse')).toBeTrue();
  });

  it('does not call a passing siding a reversing loop', () => {
    const layout = passingSidingFixture();
    expect(layout.parts.some((part) => part.partId.startsWith('switch-'))).toBeTrue();
    expect(layout.reverseOptions.some((option) => option.kind === 'reversing-loop')).toBeFalse();
    expect(layout.marks.some((mark) => mark.kind === 'reverse')).toBeFalse();
  });

  it('drops a stale keerlus mark when a stored layout is rechecked', () => {
    const layout = passingSidingFixture();
    const stale = {
      ...layout,
      reverseOptions: [{ kind: 'reversing-loop' as const, partIds: [layout.parts[0].instanceId] }],
      marks: [...layout.marks, { kind: 'reverse' as const, x: 0, y: 0, text: 'mark.reverseLoop' }],
    };
    const refreshed = refreshReverseAnalysis(stale, CITY_TRACKS_BY_ID);
    expect(refreshed.reverseOptions.some((option) => option.kind === 'reversing-loop')).toBeFalse();
    expect(refreshed.marks.some((mark) => mark.kind === 'reverse')).toBeFalse();
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
