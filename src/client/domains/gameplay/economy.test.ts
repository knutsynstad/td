import { describe, expect, it } from 'vitest';
import { getUpgradeCoinCost, getRepairCost, getRepairStatus } from './economy';

describe('getUpgradeCoinCost', () => {
  it('returns range cost', () => {
    expect(getUpgradeCoinCost('range')).toBeGreaterThan(0);
  });

  it('returns damage cost', () => {
    expect(getUpgradeCoinCost('damage')).toBeGreaterThan(0);
  });

  it('returns speed cost', () => {
    expect(getUpgradeCoinCost('speed')).toBeGreaterThan(0);
  });
});

describe('getRepairCost', () => {
  it('returns 0 for fully healthy structures', () => {
    expect(
      getRepairCost({ hp: 100, maxHp: 100, cumulativeBuildCost: 10 })
    ).toBe(0);
  });

  it('returns 0 when maxHp is 0', () => {
    expect(getRepairCost({ hp: 0, maxHp: 0 })).toBe(0);
  });

  it('returns positive cost for damaged structures', () => {
    expect(
      getRepairCost({ hp: 50, maxHp: 100, cumulativeBuildCost: 20 })
    ).toBeGreaterThan(0);
  });

  it('increases cost with more damage', () => {
    const lightDamage = getRepairCost({
      hp: 90,
      maxHp: 100,
      cumulativeBuildCost: 20,
    });
    const heavyDamage = getRepairCost({
      hp: 10,
      maxHp: 100,
      cumulativeBuildCost: 20,
    });
    expect(heavyDamage).toBeGreaterThanOrEqual(lightDamage);
  });
});

describe('getRepairStatus', () => {
  it('returns healthy for full hp', () => {
    expect(getRepairStatus(100, 100)).toBe('healthy');
  });

  it('returns critical for very low hp', () => {
    expect(getRepairStatus(1, 100)).toBe('critical');
  });

  it('returns needs_repair for moderate damage', () => {
    expect(getRepairStatus(50, 100)).toBe('needs_repair');
  });

  it('returns healthy when maxHp is 0', () => {
    expect(getRepairStatus(0, 0)).toBe('healthy');
  });
});
