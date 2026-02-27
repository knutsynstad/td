import { describe, expect, it } from 'vitest';
import { snapToGrid } from './grid';

describe('snapToGrid', () => {
  it('snaps exact alignments', () => {
    expect(snapToGrid(0, 1)).toBe(0);
    expect(snapToGrid(5, 1)).toBe(5);
    expect(snapToGrid(10, 5)).toBe(10);
  });
  it('snaps halfway to nearest', () => {
    expect(snapToGrid(0.5, 1)).toBe(1);
    expect(snapToGrid(1.5, 1)).toBe(2);
  });
  it('handles negative values', () => {
    expect(snapToGrid(-1.5, 1)).toBe(-1); // JS rounds half toward +inf
    expect(snapToGrid(-2.5, 1)).toBe(-2);
  });
});
