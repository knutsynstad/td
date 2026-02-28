import { describe, expect, it } from 'vitest';
import { TrackedMap } from './trackedMap';

describe('TrackedMap', () => {
  it('tracks upserts', () => {
    const map = new TrackedMap<number>();
    map.set('a', 1);
    map.set('b', 2);
    expect(map.upserted).toEqual(new Set(['a', 'b']));
    expect(map.removed.size).toBe(0);
  });

  it('tracks deletes', () => {
    const map = TrackedMap.fromRecord({ a: 1, b: 2 });
    map.delete('a');
    expect(map.removed).toEqual(new Set(['a']));
    expect(map.upserted.size).toBe(0);
  });

  it('delete after set cancels the upsert', () => {
    const map = new TrackedMap<number>();
    map.set('a', 1);
    map.delete('a');
    expect(map.upserted.size).toBe(0);
    expect(map.removed.size).toBe(0);
  });

  it('set after delete cancels the remove', () => {
    const map = TrackedMap.fromRecord({ a: 1 });
    map.delete('a');
    map.set('a', 2);
    expect(map.removed.size).toBe(0);
    expect(map.upserted).toEqual(new Set(['a']));
  });

  it('fromRecord does not track initial entries', () => {
    const map = TrackedMap.fromRecord({ a: 1, b: 2, c: 3 });
    expect(map.size).toBe(3);
    expect(map.upserted.size).toBe(0);
    expect(map.removed.size).toBe(0);
  });

  it('toRecord converts back to a plain object', () => {
    const map = TrackedMap.fromRecord({ x: 10, y: 20 });
    expect(map.toRecord()).toEqual({ x: 10, y: 20 });
  });

  it('resetTracking clears change sets', () => {
    const map = TrackedMap.fromRecord({ a: 1 });
    map.set('b', 2);
    map.delete('a');
    expect(map.hasChanges).toBe(true);
    map.resetTracking();
    expect(map.upserted.size).toBe(0);
    expect(map.removed.size).toBe(0);
    expect(map.hasChanges).toBe(false);
  });

  it('clear tracks all keys as removed', () => {
    const map = TrackedMap.fromRecord({ a: 1, b: 2 });
    map.clear();
    expect(map.size).toBe(0);
    expect(map.removed).toEqual(new Set(['a', 'b']));
    expect(map.upserted.size).toBe(0);
  });

  it('delete on non-existent key does not track removal', () => {
    const map = new TrackedMap<number>();
    map.delete('ghost');
    expect(map.removed.size).toBe(0);
  });

  it('hasChanges reflects mutation state', () => {
    const map = new TrackedMap<number>();
    expect(map.hasChanges).toBe(false);
    map.set('a', 1);
    expect(map.hasChanges).toBe(true);
  });
});
