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

3. **Inno Setup 6** (Windows installer):
   - Install via `choco install innosetup --yes` or download from https://jrsoftware.org/isdl.php
   - ISCC.exe must be in PATH or at the default `C:\Program Files (x86)\Inno Setup 6\ISCC.exe`

4. **gh CLI** — must be authenticated (`gh auth status`)

5. **Code signing (optional)**:
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
- Package the app (Vite + Electron Forge)
- Create an Inno Setup installer (`LifeDash-X.X.X-Setup.exe`)
- Upload it as a **draft** release to https://github.com/Lab-51/lifedash/releases via gh CLI

### 3. Publish the draft release

The upload script creates a hidden **draft** release. Publish it via the API (or ask Claude Code — it does this automatically):

```bash
# Find the draft release ID
RELEASE_ID=$(curl -s -H "Authorization: token $GITHUB_TOKEN" \
  "https://api.github.com/repos/Lab-51/lifedash/releases" \
  | node -e "var r=JSON.parse(require('fs').readFileSync(0,'utf8')); \
  var d=r.find(function(x){return x.draft}); \
  console.log(d?d.id:'')")

# Publish it
curl -s -X PATCH \
  -H "Authorization: token $GITHUB_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"draft": false, "body": "## Changes\n- ..."}' \
  "https://api.github.com/repos/Lab-51/lifedash/releases/$RELEASE_ID"
```

> **Do NOT** publish from the GitHub Tags tab — it only shows source code archives. The draft with the actual `.exe` is a separate entry that must be published via the API or from the Releases tab (look for "Draft" at the top).

### 4. Users auto-update

Once published:
- Existing installations check the GitHub Releases API for updates **every hour**
- When a newer version is found, the Setup.exe is downloaded in the background
- An **in-app toast** appears: "Update vX.X.X ready — restart to install"
- User clicks **Restart Now** — the app exits and Inno Setup silently installs the update
- The app relaunches automatically after the update completes

## What Gets Published

| Platform | Artifact | Purpose |
|----------|----------|---------|
| Windows | `LifeDash-X.X.X-Setup.exe` | Inno Setup installer for new installs + updates |
| macOS | `LifeDash.dmg` | DMG installer for new installs |
| macOS | `LifeDash-darwin-x64-X.X.X.zip` | ZIP for macOS distribution |

## How Auto-Update Works

```
autoUpdater.ts (in main process)
    ↓ checks every hour (+ 10s after startup)
https://api.github.com/repos/Lab-51/lifedash/releases/latest
    ↓ compares tag_name with current version
If newer: finds asset matching /LifeDash-.*-Setup\.exe$/
    ↓ downloads via Electron net.request()
Saves to temp dir, sends progress to renderer
    ↓ user clicks "Restart Now"
Spawns Inno Setup with /VERYSILENT /CLOSEAPPLICATIONS /RESTARTAPPLICATIONS
    ↓ app exits, installer overwrites, app relaunches
```

## Commands Reference

| Command | What it does |
|---------|-------------|
| `npm run start` | Run in development mode |
| `npm run package` | Create unpacked app (no installer) |
| `npm run make` | Create macOS installers (DMG/ZIP) via Forge makers |
| `npm run make:installer` | Package app + build Inno Setup installer |
| `npm run publish` | Package + build installer + upload draft to GitHub |
| `npm run make:icons` | Regenerate .ico and .icns from icon.png |
| `npm run verify:package` | Run 18 packaging checks |

## Troubleshooting

**"GITHUB_TOKEN not set"**
→ Set the environment variable: `export GITHUB_TOKEN=ghp_...`

**"ISCC.exe not found"**
→ Install Inno Setup 6: `choco install innosetup --yes` or download from https://jrsoftware.org/isdl.php

**Update not detected by users**
→ Check that the release is **published** (not draft). Draft releases are invisible to the auto-updater.

**macOS "app is damaged" error**
→ The app isn't code-signed. Set `APPLE_IDENTITY` env var for signing, or tell users to run:
`xattr -cr /Applications/LifeDash.app`

---

## Customer Installation Guide

### Windows

1. Download `LifeDash-X.X.X-Setup.exe` from the [Releases page](https://github.com/Lab-51/lifedash/releases)
2. Run it — the setup wizard guides through installation
3. Choose install location (default: `%APPDATA%\LifeDash`)
4. Optionally create a desktop shortcut
5. Click "Launch LifeDash" on the finish page

**Default location:** `C:\Users\<username>\AppData\Roaming\LifeDash\`
**No admin rights required** — installs per-user, not system-wide.

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

LifeDash checks for updates automatically every hour (and 10 seconds after startup):

1. The app checks the GitHub Releases API for a newer version
2. If found, it downloads the installer in the background (with progress)
3. A notification appears in the title bar: **"Update vX.X.X ready"**
4. Click **Restart Now** — the app exits, installs silently, and relaunches

Updates are pulled from the [GitHub Releases API](https://api.github.com/repos/Lab-51/lifedash/releases/latest). Only **published** releases (not drafts) are visible to the auto-updater.

### Uninstalling

**Windows:**
- Open **Settings > Apps > LifeDash** and click Uninstall

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
→ Check `%APPDATA%\LifeDash\` exists. If corrupt, uninstall via Settings > Apps and reinstall.

**"Update available" but nothing happens**
→ Restart the app. Updates apply on restart, not while running.

**Transcription not working**
→ Download a Whisper model from Settings > Whisper. The base model (~150 MB) is recommended.

**AI features not responding**
→ Check Settings > AI Providers — at least one provider needs a valid API key, or Ollama must be running locally.

**Database issues / data recovery**
→ Use Settings > Backup to export the database. Restore from a previous backup if needed.
