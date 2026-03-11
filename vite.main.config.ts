// === FILE PURPOSE ===
// Vite config for the Electron main process build.
// Externalizes native Node.js addons that cannot be bundled by Vite.
// Obfuscation is applied post-build in forge.config.ts packageAfterCopy hook.

import { defineConfig } from 'vite';

export default defineConfig({
  define: {
    'process.env.SENTRY_DSN': JSON.stringify(process.env.SENTRY_DSN || ''),
  },
  build: {
    rollupOptions: {
      external: ['@fugood/whisper.node', '@electric-sql/pglite', 'tslib'],
    },
  },
});
