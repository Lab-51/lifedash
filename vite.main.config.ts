// === FILE PURPOSE ===
// Vite config for the Electron main process build.
// Externalizes native Node.js addons that cannot be bundled by Vite.
// Obfuscation is applied post-build in forge.config.ts packageAfterCopy hook.

import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  define: {
    'process.env.SENTRY_DSN': JSON.stringify(process.env.SENTRY_DSN || ''),
    'process.env.OFFICIAL_BUILD': JSON.stringify(process.env.OFFICIAL_BUILD || ''),
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
      // Externalize @electric-sql/pglite AND its subpath exports (e.g.
      // '@electric-sql/pglite/vector'). The vector extension resolves its
      // bundle via `new URL('../vector.tar.gz', import.meta.url|__filename)`;
      // if Vite bundles the subpath it rewrites that into a broken `data:` URL,
      // so `CREATE EXTENSION vector` fails at runtime ("Extension bundle not
      // found" → migration 0041 aborts). Keeping the whole package external
      // makes it resolve from node_modules where vector.tar.gz sits next to it.
      external: [/^@electric-sql\/pglite(\/.*)?$/, '@fugood/whisper.node', 'canvas'],
    },
  },
});
