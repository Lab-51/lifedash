// === FILE PURPOSE ===
// Electron Forge configuration — defines build targets, makers, and plugins.

import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import * as fs from 'node:fs';
import * as path from 'node:path';

// Packages that Vite externalizes (not bundled) and must be copied
// into the packaged app manually, since the Forge Vite plugin only
// includes .vite/build/ output — not node_modules.
const EXTERNAL_PACKAGES = ['@electric-sql/pglite'];

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    // Extract PGlite from the asar so its WASM binary loads as a real file
    asarUnpack: ['**/node_modules/@electric-sql/pglite/**'],
    extraResource: ['./drizzle'],
  },
  rebuildConfig: {},
  hooks: {
    // Copy externalized packages into the staging directory before asar creation.
    // The Forge Vite plugin bundles all code into .vite/build/ but excludes
    // packages listed in rollupOptions.external — those need node_modules.
    packageAfterCopy: async (_config, buildPath) => {
      // 1. Copy externalized packages (Vite keeps require() calls but
      //    Forge Vite plugin doesn't include node_modules in the asar)
      for (const dep of EXTERNAL_PACKAGES) {
        const src = path.join(__dirname, 'node_modules', dep);
        const dest = path.join(buildPath, 'node_modules', dep);
        fs.cpSync(src, dest, { recursive: true });
      }

      // 2. Copy renderer build output. The Forge Vite plugin outputs
      //    renderer files under src/renderer/.vite/ (because the renderer
      //    config sets root: 'src/renderer'), but the packager expects
      //    them at .vite/renderer/ relative to the app root.
      const rendererSrc = path.join(__dirname, 'src', 'renderer', '.vite', 'renderer');
      const rendererDest = path.join(buildPath, '.vite', 'renderer');
      if (fs.existsSync(rendererSrc)) {
        fs.cpSync(rendererSrc, rendererDest, { recursive: true });
      }
    },
  },
  makers: [
    new MakerSquirrel({}),
    new MakerZIP({}, ['darwin']),
  ],
  plugins: [
    new VitePlugin({
      // Main process and preload script builds
      build: [
        {
          entry: 'src/main/main.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'src/main/workers/transcriptionWorker.ts',
          config: 'vite.main.config.ts',
        },
        {
          entry: 'src/preload/preload.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
      ],
      // Renderer process (React app)
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.ts',
        },
      ],
    }),
    // Fuses control Electron security features at package time
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
