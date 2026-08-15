import { exportSvgElementToPng } from './png-export';

describe('exportSvgElementToPng', () => {
  it('is a function that accepts an SVG element', () => {
    expect(typeof exportSvgElementToPng).toBe('function');
  });
});
