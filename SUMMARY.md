# Plan K.1 Summary — Dev-only Figma Capture via Browser

## Date: 2026-02-24
## Status: COMPLETE (2/2 tasks)

## What Changed

### Task 1: Vite plugin for Figma capture mode
- **File:** `vite.renderer.config.ts`
- Added `figmaCapturePlugin()` — dev-serve-only Vite plugin gated behind `FIGMA_CAPTURE` env var
- Injects a Proxy-based `window.electronAPI` mock that handles all 258 IPC methods automatically:
  - `platform`/`appVersion`: static values
  - `on*` listeners: return cleanup function
  - `get*` data fetchers: return `Promise.resolve([])`
  - Everything else: return `Promise.resolve(null)`
- Injects the Figma HTML-to-Design capture script (`capture.js`)
- Conditionally spread into plugins array — zero overhead when not in capture mode

### Task 2: npm script + cross-env
- **File:** `package.json`
- Installed `cross-env@^10.1.0` as devDependency (cross-platform env var support)
- Added script: `"figma:capture": "cross-env FIGMA_CAPTURE=1 electron-forge start"`

## Usage
```bash
npm run figma:capture
# Then open http://localhost:5173 in Chrome for Figma capture
```

## Production Impact: NONE
- Plugin uses `apply: 'serve'` and conditional spread — never in production builds
- `npm start` and `npm run make` completely unaffected

## Verification
- TypeScript: clean (zero errors)

## Next Step
Manual verification: run `npm run figma:capture`, open Chrome to localhost:5173, use Figma MCP to capture
