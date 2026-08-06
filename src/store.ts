/* =====================================================================
   store.ts — local persistence and import/export.

   Three layers of persistence in the deployed PWA (SPEC section 8):
     - local drafts + working-level autosave  -> here (localStorage)
     - committed levels under /levels/         -> levels-manifest.ts
     - exchange (copy / paste / download)      -> here + schema.ts

   localStorage can throw (private mode, quota, disabled), so every access is
   guarded and falls back to an in-memory Map for the session.
   ===================================================================== */

import { Level, loadLevel } from './schema';

export interface DraftRecord {
  name: string;
  scene: string;
  savedAt: number;
  /** When the draft was first created. Older drafts predate this field, so
      consumers fall back to `savedAt`. */
  createdAt?: number;
  level: Level;
}

const DRAFT_PREFIX = 'lf:draft:';
const WORKING_KEY = 'lf:working';
const MANAGE_KEY = 'lf:manage';

const memory = new Map<string, string>();

function safeGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return memory.has(key) ? memory.get(key)! : null;
  }
}
function safeSet(key: string, value: string): boolean {
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    memory.set(key, value);
    return false;
  }
}
function safeDelete(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    memory.delete(key);
  }
}
function safeKeys(): string[] {
  try {
    const out: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k) out.push(k);
    }
    return out;
  } catch {
    return [...memory.keys()];
  }
}

/** True when a real localStorage is backing the store (else session-only memory). */
export function hasPersistentStore(): boolean {
  try {
    const probe = '__lf_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

const draftKey = (name: string) => DRAFT_PREFIX + encodeURIComponent(name);

/* ---------------------- working-level autosave ---------------------- */

export function autosaveWorking(level: Level): void {
  safeSet(WORKING_KEY, JSON.stringify(level));
}

/** Load the autosaved working level, or null if none / invalid. */
export function loadWorking(): Level | null {
  const raw = safeGet(WORKING_KEY);
  if (!raw) return null;
  try {
    return loadLevel(JSON.parse(raw));
  } catch {
    return null;
  }
}

/* ---------------------------- named drafts -------------------------- */

/** Read one draft by name (with its createdAt), or null. */
export function getDraft(name: string): DraftRecord | null {
  const raw = safeGet(draftKey(name));
  if (!raw) return null;
  try {
    const rec = JSON.parse(raw) as DraftRecord;
    rec.level = loadLevel(rec.level);
    return rec;
  } catch {
    return null;
  }
}

export function saveDraft(name: string, scene: string, level: Level): boolean {
  const now = Date.now();
  // Preserve the original creation time across re-saves of the same name.
  const createdAt = getDraft(name)?.createdAt ?? now;
  const rec: DraftRecord = { name, scene: scene || '', savedAt: now, createdAt, level };
  return safeSet(draftKey(name), JSON.stringify(rec));
}

export function listDrafts(): DraftRecord[] {
  const out: DraftRecord[] = [];
  for (const k of safeKeys()) {
    if (!k.startsWith(DRAFT_PREFIX)) continue;
    const raw = safeGet(k);
    if (!raw) continue;
    try {
      const rec = JSON.parse(raw) as DraftRecord;
      // Revalidate the embedded level so a corrupt draft can't crash the library.
      rec.level = loadLevel(rec.level);
      out.push(rec);
    } catch {
      /* skip corrupt entries */
    }
  }
  out.sort((a, b) => b.savedAt - a.savedAt);
  return out;
}

export function deleteDraft(name: string): void {
  safeDelete(draftKey(name));
  // Drop any orphaned management overlay (archive/tags) for this draft.
  pruneManage(manageKey('draft', '', name));
}

/* ----------------------- management overlay ------------------------- */
/* Per-level organization state (archived flag + tags) kept OUTSIDE the level
   JSON so it applies uniformly to both committed levels (read-only, bundled)
   and local drafts, and so toggling a tag never rewrites a draft that may
   carry a heavy inline backdrop. Keyed by a stable identity string. */

export type LevelSource = 'committed' | 'draft';

export interface LevelManage {
  archived: boolean;
  tags: string[];
}

const MAX_TAGS = 12;
const MAX_TAG_LEN = 24;

/** Stable overlay key. Drafts are keyed by name (their storage key); committed
    levels by scene/name (their bundle path identity). */
export function manageKey(source: LevelSource, scene: string, name: string): string {
  return source === 'draft' ? `d:${name}` : `c:${scene}/${name}`;
}

/** Trim, drop empties, cap length, and dedupe tags case-insensitively
    (keeping the first casing seen). */
export function normalizeTags(tags: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of tags) {
    const t = String(raw).trim().slice(0, MAX_TAG_LEN);
    if (!t) continue;
    const lc = t.toLowerCase();
    if (seen.has(lc)) continue;
    seen.add(lc);
    out.push(t);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

function loadManageMap(): Record<string, LevelManage> {
  const raw = safeGet(MANAGE_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Record<string, LevelManage> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      const e = v as { archived?: unknown; tags?: unknown };
      out[k] = {
        archived: !!e?.archived,
        tags: Array.isArray(e?.tags) ? normalizeTags(e!.tags as string[]) : [],
      };
    }
    return out;
  } catch {
    return {};
  }
}

function saveManageMap(map: Record<string, LevelManage>): void {
  safeSet(MANAGE_KEY, JSON.stringify(map));
}

/** Current overlay for a key — always a defined record (default: not archived,
    no tags), so callers never branch on undefined. */
export function getManage(key: string): LevelManage {
  const e = loadManageMap()[key];
  return { archived: !!e?.archived, tags: e?.tags ? [...e.tags] : [] };
}

/** Write the overlay for a key; an empty (default) record is dropped so the
    map stays small and clean. */
export function setManage(key: string, next: LevelManage): void {
  const map = loadManageMap();
  const tags = normalizeTags(next.tags);
  if (!next.archived && tags.length === 0) delete map[key];
  else map[key] = { archived: !!next.archived, tags };
  saveManageMap(map);
}

export function setArchived(key: string, archived: boolean): void {
  setManage(key, { ...getManage(key), archived });
}

export function setTags(key: string, tags: string[]): void {
  setManage(key, { ...getManage(key), tags });
}

export function pruneManage(key: string): void {
  const map = loadManageMap();
  if (key in map) {
    delete map[key];
    saveManageMap(map);
  }
}

/* ------------------------------ download ---------------------------- */

/** Trigger a .json download of the level in the browser. */
export function downloadLevel(level: Level, filename?: string): void {
  const name = (filename || level.meta.name || 'level').replace(/[^\w.-]+/g, '_');
  const blob = new Blob([JSON.stringify(level, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name.endsWith('.json') ? name : `${name}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
