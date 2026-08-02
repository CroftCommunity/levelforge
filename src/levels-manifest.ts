/* =====================================================================
   levels-manifest.ts — committed levels + their assets as a build manifest.

   Everything under /levels/<scene>/<name>.json is the shared library. Image
   assets committed alongside a level — meta.backgroundSrc (a backdrop in the
   level folder) and object.sprite (a custom emoji skin, e.g. sprites/foo.png)
   — are bundled too and resolved to real URLs at load time, so the file-based
   asset form works end to end for committed content. (In-app authoring still
   writes inline dataURLs, since a static site can't write repo files.)
   ===================================================================== */

import { Level, loadLevel } from './schema';

export interface CommittedLevel {
  /** Repo-relative path, e.g. "/levels/starter/tower.json". */
  path: string;
  scene: string;
  name: string;
  level: Level;
}

// Level JSON, pulled in at build time.
const modules = import.meta.glob('/levels/**/*.json', {
  eager: true,
  import: 'default',
}) as Record<string, unknown>;

// Image assets committed under /levels, mapped path -> bundled URL.
const assetUrls = import.meta.glob('/levels/**/*.{png,jpg,jpeg,webp,gif,svg,avif}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

function parsePath(path: string): { scene: string; name: string } {
  const rel = path.replace(/^.*\/levels\//, '');
  const parts = rel.split('/');
  const file = parts.pop() || 'level.json';
  const name = file.replace(/\.json$/i, '');
  const scene = parts.join('/') || '(no scene)';
  return { scene, name };
}

/** Directory of a level path, e.g. "/levels/starter/tower.json" -> "/levels/starter". */
function dirOf(levelPath: string): string {
  return levelPath.replace(/\/[^/]*$/, '');
}

/**
 * Resolve an asset reference for a committed level to a bundled URL, or null.
 * Absolute/remote/inline refs (/, http(s):, data:) pass through untouched;
 * relative refs are resolved against the level's folder and looked up in the
 * bundled asset map. Pure and exported for testing.
 */
export function resolveAssetRef(
  levelPath: string,
  ref: string | null | undefined,
  assets: Record<string, string>,
): string | null {
  if (!ref) return null;
  if (/^(https?:|data:|blob:|\/)/i.test(ref)) return ref;
  // normalize "<dir>/<ref>" collapsing any leading "./"
  const rel = ref.replace(/^\.\//, '');
  const candidate = `${dirOf(levelPath)}/${rel}`;
  return assets[candidate] ?? null;
}

/** Rewrite a committed level's asset refs (backgroundSrc, sprites) to URLs. */
function resolveLevelAssets(path: string, level: Level): Level {
  if (level.meta.backgroundSrc) {
    const url = resolveAssetRef(path, level.meta.backgroundSrc, assetUrls);
    if (url) level.meta.backgroundSrc = url;
  }
  for (const o of level.objects) {
    if (o.sprite) {
      const url = resolveAssetRef(path, o.sprite, assetUrls);
      if (url) o.sprite = url;
    }
  }
  return level;
}

/** All committed levels, validated, with asset refs resolved to URLs. */
export function committedLevels(): CommittedLevel[] {
  const out: CommittedLevel[] = [];
  for (const [path, raw] of Object.entries(modules)) {
    try {
      const level = resolveLevelAssets(path, loadLevel(raw));
      const { scene, name } = parsePath(path);
      out.push({ path, scene, name, level });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`Skipping invalid committed level ${path}:`, (err as Error).message);
    }
  }
  out.sort((a, b) => a.scene.localeCompare(b.scene) || a.name.localeCompare(b.name));
  return out;
}
