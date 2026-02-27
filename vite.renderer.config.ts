// === FILE PURPOSE ===
// Vite config for the renderer process (React app).
// Includes React plugin and Tailwind CSS 4 via @tailwindcss/vite.
// Renderer is NOT obfuscated — Vite minification is sufficient, and obfuscation
// would harm React's runtime performance. Main/preload are obfuscated post-build.

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

export default defineConfig({
  root: path.resolve(__dirname, 'src/renderer'),
  plugins: [
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src/renderer'),
      '@shared': path.resolve(__dirname, 'src/shared'),
    },
  },
});
