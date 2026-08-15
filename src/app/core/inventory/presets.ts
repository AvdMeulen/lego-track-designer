export interface InventoryPreset {
  id: string;
  name: string;
  description: string;
  quantities: Record<string, number>;
}

export const INVENTORY_PRESETS: InventoryPreset[] = [
  {
    id: 'circle',
    name: '16-curve circle',
    description: 'Classic closed circle.',
    quantities: { 'curve-22': 16 },
  },
  {
    id: 'oval',
    name: 'Oval',
    description: '8 curves and 8 straights.',
    quantities: { 'curve-22': 8, 'straight-16': 8 },
  },
  {
    id: 'yard',
    name: 'Yard starter',
    description: 'Loop pieces, one switch, parking, and flex margin.',
    quantities: {
      'curve-22': 12,
      'straight-16': 6,
      'switch-left': 1,
      'flex-track': 2,
    },
  },
  {
    id: 'flex-pack',
    name: 'Track pack with flex',
    description: 'Straights, curves, and flexible gap closers.',
    quantities: { 'straight-16': 8, 'curve-22': 4, 'flex-track': 8 },
  },
];
