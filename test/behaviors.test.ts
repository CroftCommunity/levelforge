import { describe, it, expect } from 'vitest';
import { behaviorFor, EXPLOSION, EFFECTS, HIT_BEHAVIORS } from '../src/play/behaviors';
import { impactOf, breaksAt } from '../src/play/break-model';
import { searchEmoji } from '../src/editor/emoji-data';
import { LevelObject } from '../src/schema';

function emoji(over: Partial<LevelObject> = {}): LevelObject {
  return { id: 'o1', shape: 'emoji', x: 0, y: 0, r: 20, angle: 0, material: 'target', anchored: false, path: null, note: '', emoji: '🎃', ...over } as LevelObject;
}

describe('behaviorFor', () => {
  it('maps bomb emojis to explode', () => {
    expect(behaviorFor(emoji({ emoji: '💣' }))).toBe('explode');
    expect(behaviorFor(emoji({ emoji: '🧨' }))).toBe('explode');
  });
  it('returns null for an ordinary emoji', () => {
    expect(behaviorFor(emoji({ emoji: '🎃' }))).toBeNull();
  });
  it('honors an explicit hit override', () => {
    expect(behaviorFor(emoji({ emoji: '🎃', hit: 'explode' }))).toBe('explode');
  });
  it('treats an unknown hit key as no behavior', () => {
    expect(behaviorFor(emoji({ emoji: '🎃', hit: 'freeze' }))).toBeNull();
  });
  it('resolves each of the new effect keys', () => {
    for (const key of HIT_BEHAVIORS) {
      expect(behaviorFor(emoji({ emoji: '🎃', hit: key }))).toBe(key);
    }
    expect(behaviorFor(emoji({ emoji: '🎃', hit: 'pop' }))).toBe('pop');
    expect(behaviorFor(emoji({ emoji: '🎃', hit: 'confetti' }))).toBe('confetti');
  });
  it('honors an explicit "none" sentinel that suppresses an inferred effect', () => {
    // a bomb glyph normally infers explode; "none" turns it off
    expect(behaviorFor(emoji({ emoji: '💣' }))).toBe('explode');
    expect(behaviorFor(emoji({ emoji: '💣', hit: 'none' }))).toBeNull();
  });
  it('has a sane explosion envelope (lethal < radius)', () => {
    expect(EXPLOSION.lethalRadius).toBeLessThan(EXPLOSION.radius);
  });
  it('every effect key has a complete spec, and only explode shoves/detonates', () => {
    for (const key of HIT_BEHAVIORS) {
      const spec = EFFECTS[key];
      expect(spec.key).toBe(key);
      expect(spec.icon.length).toBeGreaterThan(0);
      expect(spec.label.length).toBeGreaterThan(0);
      expect(spec.blurb.length).toBeGreaterThan(0);
      expect(spec.count).toBeGreaterThan(0);
      expect(spec.rMax).toBeGreaterThanOrEqual(spec.rMin);
      if (key !== 'explode') {
        expect(spec.shove).toBe(false);
        expect(spec.detonate).toBe(false);
      }
    }
    expect(EFFECTS.explode.shove).toBe(true);
    expect(EFFECTS.explode.detonate).toBe(true);
  });
  it('a blast at close range detonates a fragile target (via break model)', () => {
    // Represent a shove as a relative speed; a nearby villain (breakAt 3.2)
    // should break when the blast imparts enough velocity into a static hit.
    const impact = impactOf(30, Infinity, true); // 30 * 0.55 = 16.5
    expect(breaksAt(impact, 3.2)).toBe(true);
  });
});

describe('searchEmoji', () => {
  it('finds emoji by keyword', () => {
    expect(searchEmoji('bomb')).toContain('💣');
    expect(searchEmoji('cat')).toContain('🐱');
    expect(searchEmoji('star')).toContain('⭐');
  });
  it('requires all tokens to match', () => {
    expect(searchEmoji('sea animal')).toContain('🐙');
    expect(searchEmoji('sea unicorn')).toHaveLength(0);
  });
  it('returns nothing for an empty query', () => {
    expect(searchEmoji('')).toEqual([]);
  });
});
