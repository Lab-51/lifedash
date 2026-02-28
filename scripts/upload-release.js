// === FILE PURPOSE ===
// Upload the LifeDash installer to GitHub Releases as a draft.
// Replaces the old @electron-forge/publisher-github step.
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
const installerFile = path.join(ROOT, 'out', 'make', `LifeDash-${version}-Setup.exe`);

// Verify installer exists before attempting upload
if (!fs.existsSync(installerFile)) {
  console.error(`ERROR: Installer not found: ${installerFile}`);
  console.error('Run "npm run make:installer" first to build the installer.');
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
console.log(`  File: ${installerFile}`);

// Create a draft release (fails gracefully if tag already exists)
try {
  execSync(
    `${gh} release create ${tag} --draft --repo ${repo} --title "${tag}"`,
    { stdio: 'inherit', cwd: ROOT }
  );
  console.log(`\nDraft release created: ${tag}`);
} catch (err) {
  // Release may already exist — attempt to upload anyway
  console.warn(`Warning: release create may have failed (release may already exist). Attempting upload...`);
}

// Upload the installer asset
try {
  execSync(
    `${gh} release upload ${tag} "${installerFile}" --repo ${repo} --clobber`,
    { stdio: 'inherit', cwd: ROOT }
  );
} catch (err) {
  console.error('ERROR: Failed to upload installer to GitHub Releases.');
  process.exit(1);
}

console.log(`\nDraft release URL: https://github.com/${repo}/releases/tag/${tag}`);
console.log('Review and publish the release from the GitHub Releases page or via the GitHub API.');
