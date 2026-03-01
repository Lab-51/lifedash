// === FILE PURPOSE ===
// Upload LifeDash release artifacts to GitHub Releases as a draft.
// Uploads two artifacts:
//   1. LifeDash-{version}.7z — primary download (7z avoids MOTW, no SmartScreen)
//   2. LifeDash-{version}-Setup.exe — used by the in-app auto-updater
// Uses the gh CLI (GitHub CLI) — requires GITHUB_TOKEN env var.
// Usage: node scripts/upload-release.js

'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// Locate gh CLI — check PATH first, then known install locations
function findGh() {
  try {
    execSync('gh --version', { stdio: 'pipe' });
    return 'gh';
  } catch (_) {
    // Not in PATH
  }
  const candidates = [
    'C:\\Program Files\\GitHub CLI\\gh.exe',
    'C:\\Program Files (x86)\\GitHub CLI\\gh.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'GitHub CLI', 'gh.exe'),
  ];
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return `"${candidate}"`;
    }
  }
  return null;
}

const gh = findGh();
if (!gh) {
  console.error('ERROR: gh CLI not found.');
  console.error('Install it: winget install GitHub.cli');
  process.exit(1);
}

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
const version = pkg.version;
const tag = `v${version}`;
const repo = 'Lab-51/lifedash';

const archiveFile = path.join(ROOT, 'out', 'make', `LifeDash-${version}.7z`);
const installerFile = path.join(ROOT, 'out', 'make', `LifeDash-${version}-Setup.exe`);

// Verify artifacts exist
if (!fs.existsSync(archiveFile)) {
  console.error(`ERROR: Archive not found: ${archiveFile}`);
  console.error('Run "npm run make:dist" first.');
  process.exit(1);
}
if (!fs.existsSync(installerFile)) {
  console.error(`ERROR: Installer not found: ${installerFile}`);
  console.error('Run "npm run make:dist" first.');
  process.exit(1);
}

// Verify GITHUB_TOKEN is set (gh CLI needs it for the public repo)
if (!process.env.GITHUB_TOKEN) {
  console.error('ERROR: GITHUB_TOKEN environment variable is not set.');
  console.error('Set it as a permanent env var or pass it inline: GITHUB_TOKEN=... node scripts/upload-release.js');
  process.exit(1);
}

console.log(`Uploading LifeDash ${tag} to GitHub Releases (draft)...`);
console.log(`  Repo: ${repo}`);
console.log(`  Archive:   ${archiveFile}`);
console.log(`  Installer: ${installerFile}`);

// Create a draft release (fails gracefully if tag already exists)
try {
  execSync(
    `${gh} release create ${tag} --draft --repo ${repo} --title "${tag}"`,
    { stdio: 'inherit', cwd: ROOT }
  );
  console.log(`\nDraft release created: ${tag}`);
} catch (err) {
  console.warn(`Warning: release create may have failed (release may already exist). Attempting upload...`);
}

// Upload both artifacts
try {
  execSync(
    `${gh} release upload ${tag} "${archiveFile}" "${installerFile}" --repo ${repo} --clobber`,
    { stdio: 'inherit', cwd: ROOT }
  );
} catch (err) {
  console.error('ERROR: Failed to upload artifacts to GitHub Releases.');
  process.exit(1);
}

console.log(`\nDraft release URL: https://github.com/${repo}/releases/tag/${tag}`);
console.log('Artifacts uploaded:');
console.log(`  - LifeDash-${version}.7z (primary download)`);
console.log(`  - LifeDash-${version}-Setup.exe (auto-updater)`);
