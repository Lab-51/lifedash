// === FILE PURPOSE ===
// Electron Forge configuration — defines build targets, makers, and plugins.

import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
// import { MakerWix } from '@electron-forge/maker-wix';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PublisherGithub } from '@electron-forge/publisher-github';
import { obfuscate as jsObfuscate } from 'javascript-obfuscator';

// IPC channel prefixes and renderer bridge identifiers that must NOT be
// renamed by the obfuscator — Electron's ipcMain.handle / ipcRenderer.invoke
// match on exact string values, so these must be preserved verbatim.
const IPC_RESERVED_STRINGS = [
  'brainstorm', 'backup', 'meetings', 'cards', 'labels', 'card',
  'card-agent', 'project-agent', 'card-templates', 'window', 'recording', 'ideas', 'idea',
  'ai', 'focus', 'db', 'dashboard', 'whisper', 'gamification', 'app',
  'projects', 'boards', 'columns', 'settings', 'transcription', 'license',
  'audio', 'electronAPI', 'contextBridge',
];

// Packages that Vite externalizes (not bundled) and must be copied
// into the packaged app manually, since the Forge Vite plugin only
// includes .vite/build/ output — not node_modules.
const EXTERNAL_PACKAGES = [
  '@electric-sql/pglite',
  '@fugood/whisper.node',
  // Platform-specific whisper binaries — only the current platform's
  // package exists in node_modules (installed as optionalDependency).
  // The copy loop below skips missing packages gracefully.
  '@fugood/node-whisper-win32-x64',
  '@fugood/node-whisper-darwin-x64',
  '@fugood/node-whisper-darwin-arm64',
];

const config: ForgeConfig = {
  packagerConfig: {
    icon: './src/assets/icon',
    asar: true,
    // Extract PGlite from the asar so its WASM binary loads as a real file
    // @ts-ignore
    asarUnpack: ['**/node_modules/@electric-sql/pglite/**'],
    extraResource: ['./drizzle', './src/assets/icon.png'],
    // macOS code signing — only active when APPLE_IDENTITY env var is set.
    // Requires Apple Developer account ($99/year) and valid signing certificate.
    // On macOS: generate .icns from icon.png using `iconutil` or `png2icns`.
    ...(process.env.APPLE_IDENTITY ? {
      osxSign: {
        identity: process.env.APPLE_IDENTITY,
      },
    } : {}),
    // macOS notarization — only active when APPLE_ID env var is set.
    // Required for distributing outside the Mac App Store on Catalina+.
    ...(process.env.APPLE_ID ? {
      osxNotarize: {
        appleId: process.env.APPLE_ID,
        appleIdPassword: process.env.APPLE_PASSWORD!,
        teamId: process.env.APPLE_TEAM_ID!,
      },
    } : {}),
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
        if (!fs.existsSync(src)) continue; // Skip platform-specific packages not installed on this OS
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

      // 3. Post-build obfuscation of main and preload bundles.
      //    This runs AFTER Vite+Rollup produces the final single-file bundles,
      //    so cross-module references are already resolved — safe to obfuscate.
      //    Renderer is intentionally excluded (React perf + already minified).
      if (process.env.SKIP_OBFUSCATION === 'true') {
        console.log('Skipping obfuscation (SKIP_OBFUSCATION=true)');
      } else {
        // HIGH protection for main process (business logic, IPC handlers)
        const mainJsPath = path.join(buildPath, '.vite', 'build', 'main.js');
        if (fs.existsSync(mainJsPath)) {
          console.log('Obfuscating main.js...');
          const mainSource = fs.readFileSync(mainJsPath, 'utf-8');
          const obfuscatedMain = jsObfuscate(mainSource, {
            target: 'node',
            compact: true,
            controlFlowFlattening: true,
            controlFlowFlatteningThreshold: 0.5,
            deadCodeInjection: true,
            deadCodeInjectionThreshold: 0.3,
            stringArray: true,
            stringArrayEncoding: ['rc4'],
            stringArrayThreshold: 0.75,
            identifierNamesGenerator: 'hexadecimal',
            renameGlobals: false,
            reservedStrings: IPC_RESERVED_STRINGS,
            reservedNames: ['^require$', '^module$', '^exports$', '^__dirname$', '^__filename$'],
          });
          fs.writeFileSync(mainJsPath, obfuscatedMain.getObfuscatedCode(), 'utf-8');
          console.log('main.js obfuscated.');
        } else {
          console.warn('main.js not found at expected path — skipping obfuscation.');
        }

        // MEDIUM protection for preload (no control flow — keep it fast)
        const preloadJsPath = path.join(buildPath, '.vite', 'build', 'preload.js');
        if (fs.existsSync(preloadJsPath)) {
          console.log('Obfuscating preload.js...');
          const preloadSource = fs.readFileSync(preloadJsPath, 'utf-8');
          const obfuscatedPreload = jsObfuscate(preloadSource, {
            target: 'node',
            compact: true,
            controlFlowFlattening: false,
            stringArray: true,
            stringArrayEncoding: ['base64'],
            stringArrayThreshold: 0.75,
            identifierNamesGenerator: 'hexadecimal',
            renameGlobals: false,
            reservedStrings: IPC_RESERVED_STRINGS,
            reservedNames: ['^require$', '^module$', '^exports$', '^contextBridge$', '^ipcRenderer$'],
          });
          fs.writeFileSync(preloadJsPath, obfuscatedPreload.getObfuscatedCode(), 'utf-8');
          console.log('preload.js obfuscated.');
        } else {
          console.warn('preload.js not found at expected path — skipping obfuscation.');
        }
      }
    },
  },
  makers: [
    new MakerSquirrel(
      process.env.CERT_PASSWORD
        ? {
          certificateFile: './certs/living-dashboard.pfx',
          certificatePassword: process.env.CERT_PASSWORD,
        }
        : {
          setupIcon: './src/assets/icon.ico',
        },
    ),
    new MakerZIP({}, ['darwin']),
    new MakerDMG({
      format: 'ULFO',
      name: 'LifeDash',
    }),
    // WiX MSI maker — requires WiX Toolset installed (candle.exe + light.exe).
    // Uncomment when WiX is available for enterprise MSI distribution.
    // new MakerWix({
    //   name: 'LifeDash',
    //   manufacturer: 'LifeDash',
    //   upgradeCode: '570d3454-6859-4ff3-9f24-385a00bcc551',
    //   ui: {
    //     chooseDirectory: true,
    //   },
    // }),
  ],
  publishers: [
    new PublisherGithub({
      repository: { owner: 'Lab-51', name: 'lifedash' },
      prerelease: false,
      draft: true, // Creates draft release — review on GitHub before publishing
    }),
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
        // transcriptionWorker removed — whisper now runs in-process
        // via native Napi::AsyncWorker (non-blocking)
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
