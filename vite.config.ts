import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

/**
 * Build identity, injected so a playtest screenshot carries its own
 * provenance. GITHUB_SHA is set by Actions; local builds report 'dev'.
 */
const buildDefines = {
  __APP_VERSION__: JSON.stringify(process.env.GITHUB_SHA?.slice(0, 7) ?? 'dev'),
  __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
};

export default defineConfig({
  // Relative, so the same bundle works at a domain root and under a project
  // subpath such as /DeusVult/ on GitHub Pages.
  base: './',
  define: buildDefines,
  resolve: {
    alias: {
      '@core': fileURLToPath(new URL('./src/core', import.meta.url)),
      '@content': fileURLToPath(new URL('./src/content', import.meta.url)),
      '@render': fileURLToPath(new URL('./src/render', import.meta.url)),
      '@ui': fileURLToPath(new URL('./src/ui', import.meta.url)),
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    copyPublicDir: true,
  },
  server: { host: true, port: 5173 },
});
