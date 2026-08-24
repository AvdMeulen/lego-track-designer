import { CITY_TRACKS_BY_ID } from '../catalog/city-tracks';
import { openPorts } from './connections';
import { approachThenFlex, canCloseWithFlex, closeWithFlex } from './flex-closer';
import { worldPorts } from './geometry';
import { rng } from './place';

describe('flex-closer', () => {
  const catalog = CITY_TRACKS_BY_ID;
  const flex = catalog['flex-track'];

  it('places flex on a 12-stud facing gap and closes both ports', () => {
    const parts = [
      { instanceId: 'st1', partId: 'straight-16', label: 1, x: 0, y: 0, rotation: 0 },
      { instanceId: 'st2', partId: 'straight-16', label: 2, x: 28, y: 0, rotation: 0 },
    ];
    const closed = closeWithFlex(parts, catalog, { 'flex-track': 1 }, true);
    expect(closed.some((part) => part.partId === 'flex-track')).toBeTrue();
    const opens = openPorts(closed, catalog);
    expect(opens.some((port) => port.instanceId === 'st1' && port.id === 'b')).toBeFalse();
    expect(opens.some((port) => port.instanceId === 'st2' && port.id === 'a')).toBeFalse();
  });

  it('grows a 24-stud facing gap until one flex piece fits', () => {
    const parts = [
      { instanceId: 'st1', partId: 'straight-16', label: 1, x: 0, y: 0, rotation: 0 },
      { instanceId: 'st2', partId: 'straight-16', label: 2, x: 40, y: 0, rotation: 0 },
    ];
    const left = worldPorts(catalog['straight-16'], parts[0]).find((port) => port.id === 'b')!;
    const right = worldPorts(catalog['straight-16'], parts[1]).find((port) => port.id === 'a')!;
    expect(canCloseWithFlex(left, right, flex)).toBeFalse();
    const closed = approachThenFlex(parts, left, right, { 'straight-16': 4, 'flex-track': 2 }, {
      catalog,
      random: rng(1),
      deadline: Date.now() + 1000,
      seq: 0,
    });
    expect(closed).toBeTruthy();
    expect(closed!.some((part) => part.partId === 'flex-track')).toBeTrue();
    const opens = openPorts(closed!, catalog);
    expect(opens.some((port) => port.instanceId === 'st1' && port.id === 'b')).toBeFalse();
    expect(opens.some((port) => port.instanceId === 'st2' && port.id === 'a')).toBeFalse();
  });

  it('closes a facing offset gap that one flex piece cannot span', () => {
    const parts = [
      { instanceId: 'st1', partId: 'straight-16', label: 1, x: 126.8, y: 403.9, rotation: 180 },
      { instanceId: 'st2', partId: 'straight-16', label: 2, x: 222.8, y: 355.9, rotation: 180 },
    ];
    const left = worldPorts(catalog['straight-16'], parts[0]).find((port) => port.id === 'a')!;
    const right = worldPorts(catalog['straight-16'], parts[1]).find((port) => port.id === 'b')!;
    expect(canCloseWithFlex(left, right, flex)).toBeFalse();
    const closed = approachThenFlex(
      parts,
      left,
      right,
      { 'straight-16': 20, 'curve-22': 20, 'flex-track': 2 },
      {
        catalog,
        random: rng(1),
        deadline: Date.now() + 1500,
        seq: 0,
      },
    );
    expect(closed).toBeTruthy();
    expect(closed!.some((part) => part.partId === 'flex-track')).toBeTrue();
    const opens = openPorts(closed!, catalog);
    expect(opens.some((port) => port.instanceId === left.instanceId && port.id === left.id)).toBeFalse();
    expect(opens.some((port) => port.instanceId === right.instanceId && port.id === right.id)).toBeFalse();
  });

  it('closes an 18-stud facing gap with two flex pieces', () => {
    const parts = [
      { instanceId: 'st1', partId: 'straight-16', label: 1, x: 0, y: 0, rotation: 0 },
      { instanceId: 'st2', partId: 'straight-16', label: 2, x: 34, y: 0, rotation: 0 },
    ];
    const left = worldPorts(catalog['straight-16'], parts[0]).find((port) => port.id === 'b')!;
    const right = worldPorts(catalog['straight-16'], parts[1]).find((port) => port.id === 'a')!;
    expect(canCloseWithFlex(left, right, flex)).toBeFalse();
    const closed = closeWithFlex(parts, catalog, { 'flex-track': 2 }, true);
    expect(closed.filter((part) => part.partId === 'flex-track').length).toBe(2);
    const opens = openPorts(closed, catalog);
    expect(opens.some((port) => port.instanceId === 'st1' && port.id === 'b')).toBeFalse();
    expect(opens.some((port) => port.instanceId === 'st2' && port.id === 'a')).toBeFalse();
  });

  it('refuses a gap longer than one flex piece', () => {
    expect(canCloseWithFlex({ x: 0, y: 0, heading: 0 }, { x: 40, y: 0, heading: 180 }, flex)).toBeFalse();
  });
});
