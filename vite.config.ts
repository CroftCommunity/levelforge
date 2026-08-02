/// <reference types="vitest" />
import { defineConfig } from 'vite';

// LevelForge is a static, backend-free PWA. Committed levels under /levels are
// pulled into the bundle at build time via import.meta.glob (see
// src/levels-manifest.ts), so they ship inside the app shell and work offline
// with no extra fetch. Files in public/ (manifest, service worker, icons) are
// copied to the root of the build verbatim.
export default defineConfig({
  root: '.',
  base: './',
  build: {
    target: 'es2020',
    outDir: 'dist',
    sourcemap: true,
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
