// === FILE PURPOSE ===
// Vite config for the Electron preload script build.
// Applies esbuild minification on production builds.
// Obfuscation is applied post-build in forge.config.ts packageAfterCopy hook.
// contextBridge method names are preserved so the renderer can access window.electronAPI.*.

import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    minify: 'esbuild',
  },
});
