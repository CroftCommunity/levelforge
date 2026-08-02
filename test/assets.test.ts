import { describe, it, expect } from 'vitest';
import { resolveAssetRef } from '../src/levels-manifest';

const assets = {
  '/levels/arcade/backdrop.png': '/assets/backdrop-abc123.png',
  '/levels/arcade/sprites/blip.png': '/assets/blip-def456.png',
};

describe('resolveAssetRef', () => {
  const levelPath = '/levels/arcade/assets-demo.json';

  it('resolves a relative backdrop filename to its bundled URL', () => {
    expect(resolveAssetRef(levelPath, 'backdrop.png', assets)).toBe('/assets/backdrop-abc123.png');
  });
  it('resolves a nested sprite path', () => {
    expect(resolveAssetRef(levelPath, 'sprites/blip.png', assets)).toBe('/assets/blip-def456.png');
  });
  it('tolerates a leading ./', () => {
    expect(resolveAssetRef(levelPath, './backdrop.png', assets)).toBe('/assets/backdrop-abc123.png');
  });
  it('passes through data URLs untouched', () => {
    expect(resolveAssetRef(levelPath, 'data:image/png;base64,AA', assets)).toBe('data:image/png;base64,AA');
  });
  it('passes through absolute and remote URLs untouched', () => {
    expect(resolveAssetRef(levelPath, '/already/abs.png', assets)).toBe('/already/abs.png');
    expect(resolveAssetRef(levelPath, 'https://x/y.png', assets)).toBe('https://x/y.png');
  });
  it('returns null for a missing asset', () => {
    expect(resolveAssetRef(levelPath, 'nope.png', assets)).toBeNull();
  });
  it('returns null for empty refs', () => {
    expect(resolveAssetRef(levelPath, null, assets)).toBeNull();
    expect(resolveAssetRef(levelPath, undefined, assets)).toBeNull();
  });
});
