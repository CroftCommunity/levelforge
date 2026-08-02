import { describe, it, expect } from 'vitest';
import {
  impactOf,
  breaksAt,
  STATIC_IMPACT_FACTOR,
  DYNAMIC_IMPACT_FACTOR,
  MASS_CAP,
} from '../src/play/break-model';
import { MATERIALS } from '../src/materials';

describe('impactOf', () => {
  it('scales by 0.55 against a static partner (ignores mass)', () => {
    expect(impactOf(20, 999, true)).toBeCloseTo(20 * STATIC_IMPACT_FACTOR);
    expect(impactOf(20, 1, true)).toBeCloseTo(20 * STATIC_IMPACT_FACTOR);
  });
  it('scales by mass against a moving partner', () => {
    expect(impactOf(20, 3, false)).toBeCloseTo(20 * 3 * DYNAMIC_IMPACT_FACTOR);
  });
  it('caps the contributing mass', () => {
    const capped = impactOf(20, MASS_CAP, false);
    expect(impactOf(20, 1000, false)).toBeCloseTo(capped);
  });
});

describe('breaksAt', () => {
  it('never breaks unbreakable materials (null)', () => {
    expect(breaksAt(1e6, null)).toBe(false);
    expect(breaksAt(1e6, MATERIALS.metal.breakAt)).toBe(false);
    expect(breaksAt(1e6, MATERIALS.rubber.breakAt)).toBe(false);
  });
  it('breaks strictly above the threshold', () => {
    expect(breaksAt(9.0, 9)).toBe(false);
    expect(breaksAt(9.001, 9)).toBe(true);
  });

  it('models the ice-on-floor settle bug: a light floor tap must NOT break fresh ice', () => {
    // Ice breakAt 6.5. A soft landing at ~10 units/s onto the static floor:
    const impact = impactOf(10, Infinity, true); // 10 * 0.55 = 5.5
    expect(breaksAt(impact, MATERIALS.ice.breakAt)).toBe(false);
    // But a hard slam does break it:
    const hard = impactOf(20, Infinity, true); // 11 > 6.5
    expect(breaksAt(hard, MATERIALS.ice.breakAt)).toBe(true);
  });

  it('a heavy fast stone shatters a target', () => {
    const impact = impactOf(15, 8, false); // 15 * 8 * 0.3 = 36
    expect(breaksAt(impact, MATERIALS.target.breakAt)).toBe(true);
  });
});
