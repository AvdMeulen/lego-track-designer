import { FloorPlan, cloneFloorPlan, defaultFloorPlan } from '../../shared/models/floor-plan';
import { InventoryItem } from '../../shared/models/track';

export const AGENT_EVAL_SCENE = 'eval';

export const AGENT_EVAL_INVENTORY: InventoryItem[] = [
  { partId: 'straight-16', quantity: 58 },
  { partId: 'curve-22', quantity: 97 },
  { partId: 'switch-left', quantity: 2 },
  { partId: 'switch-right', quantity: 2 },
  { partId: 'double-crossover', quantity: 1 },
  { partId: 'flex-track', quantity: 12 },
];

export const AGENT_EVAL_FLOOR_PLAN: FloorPlan = {
  ...defaultFloorPlan(),
  id: 'room-eval',
  name: 'Eval L',
  outer: {
    id: 'outer',
    points: [
      { x: -163.6, y: 93.8 },
      { x: 227.2, y: 93.8 },
      { x: 227.2, y: 264.5 },
      { x: 329.8, y: 264.5 },
      { x: 329.8, y: 419.9 },
      { x: -163.6, y: 419.9 },
    ],
  },
  obstacles: [
    {
      id: 'obs-1',
      points: [
        { x: -4.8, y: 197.7 },
        { x: 120.2, y: 197.7 },
        { x: 120.2, y: 298.0 },
        { x: -4.8, y: 298.0 },
      ],
    },
  ],
};

export function agentEvalScene(): { inventory: InventoryItem[]; floorPlan: FloorPlan } {
  return {
    inventory: AGENT_EVAL_INVENTORY.map((item) => ({ ...item })),
    floorPlan: cloneFloorPlan(AGENT_EVAL_FLOOR_PLAN),
  };
}
