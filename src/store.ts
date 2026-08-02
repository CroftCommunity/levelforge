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
  level: Level;
}

const DRAFT_PREFIX = 'lf:draft:';
const WORKING_KEY = 'lf:working';

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

export function saveDraft(name: string, scene: string, level: Level): boolean {
  const rec: DraftRecord = { name, scene: scene || '', savedAt: Date.now(), level };
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
