import { describe, it, expect, beforeEach } from 'vitest';
import { emptyLevel } from '../src/schema';
import {
  manageKey,
  normalizeTags,
  getManage,
  setManage,
  setArchived,
  setTags,
  pruneManage,
  saveDraft,
  getDraft,
  deleteDraft,
} from '../src/store';

// The test env is `node`, so window.localStorage throws and store.ts falls back
// to its in-memory Map. That map persists across a module instance, so each test
// clears the keys it touches up front.

describe('manageKey', () => {
  it('keys drafts by name and committed by scene/name', () => {
    expect(manageKey('draft', 'ignored', 'my-level')).toBe('d:my-level');
    expect(manageKey('committed', 'arcade', 'boom')).toBe('c:arcade/boom');
  });
});

describe('normalizeTags', () => {
  it('trims, drops empties, and dedupes case-insensitively keeping first casing', () => {
    expect(normalizeTags([' Boss ', 'boss', '', 'Hard'])).toEqual(['Boss', 'Hard']);
  });
  it('caps tag length and count', () => {
    const long = 'x'.repeat(50);
    expect(normalizeTags([long])[0].length).toBe(24);
    const many = Array.from({ length: 30 }, (_, i) => `t${i}`);
    expect(normalizeTags(many).length).toBe(12);
  });
});

describe('management overlay', () => {
  const key = manageKey('draft', '', 'overlay-test');
  beforeEach(() => pruneManage(key));

  it('defaults to not-archived with no tags', () => {
    expect(getManage(key)).toEqual({ archived: false, tags: [] });
  });
  it('round-trips archived + tags', () => {
    setManage(key, { archived: true, tags: ['boss', 'wip'] });
    expect(getManage(key)).toEqual({ archived: true, tags: ['boss', 'wip'] });
  });
  it('setArchived and setTags update independently', () => {
    setTags(key, ['a', 'b']);
    setArchived(key, true);
    expect(getManage(key)).toEqual({ archived: true, tags: ['a', 'b'] });
    setArchived(key, false);
    expect(getManage(key)).toEqual({ archived: false, tags: ['a', 'b'] });
  });
  it('prune clears an entry back to default', () => {
    setArchived(key, true);
    pruneManage(key);
    expect(getManage(key)).toEqual({ archived: false, tags: [] });
  });
});

describe('draft createdAt', () => {
  const name = 'created-at-test';
  beforeEach(() => deleteDraft(name));

  it('stamps createdAt on first save and preserves it across re-saves', () => {
    saveDraft(name, 'scene', emptyLevel());
    const first = getDraft(name)!;
    expect(typeof first.createdAt).toBe('number');
    const created = first.createdAt!;
    // Re-save with a changed level; createdAt must not move.
    const l = emptyLevel();
    l.meta.name = name;
    saveDraft(name, 'scene', l);
    expect(getDraft(name)!.createdAt).toBe(created);
  });

  it('deleteDraft also prunes its management overlay', () => {
    saveDraft(name, 'scene', emptyLevel());
    setTags(manageKey('draft', '', name), ['temp']);
    deleteDraft(name);
    expect(getManage(manageKey('draft', '', name)).tags).toEqual([]);
  });
});
