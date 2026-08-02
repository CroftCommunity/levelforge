/* =====================================================================
   levels-manifest.ts — committed levels as a build-time manifest.

   Everything under /levels/<scene>/<name>.json is the shared library. We
   pull those files into the bundle at build time with import.meta.glob, so
   they ship inside the app shell (offline-ready, no runtime fetch) and Claude
   can author them as ordinary files in the repo.
   ===================================================================== */

import { Level, loadLevel } from './schema';

export interface CommittedLevel {
  /** Repo-relative path, e.g. "/levels/starter/tower.json". */
  path: string;
  scene: string;
  name: string;
  level: Level;
}

// Vite replaces this with a map of path -> parsed JSON at build time.
const modules = import.meta.glob('/levels/**/*.json', {
  eager: true,
  import: 'default',
}) as Record<string, unknown>;

function parsePath(path: string): { scene: string; name: string } {
  // /levels/<scene>/<name>.json  (name may itself contain slashes -> flatten)
  const rel = path.replace(/^.*\/levels\//, '');
  const parts = rel.split('/');
  const file = parts.pop() || 'level.json';
  const name = file.replace(/\.json$/i, '');
  const scene = parts.join('/') || '(no scene)';
  return { scene, name };
}

/** All committed levels, validated. Invalid files are skipped with a warning. */
export function committedLevels(): CommittedLevel[] {
  const out: CommittedLevel[] = [];
  for (const [path, raw] of Object.entries(modules)) {
    try {
      const level = loadLevel(raw);
      const { scene, name } = parsePath(path);
      out.push({ path, scene, name, level });
    } catch (err) {
      // A malformed committed level must not take down the library.
      // eslint-disable-next-line no-console
      console.warn(`Skipping invalid committed level ${path}:`, (err as Error).message);
    }
  }
  out.sort((a, b) => a.scene.localeCompare(b.scene) || a.name.localeCompare(b.name));
  return out;
}
