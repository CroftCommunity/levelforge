/* =====================================================================
   organize.ts — pure sort / filter / tag helpers for the level shell.

   The shell shows every level the player has — committed (bundled) and local
   drafts — as a flat list of LevelEntry, then organizes it: hide archived
   unless asked, narrow by tag, and order by creation date, backdrop, or name.
   Kept pure (no DOM, no storage) so it is unit-testable; main.ts builds the
   entries from store + levels-manifest and renders the result.
   ===================================================================== */

import { Level } from './schema';
import { LevelSource } from './store';

export type SortKey = 'created' | 'background' | 'name';
export const SORT_KEYS: SortKey[] = ['created', 'background', 'name'];
export const SORT_LABELS: Record<SortKey, string> = {
  created: '🕑 newest',
  background: '🎨 backdrop',
  name: '🔤 name',
};

export interface LevelEntry {
  source: LevelSource;
  scene: string;
  name: string;
  level: Level;
  /** Draft creation time (ms). 0 when unknown, e.g. committed levels. */
  createdAt: number;
  archived: boolean;
  tags: string[];
}

/** Every distinct tag across the given entries, sorted for a stable filter row. */
export function allTags(entries: LevelEntry[]): string[] {
  const set = new Set<string>();
  for (const e of entries) for (const t of e.tags) set.add(t);
  return [...set].sort((a, b) => a.localeCompare(b));
}

export interface FilterOpts {
  showArchived: boolean;
  /** AND-match: an entry must carry every selected tag. Empty = no tag filter. */
  tags: string[];
}

export function filterEntries(entries: LevelEntry[], opts: FilterOpts): LevelEntry[] {
  return entries.filter((e) => {
    if (!opts.showArchived && e.archived) return false;
    if (opts.tags.length && !opts.tags.every((t) => e.tags.includes(t))) return false;
    return true;
  });
}

function compare(a: LevelEntry, b: LevelEntry, key: SortKey): number {
  if (key === 'created') {
    // Newest first; entries without a date (committed) fall to the bottom, then
    // break ties by name so ordering is deterministic.
    return b.createdAt - a.createdAt || a.name.localeCompare(b.name);
  }
  if (key === 'background') {
    return a.level.meta.background.localeCompare(b.level.meta.background) || a.name.localeCompare(b.name);
  }
  return a.name.localeCompare(b.name);
}

/** Sort a copy of entries by the chosen key (does not mutate the input). */
export function sortEntries(entries: LevelEntry[], key: SortKey): LevelEntry[] {
  return [...entries].sort((a, b) => compare(a, b, key));
}
