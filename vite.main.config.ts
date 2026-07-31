// === FILE PURPOSE ===
// Vite config for the Electron main process build.
// Externalizes native Node.js addons that cannot be bundled by Vite.
// Obfuscation is applied post-build in forge.config.ts packageAfterCopy hook.

import { defineConfig, loadEnv } from 'vite';
import path from 'path';

// Load env from process.env AND gitignored local .env files (dev). Empty prefix ('')
// loads ALL keys; real process.env values (CI secrets) take precedence over .env files,
// so official builds are unaffected while local dev can supply values via a .env file.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
  define: {
    'process.env.SENTRY_DSN': JSON.stringify(env.SENTRY_DSN || ''),
    'process.env.OFFICIAL_BUILD': JSON.stringify(env.OFFICIAL_BUILD || ''),
    // Embedded calendar OAuth client credentials (Phase G). Sourced from the build
    // environment (gitignored local .env in dev, CI secrets in official builds).
    // Empty when unset — fork/dev builds still compile and run, just with Connect
    // disabled until the user pastes their own via calendar:set-client-config.
    'process.env.GOOGLE_CALENDAR_CLIENT_ID': JSON.stringify(env.GOOGLE_CALENDAR_CLIENT_ID || ''),
    'process.env.GOOGLE_CALENDAR_CLIENT_SECRET': JSON.stringify(env.GOOGLE_CALENDAR_CLIENT_SECRET || ''),
    'process.env.MICROSOFT_CALENDAR_CLIENT_ID': JSON.stringify(env.MICROSOFT_CALENDAR_CLIENT_ID || ''),
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
  };
});
