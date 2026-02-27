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

### 1. Bump version and commit

```bash
npm version patch          # bumps 2.0.0 → 2.0.1 (also creates a git tag)
git push && git push --tags
```

### 2. Build and publish

```bash
# Full release (with obfuscation):
GITHUB_TOKEN=ghp_... npm run publish

# Fast test build (skip obfuscation):
GITHUB_TOKEN=ghp_... SKIP_OBFUSCATION=true npm run publish
```

This will:
- Build the app (Vite + Electron Forge)
- Create installer artifacts (Setup.exe, .nupkg, RELEASES)
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
| Windows | `lifedash-X.X.X Setup.exe` | Squirrel installer for new installs |
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
