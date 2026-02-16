# Security Architecture

Living Dashboard is a local-first desktop application. All data stays on your machine by default. Cloud services are opt-in only.

## Data Flow Summary

```
┌─────────────────────────────────────────────────────────┐
│                    YOUR MACHINE                          │
│                                                          │
│  System Audio ──► audioCaptureService (Web Audio API)    │
│                         │                                │
│                    PCM chunks (IPC)                       │
│                         │                                │
│                   audioProcessor                         │
│                    │          │                           │
│              Save WAV    transcriptionService             │
│           (if enabled)    │          │                    │
│                     Local Whisper   Cloud API ──────────────► Deepgram / AssemblyAI
│                      (default)     (opt-in)              │        (if configured)
│                           │                              │
│                    PGlite Database                        │
│                    (embedded WASM)                        │
│                                                          │
│  AI Brainstorm / Meeting Summary ────────────────────────────► OpenAI / Anthropic / Kimi
│                                     (user-initiated)     │        (if configured)
│                                                          │
│  Ollama ◄──► localhost:11434 (never leaves machine)      │
└─────────────────────────────────────────────────────────┘
```

## What Leaves the Machine

| Destination | Data | Trigger | Default |
|------------|------|---------|---------|
| Deepgram API | Raw PCM audio (10s chunks) | User selects as transcription provider | OFF |
| AssemblyAI API | WAV audio files | User selects as transcription provider | OFF |
| OpenAI API | Text prompts, transcript text | User requests AI generation | OFF |
| Anthropic API | Text prompts, transcript text | User requests AI generation | OFF |
| Kimi/Moonshot API | Text prompts, messages | User requests AI generation | OFF |
| HuggingFace | Nothing (model download only) | User clicks "Download Model" | OFF |
| Ollama | Prompts to localhost only | User selects as AI provider | OFF |

**Telemetry: None.** No analytics, crash reporting, usage tracking, or auto-update phone-home.

## What Never Leaves the Machine

- Audio recordings (WAV files)
- Project/board/card data
- Meeting metadata and action items
- Brainstorming ideas
- API keys (encrypted at rest, decrypted in-memory only)
- Device/hardware information
- User identity or location

## API Key Protection

Keys are encrypted using Electron's `safeStorage` API, which delegates to OS-level credential storage:

| Platform | Backend |
|----------|---------|
| Windows | DPAPI (Data Protection API) |
| macOS | Keychain |
| Linux | libsecret |

**Storage flow:**
1. User enters API key in Settings UI (renderer process)
2. Key sent to main process via IPC
3. Main process encrypts via `safeStorage.encryptString()` → base64
4. Encrypted string stored in PGlite database
5. Decrypted on-demand in main process only, for API calls
6. Renderer process only sees `hasApiKey: boolean` — never the raw key

**Backup safety:** API keys are explicitly excluded from backup exports via a `SENSITIVE_COLUMNS` filter in the backup service.

## Electron Hardening

### Process Isolation

```
Renderer Process (untrusted)
  ├── contextIsolation: true
  ├── nodeIntegration: false
  ├── No access to Node.js APIs
  └── Communicates via preload bridge only
          │
     contextBridge.exposeInMainWorld('electronAPI', ...)
          │
Main Process (trusted)
  ├── All IPC handlers validate input via Zod schemas
  ├── API keys decrypted here only
  └── All filesystem/network operations happen here
```

### Content Security Policy

**Production:**
```
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';
img-src 'self' data:;
font-src 'self';
connect-src 'self'
  https://api.openai.com
  https://api.anthropic.com
  https://api.deepgram.com
  https://api.assemblyai.com
  http://localhost:11434;
```

No inline scripts. No `eval`. Only whitelisted API domains for network connections.

### Electron Fuses

Hardened at package time via `@electron/fuses`:

| Fuse | Setting | Effect |
|------|---------|--------|
| RunAsNode | Disabled | Prevents `ELECTRON_RUN_AS_NODE` bypass |
| CookieEncryption | Enabled | Encrypts session cookies |
| NodeOptionsEnvironmentVariable | Disabled | Blocks `NODE_OPTIONS` injection |
| NodeCliInspectArguments | Disabled | Blocks `--inspect` debugging |
| EmbeddedAsarIntegrityValidation | Enabled | Validates ASAR hasn't been tampered |
| OnlyLoadAppFromAsar | Enabled | Prevents loading code from outside ASAR |

### Additional Controls

- **Single instance lock** — prevents multiple app instances
- **No remote module** — `@electron/remote` not used
- **No WebView/BrowserView** — single BrowserWindow only
- **No protocol handlers** — no custom URI schemes registered
- **No auto-updater** — no update server or phone-home mechanism

## Input Validation

All IPC parameters are validated against Zod schemas before processing:

```typescript
// Example: every handler validates input
ipcMain.handle('meetings:get', async (_event, id: unknown) => {
  const validId = validateInput(idParamSchema, id);
  return meetingService.getMeeting(validId);
});
```

- 50+ Zod schemas covering all IPC channels
- File path operations use whitelist checks (`path.resolve` + `startsWith`)
- Binary audio chunks are the only unvalidated IPC data (performance constraint)

## File System Access

| Location | Contents | Protection |
|----------|----------|------------|
| `%APPDATA%/Living Dashboard/` | PGlite database, whisper models | OS user permissions |
| `%APPDATA%/Living Dashboard/recordings/` | WAV files (if saving enabled) | OS user permissions |
| `%APPDATA%/Living Dashboard/backups/` | JSON backup files (no API keys) | OS user permissions |
| `%APPDATA%/Living Dashboard/attachments/` | Card attachments | Path traversal protection |

Attachment access uses explicit path validation:
```typescript
const resolved = path.resolve(filePath);
if (!resolved.startsWith(attachmentsRoot)) {
  throw new Error('Access denied: path outside attachments directory');
}
```

## Third-Party Dependencies

### Runtime (packaged in app)

| Package | Purpose | Network Access |
|---------|---------|---------------|
| `@electric-sql/pglite` | Embedded PostgreSQL | None |
| `@fugood/whisper.node` | Local speech-to-text | None |
| `electron-audio-loopback` | System audio capture | None |
| `wavefile` | WAV encoding | None |
| `ai` + `@ai-sdk/*` | AI provider abstraction | To configured providers only |
| `ollama-ai-provider` | Ollama wrapper | localhost only |
| `drizzle-orm` | SQL query builder | None |
| `zod` | Input validation | None |
| `undici` | HTTP client (proxy support) | Passive (used by fetch) |
| `react`, `react-dom`, `react-router-dom` | UI framework | None |
| `zustand` | State management | None |
| `@tiptap/*` | Rich text editor | None |
| `@atlaskit/pragmatic-drag-and-drop` | Drag and drop | None |
| `lucide-react` | Icons | None |
| `react-markdown`, `remark-gfm` | Markdown rendering | None |

### Build-only (not in packaged app)

`@electron-forge`, `vite`, `tailwindcss`, `typescript`, `vitest`, `drizzle-kit`, etc. These are development dependencies and are not included in the distributed application.

## Reporting Vulnerabilities

If you discover a security vulnerability, please report it by opening an issue on the GitHub repository. For sensitive disclosures, use GitHub's private vulnerability reporting feature.
