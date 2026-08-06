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
const AUTOSAVE_PREF_KEY = 'lf:autosave';

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
/* Autosave persists the *whole* forge session to the local browser: the
   current level plus its full undo/redo replay history, so a reload (or an
   offline PWA relaunch) drops you back exactly where you were, history and
   all. Nothing leaves the device — offline creation and edit jitter make a
   local snapshot the only dependable plan. */

/** The complete forge session. `undo`/`redo` are the same JSON strings the
    editor keeps on its stacks (each a serialized Level), newest last. */
export interface WorkingState {
  level: Level;
  undo: string[];
  redo: string[];
  savedAt: number;
}

/** Try to write a value into real localStorage, distinguishing three outcomes:
    'ok' (persisted), 'quota' (localStorage works but this value didn't fit —
    trimming may help), and 'unavailable' (no usable localStorage at all —
    trimming won't help, keep the value in session memory instead). */
function trySetPersistent(key: string, value: string): 'ok' | 'quota' | 'unavailable' {
  try {
    window.localStorage.setItem(key, value);
    return 'ok';
  } catch {
    // Did the write fail because storage is full, or because it isn't there?
    try {
      const probe = '__lf_probe__';
      window.localStorage.setItem(probe, '1');
      window.localStorage.removeItem(probe);
      return 'quota';
    } catch {
      return 'unavailable';
    }
  }
}

/** Persist the working session (level + replay history).

    localStorage is finite and inline backdrops can be large, so writing 80
    history frames can blow quota. Rather than let autosave silently die, we
    shed replay history oldest-first until it fits, keeping the current level.
    When localStorage is absent entirely (private mode, disabled), we keep the
    full session in the in-memory fallback instead of needlessly discarding
    history. Returns true only when persisted to real localStorage. */
export function saveWorking(state: WorkingState): boolean {
  const payload = (undo: string[], redo: string[]): string =>
    JSON.stringify({ v: 2, level: state.level, undo, redo, savedAt: state.savedAt });
  let undo = state.undo;
  let redo = state.redo;

  const first = trySetPersistent(WORKING_KEY, payload(undo, redo));
  if (first === 'ok') return true;
  if (first === 'unavailable') {
    memory.set(WORKING_KEY, payload(undo, redo));
    return false;
  }
  // 'quota': trim the replay history to make room — drop the oldest undo frame
  // first, then the newest redo frame — and retry until it fits.
  while (undo.length || redo.length) {
    if (undo.length) undo = undo.slice(1);
    else redo = redo.slice(0, -1);
    if (trySetPersistent(WORKING_KEY, payload(undo, redo)) === 'ok') return true;
  }
  // Even the bare level didn't fit persistently; keep it in session memory.
  memory.set(WORKING_KEY, payload([], []));
  return false;
}

/** Load the autosaved session, or null if none / invalid. Accepts the legacy
    shape (a bare Level, pre-history) so older autosaves still restore. */
export function loadWorkingState(): WorkingState | null {
  const raw = safeGet(WORKING_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    const strings = (v: unknown): string[] =>
      Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : [];
    if (parsed && typeof parsed === 'object' && (parsed as { v?: number }).v === 2) {
      const p = parsed as { level: unknown; undo?: unknown; redo?: unknown; savedAt?: unknown };
      return {
        level: loadLevel(p.level),
        undo: strings(p.undo),
        redo: strings(p.redo),
        savedAt: typeof p.savedAt === 'number' ? p.savedAt : 0,
      };
    }
    // Legacy: the value was a bare serialized Level.
    return { level: loadLevel(parsed), undo: [], redo: [], savedAt: 0 };
  } catch {
    return null;
  }
}

/** Drop the autosaved session entirely. */
export function clearWorking(): void {
  safeDelete(WORKING_KEY);
}

/* --------------------------- autosave toggle ------------------------ */

/** Whether autosave is enabled. Defaults ON (checked) when never set. */
export function loadAutosavePref(): boolean {
  return safeGet(AUTOSAVE_PREF_KEY) !== '0';
}

export function saveAutosavePref(on: boolean): void {
  safeSet(AUTOSAVE_PREF_KEY, on ? '1' : '0');
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
