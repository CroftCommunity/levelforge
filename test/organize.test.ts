import { describe, it, expect } from 'vitest';
import { emptyLevel, BackgroundKind } from '../src/schema';
import { LevelEntry, allTags, filterEntries, sortEntries } from '../src/organize';

function entry(over: Partial<LevelEntry> & { name: string }): LevelEntry {
  return {
    source: 'draft',
    scene: 'test',
    level: emptyLevel(),
    createdAt: 0,
    archived: false,
    tags: [],
    ...over,
  };
}

function withBg(name: string, bg: BackgroundKind): LevelEntry {
  const level = emptyLevel();
  level.meta.background = bg;
  return entry({ name, level });
}

describe('allTags', () => {
  it('collects distinct tags sorted', () => {
    const entries = [entry({ name: 'a', tags: ['boss', 'easy'] }), entry({ name: 'b', tags: ['easy', 'wip'] })];
    expect(allTags(entries)).toEqual(['boss', 'easy', 'wip']);
  });
  it('is empty when no tags', () => {
    expect(allTags([entry({ name: 'a' })])).toEqual([]);
  });
});

describe('filterEntries', () => {
  const list = [
    entry({ name: 'plain' }),
    entry({ name: 'old', archived: true }),
    entry({ name: 'tagged', tags: ['boss', 'hard'] }),
  ];

  it('hides archived by default', () => {
    const out = filterEntries(list, { showArchived: false, tags: [] });
    expect(out.map((e) => e.name)).toEqual(['plain', 'tagged']);
  });
  it('includes archived when asked', () => {
    const out = filterEntries(list, { showArchived: true, tags: [] });
    expect(out.map((e) => e.name)).toEqual(['plain', 'old', 'tagged']);
  });
  it('AND-matches every selected tag', () => {
    expect(filterEntries(list, { showArchived: true, tags: ['boss'] }).map((e) => e.name)).toEqual(['tagged']);
    expect(filterEntries(list, { showArchived: true, tags: ['boss', 'hard'] }).map((e) => e.name)).toEqual(['tagged']);
    expect(filterEntries(list, { showArchived: true, tags: ['boss', 'nope'] })).toEqual([]);
  });
});

describe('sortEntries', () => {
  it('created: newest first, dateless (0) sink to the bottom then break ties by name', () => {
    const list = [
      entry({ name: 'zebra', createdAt: 0 }),
      entry({ name: 'apple', createdAt: 0 }),
      entry({ name: 'older', createdAt: 100 }),
      entry({ name: 'newest', createdAt: 300 }),
    ];
    expect(sortEntries(list, 'created').map((e) => e.name)).toEqual(['newest', 'older', 'apple', 'zebra']);
  });
  it('background: groups by backdrop then name', () => {
    const list = [withBg('s1', 'sky'), withBg('g2', 'grass'), withBg('g1', 'grass'), withBg('c1', 'cave')];
    expect(sortEntries(list, 'background').map((e) => e.name)).toEqual(['c1', 'g1', 'g2', 's1']);
  });
  it('name: alphabetical', () => {
    const list = [entry({ name: 'c' }), entry({ name: 'a' }), entry({ name: 'b' })];
    expect(sortEntries(list, 'name').map((e) => e.name)).toEqual(['a', 'b', 'c']);
  });
  it('does not mutate the input array', () => {
    const list = [entry({ name: 'b' }), entry({ name: 'a' })];
    const before = list.map((e) => e.name);
    sortEntries(list, 'name');
    expect(list.map((e) => e.name)).toEqual(before);
  });
});
