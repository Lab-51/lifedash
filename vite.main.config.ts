// === FILE PURPOSE ===
// Vite config for the Electron main process build.
// Externalizes native Node.js addons that cannot be bundled by Vite.
// Applies HIGH obfuscation on production builds to protect business logic.

import { defineConfig } from 'vite';
import obfuscatorPlugin from 'vite-plugin-javascript-obfuscator';

// IPC channel prefixes that must be preserved so main<->preload names stay in sync.
const IPC_RESERVED_STRINGS = [
  '^card-agent:',
  '^backup:',
  '^focus:',
  '^meetings:',
  '^license:',
  '^brainstorm:',
  '^recording:',
  '^whisper:',
  '^audio:',
  '^meeting:',
  '^db:',
  '^window:',
  '^app:',
  '^settings:',
  '^projects:',
  '^cards:',
  '^ideas:',
  '^task-structuring:',
  '^notifications:',
  '^transcription:',
  '^dashboard:',
  '^gamification:',
  '^enable-loopback',
  '^disable-loopback',
  'electronAPI',
];

export default defineConfig({
  build: {
    rollupOptions: {
      external: ['@fugood/whisper.node', '@electric-sql/pglite'],
    },
  },
  plugins: [
    obfuscatorPlugin({
      apply: 'build',
      options: {
        controlFlowFlattening: true,
        controlFlowFlatteningThreshold: 0.75,
        deadCodeInjection: true,
        deadCodeInjectionThreshold: 0.4,
        stringArray: true,
        stringArrayEncoding: ['rc4'],
        stringArrayThreshold: 0.75,
        splitStrings: true,
        splitStringsChunkLength: 10,
        identifierNamesGenerator: 'hexadecimal',
        renameGlobals: false,
        target: 'node',
        seed: 0,
        reservedStrings: IPC_RESERVED_STRINGS,
        reservedNames: [
          '^require$',
          '^module$',
          '^exports$',
          '^__dirname$',
          '^__filename$',
          '^process$',
          '^global$',
        ],
      },
    }),
  ],
});
