import { TrackPart } from '../../shared/models/track';
import {
  CURVE_ANGLE,
  CURVE_RADIUS,
  CROSSOVER_LENGTH,
  CROSSOVER_SPACING,
  SWITCH_LENGTH,
  curveEnd,
  curveSector,
  rectangle,
  switchBranchFootprints,
  switchDivergeEnd,
  unionRectangles,
} from '../layout-engine/geometry';

const curve = curveEnd();
const leftDiverge = switchDivergeEnd(1);
const rightDiverge = switchDivergeEnd(-1);

export const CITY_TRACKS: TrackPart[] = [
  {
    id: 'straight-16',
    name: 'Straight 16',
    category: 'straight',
    hint: 'Standard 16-stud City straight.',
    legoIds: ['6070018'],
    color: '#0b5cab',
    ports: [
      { id: 'a', x: 0, y: 0, heading: 180 },
      { id: 'b', x: 16, y: 0, heading: 0 },
    ],
    footprint: rectangle(16, 8),
  },
  {
    id: 'curve-22',
    name: 'Curve 22.5°',
    category: 'curve',
    hint: '16 curves make a circle on an R40 centerline.',
    legoIds: ['4279717'],
    color: '#f5c518',
    ports: [
      { id: 'a', x: 0, y: 0, heading: 180 },
      { id: 'b', x: curve.x, y: curve.y, heading: CURVE_ANGLE },
    ],
    footprint: curveSector(CURVE_RADIUS, CURVE_ANGLE, 4, 1, 1),
  },
  {
    id: 'switch-left',
    name: 'Left switch',
    category: 'switch',
    hint: '32-stud through plus an S-curve branch. Add a curve to run parallel.',
    legoIds: ['6085213'],
    color: '#2d7a3a',
    ports: [
      { id: 'stem', x: 0, y: 0, heading: 180 },
      { id: 'through', x: SWITCH_LENGTH, y: 0, heading: 0 },
      { id: 'diverge', x: leftDiverge.x, y: leftDiverge.y, heading: CURVE_ANGLE },
    ],
    footprint: rectangle(SWITCH_LENGTH, 8),
    extraFootprints: switchBranchFootprints(1),
  },
  {
    id: 'switch-right',
    name: 'Right switch',
    category: 'switch',
    hint: '32-stud through plus an S-curve branch. Add a curve to run parallel.',
    legoIds: ['6085188'],
    color: '#1f7a4d',
    ports: [
      { id: 'stem', x: 0, y: 0, heading: 180 },
      { id: 'through', x: SWITCH_LENGTH, y: 0, heading: 0 },
      { id: 'diverge', x: rightDiverge.x, y: rightDiverge.y, heading: 360 - CURVE_ANGLE },
    ],
    footprint: rectangle(SWITCH_LENGTH, 8),
    extraFootprints: switchBranchFootprints(-1),
  },
  {
    id: 'crossing-90',
    name: '90° crossing',
    category: 'crossing',
    hint: 'Two routes cross; they do not join.',
    legoIds: ['57779'],
    color: '#c91a1a',
    ports: [
      { id: 'east', x: 8, y: 0, heading: 0 },
      { id: 'west', x: -8, y: 0, heading: 180 },
      { id: 'north', x: 0, y: 8, heading: 90 },
      { id: 'south', x: 0, y: -8, heading: 270 },
    ],
    footprint: unionRectangles([rectangle(16, 8, -8), rectangle(8, 16, -4, -8)]),
  },
  {
    id: 'double-crossover',
    name: 'Double crossover',
    category: 'double-crossover',
    hint: 'Two 60128 halves from set 7996-1. Assembled 48×24 studs; parallel tracks 16 studs apart.',
    color: '#6b3fa0',
    ports: [
      { id: 'a', x: -CROSSOVER_LENGTH / 2, y: 0, heading: 180 },
      { id: 'b', x: CROSSOVER_LENGTH / 2, y: 0, heading: 0 },
      { id: 'c', x: -CROSSOVER_LENGTH / 2, y: CROSSOVER_SPACING, heading: 180 },
      { id: 'd', x: CROSSOVER_LENGTH / 2, y: CROSSOVER_SPACING, heading: 0 },
    ],
    footprint: rectangle(CROSSOVER_LENGTH, CROSSOVER_SPACING + 8, -CROSSOVER_LENGTH / 2, -4),
  },
  {
    id: 'flex-track',
    name: 'Flexible track',
    category: 'flex',
    hint: 'Fills a small gap when rigid pieces almost meet.',
    legoIds: ['4535745'],
    color: '#e67a17',
    ports: [
      { id: 'a', x: 0, y: 0, heading: 180 },
      { id: 'b', x: 16, y: 0, heading: 0 },
    ],
    footprint: rectangle(16, 8),
    flex: {
      lengthStuds: 16,
      minChordStuds: 6,
      maxBendDegrees: 50,
    },
  },
];

export const CITY_TRACKS_BY_ID = Object.fromEntries(CITY_TRACKS.map((part) => [part.id, part]));
