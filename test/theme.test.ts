import { describe, it, expect } from 'vitest';
import { DEFAULT_THEME, normalizeTheme, cycleTheme, resolveTheme, themeLabel } from '../src/theme';

describe('theme pref model', () => {
  it('defaults to dark (the original look) and normalizes junk to it', () => {
    expect(DEFAULT_THEME).toBe('dark');
    expect(normalizeTheme(undefined)).toBe('dark');
    expect(normalizeTheme(null)).toBe('dark');
    expect(normalizeTheme('LIGHT')).toBe('dark');
    expect(normalizeTheme(42)).toBe('dark');
    expect(normalizeTheme('system')).toBe('dark');
  });

  it('keeps explicit valid prefs', () => {
    expect(normalizeTheme('dark')).toBe('dark');
    expect(normalizeTheme('light')).toBe('light');
    expect(normalizeTheme('auto')).toBe('auto');
  });

  it('cycles dark → light → auto → dark', () => {
    expect(cycleTheme('dark')).toBe('light');
    expect(cycleTheme('light')).toBe('auto');
    expect(cycleTheme('auto')).toBe('dark');
  });

  it('resolves explicit prefs regardless of the OS scheme', () => {
    expect(resolveTheme('dark', false)).toBe('dark');
    expect(resolveTheme('light', true)).toBe('light');
  });

  it('resolves auto from the OS scheme', () => {
    expect(resolveTheme('auto', true)).toBe('dark');
    expect(resolveTheme('auto', false)).toBe('light');
  });

  it('labels auto with what it currently resolves to', () => {
    expect(themeLabel('dark', false)).toBe('🌙 dark');
    expect(themeLabel('light', true)).toBe('☀️ light');
    expect(themeLabel('auto', true)).toContain('(dark)');
    expect(themeLabel('auto', false)).toContain('(light)');
  });
});
