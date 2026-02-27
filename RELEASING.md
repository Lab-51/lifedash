# Releasing LifeDash

## Prerequisites

1. **GitHub Token** — create a personal access token with `repo` scope:
   - Go to https://github.com/settings/tokens
   - Generate new token (classic) with `repo` scope
   - Set it as an environment variable: `export GITHUB_TOKEN=ghp_...`

2. **Version bump** — update `version` in `package.json` before each release:
   ```bash
   # Example: 2.0.0 → 2.1.0
   npm version minor   # or: npm version patch / npm version major
   ```

3. **Code signing (optional)**:
   - **Windows**: Set `CERT_PASSWORD` env var (requires `certs/living-dashboard.pfx`)
   - **macOS**: Set `APPLE_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`

## Release Workflow

### 1. Bump version and push to both remotes

```bash
npm version patch          # bumps 2.0.0 → 2.0.1 (also creates a git tag)

# Push to both remotes:
#   origin → Lab-51/living-dashboard (private, full history)
#   public → Lab-51/lifedash (customer-facing, where releases are published)
git push origin main && git push origin --tags
git push public main && git push public --tags
```

> **Important:** Forge publishes releases to `Lab-51/lifedash`. If you only push to `origin`, the release will have mismatched source archives.

### 2. Build and publish

```bash
# Full release (with obfuscation):
GITHUB_TOKEN=ghp_... npm run publish

# Fast test build (skip obfuscation):
GITHUB_TOKEN=ghp_... SKIP_OBFUSCATION=true npm run publish
```

This will:
- Build the app (Vite + Electron Forge)
- Create installer artifacts (LifeDash-X.X.X.exe, .nupkg, RELEASES)
- Upload them as a **draft** release to https://github.com/Lab-51/lifedash/releases

### 3. Review and publish the release

1. Go to https://github.com/Lab-51/lifedash/releases
2. Find the draft release
3. Edit the release notes (describe what changed)
4. Click **Publish release**

### 4. Users auto-update

Once published:
- Existing installations check for updates **every hour**
- When an update is found, it downloads silently in the background
- An **in-app toast** appears: "Update vX.X.X ready — restart to install"
- User clicks **Restart Now** to apply the update immediately
- If dismissed, the update applies on next app restart

## What Gets Published

| Platform | Artifact | Purpose |
|----------|----------|---------|
| Windows | `LifeDash-X.X.X.exe` | Squirrel installer for new installs |
| Windows | `lifedash-X.X.X-full.nupkg` | Delta update package for existing installs |
| Windows | `RELEASES` | Update manifest (Squirrel checks this) |
| macOS | `LifeDash.dmg` | DMG installer for new installs |
| macOS | `LifeDash-darwin-x64-X.X.X.zip` | ZIP for Squirrel.Mac auto-update |

## How Auto-Update Works

```
update-electron-app (in main process)
    ↓ checks every hour
https://update.electronjs.org/Lab-51/lifedash/{platform}/{version}
    ↓ proxies to
GitHub Releases API → finds latest release with matching platform assets
    ↓ downloads
Squirrel applies update on next restart
    ↓ notifies
In-app toast: "Update vX.X.X ready — restart to install"
```

## Commands Reference

| Command | What it does |
|---------|-------------|
| `npm run start` | Run in development mode |
| `npm run package` | Create unpacked app (no installer) |
| `npm run make` | Create installer locally (no upload) |
| `npm run publish` | Build + upload to GitHub Releases |
| `npm run make:icons` | Regenerate .ico and .icns from icon.png |
| `npm run verify:package` | Run 18 packaging checks |

## Troubleshooting

**"GITHUB_TOKEN not set"**
→ Set the environment variable: `export GITHUB_TOKEN=ghp_...`

**Squirrel error on Windows**
→ Make sure `src/assets/icon.ico` exists. Run `npm run make:icons` if missing.

**Update not detected by users**
→ Check that the release is **published** (not draft). Draft releases are invisible to the auto-updater.

**macOS "app is damaged" error**
→ The app isn't code-signed. Set `APPLE_IDENTITY` env var for signing, or tell users to run:
`xattr -cr /Applications/LifeDash.app`

---

## Customer Installation Guide

### Windows

1. Download `LifeDash-X.X.X.exe` from the [Releases page](https://github.com/Lab-51/lifedash/releases)
2. Run it — LifeDash installs silently and launches automatically
3. A desktop shortcut and Start Menu entry are created automatically

**Install location:** `C:\Users\<username>\AppData\Local\lifedash\`
**No admin rights required** — Squirrel installs per-user, not system-wide.

### macOS

1. Download `LifeDash.dmg` from the [Releases page](https://github.com/Lab-51/lifedash/releases)
2. Open the DMG and drag **LifeDash** to the **Applications** folder
3. Launch from Applications

If macOS shows "app is damaged" or "can't be opened" (unsigned build):
```bash
xattr -cr /Applications/LifeDash.app
```

### First Launch

On first launch:
- The embedded database (PGlite) initializes automatically — no external database needed
- A **Setup Wizard** guides through AI provider configuration (API keys for OpenAI, Anthropic, or Ollama)
- API keys are encrypted locally using Electron's safeStorage — they never leave the machine
- The Whisper speech model can be downloaded from Settings for local transcription

### Auto-Updates

LifeDash checks for updates automatically every hour:

1. The app silently downloads the update in the background
2. A notification appears in the title bar: **"Update vX.X.X ready"**
3. Click **Restart Now** to apply immediately
4. If dismissed, the update applies on the next app restart

Updates are pulled from GitHub Releases via [update.electronjs.org](https://update.electronjs.org). Only **published** releases (not drafts) are visible to the auto-updater.

**Windows:** Squirrel handles delta updates — only changed files are downloaded, not the entire app.
**macOS:** The full ZIP is downloaded and replaces the app bundle.

### Uninstalling

**Windows:**
- Open **Settings > Apps > LifeDash** and click Uninstall, or
- Run `Update.exe --uninstall` from `%LOCALAPPDATA%\lifedash\`

**macOS:**
- Drag LifeDash from Applications to the Trash

### Data & Privacy

- All data is stored locally in an embedded PostgreSQL database (PGlite)
- Database location: within the app's user data directory
- AI API keys are encrypted with OS-level encryption (Electron safeStorage)
- Meeting recordings and transcriptions stay on the user's machine
- No telemetry or usage data is sent to any server
- Backup/restore is available from Settings

### System Requirements

| | Minimum |
|---|---------|
| **Windows** | Windows 10 or later (x64) |
| **macOS** | macOS 10.15 Catalina or later (x64, Apple Silicon via Rosetta) |
| **RAM** | 4 GB (8 GB recommended for local Whisper transcription) |
| **Disk** | ~300 MB for app + Whisper model (~150 MB for base model) |

### Customer Troubleshooting

**App doesn't start on Windows**
→ Check `%LOCALAPPDATA%\lifedash\` exists. If corrupt, delete the folder and reinstall.

**"Update available" but nothing happens**
→ Restart the app. Updates apply on restart, not while running.

**Transcription not working**
→ Download a Whisper model from Settings > Whisper. The base model (~150 MB) is recommended.

**AI features not responding**
→ Check Settings > AI Providers — at least one provider needs a valid API key, or Ollama must be running locally.

**Database issues / data recovery**
→ Use Settings > Backup to export the database. Restore from a previous backup if needed.
