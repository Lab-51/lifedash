// === FILE PURPOSE ===
// Vite config for the Electron main process build.
// Externalizes native Node.js addons that cannot be bundled by Vite.
// Obfuscation is applied post-build in forge.config.ts packageAfterCopy hook.

import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      external: ['@fugood/whisper.node', '@electric-sql/pglite'],
    },
  },
});
