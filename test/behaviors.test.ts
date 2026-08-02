import { describe, it, expect } from 'vitest';
import { behaviorFor, EXPLOSION } from '../src/play/behaviors';
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
  it('has a sane explosion envelope (lethal < radius)', () => {
    expect(EXPLOSION.lethalRadius).toBeLessThan(EXPLOSION.radius);
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
