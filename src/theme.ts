/* Theme preference model — pure helpers, no DOM.
 *
 * The app chrome ships two palettes (dark is the original look, light is the
 * daylight set in index.html under `html[data-theme='light']`). The user pref
 * is three-state: explicit dark, explicit light, or `auto` following the OS
 * `prefers-color-scheme`. `dark` stays the default so the app looks exactly
 * as it always has until someone opts in via ⚙ Settings.
 *
 * DOM application lives in main.ts (sets `data-theme` on <html>, refreshes
 * the canvas letterbox color and the `theme-color` meta); an inline script in
 * index.html mirrors resolveTheme() before first paint to avoid a flash.
 */

export type ThemePref = 'dark' | 'light' | 'auto';
export type ResolvedTheme = 'dark' | 'light';

export const DEFAULT_THEME: ThemePref = 'dark';

/** Anything that isn't an explicit valid pref falls back to the default. */
export function normalizeTheme(v: unknown): ThemePref {
  return v === 'light' || v === 'auto' || v === 'dark' ? v : DEFAULT_THEME;
}

/** Settings-button cycle: dark → light → auto → dark. */
export function cycleTheme(t: ThemePref): ThemePref {
  return t === 'dark' ? 'light' : t === 'light' ? 'auto' : 'dark';
}

/** The palette actually applied, given the pref and the OS scheme. */
export function resolveTheme(pref: ThemePref, systemDark: boolean): ResolvedTheme {
  if (pref === 'auto') return systemDark ? 'dark' : 'light';
  return pref;
}

/** Label for the ⚙ Settings button; auto shows what it currently resolves to. */
export function themeLabel(pref: ThemePref, systemDark: boolean): string {
  if (pref === 'dark') return '🌙 dark';
  if (pref === 'light') return '☀️ light';
  return `🌗 auto — system (${resolveTheme(pref, systemDark)})`;
}
