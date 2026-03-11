// === FILE PURPOSE ===
// Vite config for the Electron main process build.
// Externalizes native Node.js addons that cannot be bundled by Vite.
// Obfuscation is applied post-build in forge.config.ts packageAfterCopy hook.

import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  define: {
    'process.env.SENTRY_DSN': JSON.stringify(process.env.SENTRY_DSN || ''),
  },
  resolve: {
    alias: {
      // tslib is a transitive dep of @supabase/* but npm doesn't hoist it
      // to top-level node_modules; vendored copy ensures reliable bundling.
      tslib: path.resolve(__dirname, 'vendor/tslib.es6.js'),
    },
  },
  build: {
    rollupOptions: {
      external: ['@fugood/whisper.node', '@electric-sql/pglite'],
    },
  },
});
