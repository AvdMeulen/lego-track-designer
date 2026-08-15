import { analyzeLayout } from '../layout-analysis/analyze';
import { CITY_TRACKS, CITY_TRACKS_BY_ID } from '../catalog/city-tracks';
import { PlacedPart, TrackLayout } from '../../shared/models/track';
import { attachPart, worldPorts } from './geometry';
import { closeWithFlex, flexPathBetween } from './flex-closer';
import { detectConnections, openPorts } from './connections';

const catalog = CITY_TRACKS_BY_ID;

function attachTo(
  partId: string,
  instanceId: string,
  label: number,
  target: { x: number; y: number; heading: number },
  localPortId: string,
): PlacedPart {
  const pose = attachPart(catalog[partId], localPortId, target);
  return { instanceId, partId, label, ...pose };
}

function grow(sequence: string[]): PlacedPart[] {
  const firstId = sequence[0];
  const parts: PlacedPart[] = [
    { instanceId: 'p1', partId: firstId, label: 1, x: 0, y: 0, rotation: 0 },
  ];

  for (let i = 1; i < sequence.length; i += 1) {
    const partId = sequence[i];
    const opens = openPorts(parts, catalog);
    const head = opens[opens.length - 1];
    const localPort = catalog[partId].ports[0].id;
    parts.push(attachTo(partId, `p${i + 1}`, i + 1, head, localPort));
  }
  return parts;
}

export function circleFixture(): TrackLayout {
  const parts = grow(Array.from({ length: 16 }, () => 'curve-22'));
  return analyzeLayout(parts, catalog, [], 'fixture.circle');
}

export function ovalFixture(): TrackLayout {
  const sequence: string[] = [];
  for (let side = 0; side < 4; side += 1) {
    sequence.push('straight-16', 'straight-16');
    sequence.push('curve-22', 'curve-22', 'curve-22', 'curve-22');
  }
  const parts = grow(sequence);
  return analyzeLayout(parts, catalog, [], 'fixture.oval');
}

export function switchFixture(side: 'left' | 'right' = 'left'): TrackLayout {
  const switchId = side === 'left' ? 'switch-left' : 'switch-right';
  const parts: PlacedPart[] = [
    { instanceId: 's1', partId: switchId, label: 1, x: 0, y: 0, rotation: 0 },
  ];
  const switchPorts = worldPorts(catalog[switchId], parts[0]);
  const through = switchPorts.find((port) => port.id === 'through')!;
  const diverge = switchPorts.find((port) => port.id === 'diverge')!;
  parts.push(attachTo('straight-16', 'st1', 2, through, 'a'));
  parts.push(attachTo('curve-22', 'c1', 3, diverge, 'a'));
  return analyzeLayout(parts, catalog, [], `fixture.switch-${side}`);
}

export function crossingFixture(): TrackLayout {
  const parts: PlacedPart[] = [
    { instanceId: 'x1', partId: 'crossing-90', label: 1, x: 0, y: 0, rotation: 0 },
  ];
  const ports = worldPorts(catalog['crossing-90'], parts[0]);
  ports.forEach((port, index) => {
    parts.push(attachTo('straight-16', `st${index + 1}`, index + 2, port, 'a'));
  });
  return analyzeLayout(parts, catalog, [], 'fixture.crossing');
}

export function doubleCrossoverFixture(): TrackLayout {
  const parts: PlacedPart[] = [
    { instanceId: 'dc1', partId: 'double-crossover', label: 1, x: 0, y: 0, rotation: 0 },
  ];
  const ports = worldPorts(catalog['double-crossover'], parts[0]);
  ports.forEach((port, index) => {
    parts.push(attachTo('straight-16', `st${index + 1}`, index + 2, port, 'a'));
  });
  return analyzeLayout(parts, catalog, [], 'fixture.double-crossover');
}

export function bufferFixture(): TrackLayout {
  const parts: PlacedPart[] = [
    { instanceId: 'st1', partId: 'straight-16', label: 1, x: 0, y: 0, rotation: 0 },
  ];
  const end = worldPorts(catalog['straight-16'], parts[0]).find((port) => port.id === 'b')!;
  parts.push(attachTo('buffer-stop', 'b1', 2, end, 'a'));
  return analyzeLayout(parts, catalog, [], 'fixture.buffer');
}

export function flexGapFixture(): TrackLayout {
  const parts: PlacedPart[] = [
    { instanceId: 'st1', partId: 'straight-16', label: 1, x: 0, y: 0, rotation: 0 },
    { instanceId: 'st2', partId: 'straight-16', label: 2, x: 28, y: 0, rotation: 0 },
  ];
  const closed = closeWithFlex(parts, catalog, { 'flex-track': 1 }, true);
  return analyzeLayout(closed, catalog, [], 'fixture.flex');
}

export function pointToPointFixture(): TrackLayout {
  const sequence = ['buffer-stop', 'straight-16', 'curve-22', 'straight-16', 'curve-22', 'straight-16', 'buffer-stop'];
  const parts = grow(sequence);
  return analyzeLayout(parts, catalog, [], 'fixture.point-to-point');
}

export function reversingLoopFixture(): TrackLayout {
  const parts: PlacedPart[] = [
    { instanceId: 's1', partId: 'switch-left', label: 1, x: 0, y: 0, rotation: 0 },
  ];
  const through = worldPorts(catalog['switch-left'], parts[0]).find((port) => port.id === 'through')!;
  const diverge = worldPorts(catalog['switch-left'], parts[0]).find((port) => port.id === 'diverge')!;
  const loop = ['curve-22', 'curve-22', 'curve-22', 'curve-22', 'straight-16', 'curve-22', 'curve-22', 'curve-22', 'curve-22', 'straight-16', 'curve-22', 'curve-22', 'curve-22', 'curve-22', 'straight-16', 'curve-22', 'curve-22', 'curve-22', 'curve-22'];
  let head = through;
  loop.forEach((partId, index) => {
    const next = attachTo(partId, `loop${index + 1}`, index + 2, head, 'a');
    parts.push(next);
    const ports = worldPorts(catalog[partId], next);
    head = ports.find((port) => port.id !== 'a') ?? ports[ports.length - 1];
  });
  const siding = attachTo('straight-16', 'sid1', parts.length + 1, diverge, 'a');
  parts.push(siding);
  const sidingEnd = worldPorts(catalog['straight-16'], siding).find((port) => port.id === 'b')!;
  parts.push(attachTo('buffer-stop', 'buf1', parts.length + 1, sidingEnd, 'a'));
  return analyzeLayout(parts, catalog, [], 'fixture.reverse-loop');
}

export function wyeFixture(): TrackLayout {
  const parts: PlacedPart[] = [
    { instanceId: 'w1', partId: 'switch-left', label: 1, x: 0, y: 0, rotation: 0 },
  ];
  const through = worldPorts(catalog['switch-left'], parts[0]).find((port) => port.id === 'through')!;
  const stem = worldPorts(catalog['switch-left'], parts[0]).find((port) => port.id === 'stem')!;
  const diverge = worldPorts(catalog['switch-left'], parts[0]).find((port) => port.id === 'diverge')!;
  parts.push(attachTo('switch-right', 'w2', 2, through, 'stem'));
  parts.push(attachTo('switch-left', 'w3', 3, stem, 'through'));
  parts.push(attachTo('straight-16', 'leg', 4, diverge, 'a'));
  return analyzeLayout(parts, catalog, [], 'fixture.wye');
}

export function parkingSidingFixture(): TrackLayout {
  const parts: PlacedPart[] = [
    { instanceId: 's1', partId: 'switch-left', label: 1, x: 0, y: 0, rotation: 0 },
  ];
  const ports = worldPorts(catalog['switch-left'], parts[0]);
  const through = ports.find((port) => port.id === 'through')!;
  const diverge = ports.find((port) => port.id === 'diverge')!;
  const stem = ports.find((port) => port.id === 'stem')!;
  parts.push(attachTo('straight-16', 'main1', 2, through, 'a'));
  parts.push(attachTo('straight-16', 'main2', 3, stem, 'a'));
  const siding = attachTo('straight-16', 'sid1', 4, diverge, 'a');
  parts.push(siding);
  const sidingEnd = worldPorts(catalog['straight-16'], siding).find((port) => port.id === 'b')!;
  parts.push(attachTo('buffer-stop', 'buf1', 5, sidingEnd, 'a'));
  return analyzeLayout(parts, catalog, [], 'fixture.parking');
}

export function allFixtures(): { id: string; layout: TrackLayout }[] {
  return [
    { id: 'circle', layout: circleFixture() },
    { id: 'oval', layout: ovalFixture() },
    { id: 'switch-left', layout: switchFixture('left') },
    { id: 'crossing', layout: crossingFixture() },
    { id: 'double-crossover', layout: doubleCrossoverFixture() },
    { id: 'buffer', layout: bufferFixture() },
    { id: 'flex', layout: flexGapFixture() },
    { id: 'parking', layout: parkingSidingFixture() },
    { id: 'point-to-point', layout: pointToPointFixture() },
    { id: 'reverse-loop', layout: reversingLoopFixture() },
    { id: 'wye', layout: wyeFixture() },
  ];
}

export function fixtureCloses(layout: TrackLayout): boolean {
  return detectConnections(layout.parts, catalog).length > 0 && layout.parts.length > 1;
}

export { CITY_TRACKS };
