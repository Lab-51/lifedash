// === FILE PURPOSE ===
// Vite config for the renderer process (React app).
// Includes React plugin and Tailwind CSS 4 via @tailwindcss/vite.
// Applies LOW obfuscation on production builds (no control flow / dead code to preserve React perf).

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import obfuscatorPlugin from 'vite-plugin-javascript-obfuscator';

export default defineConfig({
  root: path.resolve(__dirname, 'src/renderer'),
  plugins: [
    react(),
    tailwindcss(),
    obfuscatorPlugin({
      apply: 'build',
      options: {
        controlFlowFlattening: false,
        deadCodeInjection: false,
        stringArray: true,
        stringArrayEncoding: ['base64'],
        stringArrayThreshold: 0.5,
        identifierNamesGenerator: 'hexadecimal',
        renameGlobals: false,
        target: 'browser',
        seed: 0,
        reservedStrings: ['electronAPI'],
        reservedNames: ['^__REACT', '^__SECRET', '^electronAPI$'],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src/renderer'),
      '@shared': path.resolve(__dirname, 'src/shared'),
    },
  },
});
