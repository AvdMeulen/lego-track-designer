import { TrackPart } from '../../shared/models/track';
import { CURVE_ANGLE, CURVE_RADIUS, curveEnd, curveSector, rectangle, unionRectangles } from '../layout-engine/geometry';

const curve = curveEnd();
const leftDiverge = curveEnd(CURVE_RADIUS, CURVE_ANGLE, 1);
const rightDiverge = curveEnd(CURVE_RADIUS, CURVE_ANGLE, -1);

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
    hint: 'Through route plus an R40 diverge to the left.',
    legoIds: ['6085213'],
    color: '#2d7a3a',
    ports: [
      { id: 'stem', x: 0, y: 0, heading: 180 },
      { id: 'through', x: 16, y: 0, heading: 0 },
      { id: 'diverge', x: leftDiverge.x, y: leftDiverge.y, heading: CURVE_ANGLE },
    ],
    footprint: rectangle(16, 8),
    extraFootprints: [curveSector(CURVE_RADIUS, CURVE_ANGLE, 4, 1, 1)],
  },
  {
    id: 'switch-right',
    name: 'Right switch',
    category: 'switch',
    hint: 'Through route plus an R40 diverge to the right.',
    legoIds: ['6085188'],
    color: '#1f7a4d',
    ports: [
      { id: 'stem', x: 0, y: 0, heading: 180 },
      { id: 'through', x: 16, y: 0, heading: 0 },
      { id: 'diverge', x: rightDiverge.x, y: rightDiverge.y, heading: 360 - CURVE_ANGLE },
    ],
    footprint: rectangle(16, 8),
    extraFootprints: [curveSector(CURVE_RADIUS, CURVE_ANGLE, 4, -1, 1)],
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
    hint: 'Set 7996-1. Joins two parallel tracks 8 studs apart.',
    color: '#6b3fa0',
    ports: [
      { id: 'a', x: -16, y: 0, heading: 180 },
      { id: 'b', x: 16, y: 0, heading: 0 },
      { id: 'c', x: -16, y: 8, heading: 180 },
      { id: 'd', x: 16, y: 8, heading: 0 },
    ],
    footprint: rectangle(32, 16, -16, -4),
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
