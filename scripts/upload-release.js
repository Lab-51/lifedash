// === FILE PURPOSE ===
// Upload LifeDash release artifacts to GitHub Releases as a draft.
// Platform-aware: detects the current OS and uploads the correct artifacts.
//   Windows: LifeDash-{version}.7z + LifeDash-{version}-Setup.exe
//   macOS:   LifeDash-{version}-mac-arm64.dmg + LifeDash-{version}-mac-arm64.zip
// Uses the gh CLI (GitHub CLI) — requires GITHUB_TOKEN env var.
// Usage: node scripts/upload-release.js

'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const platform = process.platform; // 'win32', 'darwin', 'linux'

// Locate gh CLI — check PATH first, then known install locations
function findGh() {
  try {
    execSync('gh --version', { stdio: 'pipe' });
    return 'gh';
  } catch (_) {
    // Not in PATH
  }
  if (platform === 'win32') {
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
  }
  // On macOS/Linux, gh should be in PATH (checked above) or not available
  return null;
}

const gh = findGh();
if (!gh) {
  console.error('ERROR: gh CLI not found.');
  if (platform === 'win32') {
    console.error('Install it: winget install GitHub.cli');
  } else {
    console.error('Install it: brew install gh');
  }
  process.exit(1);
}

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
const version = pkg.version;
const tag = `v${version}`;

// Derive repo from git remote, falling back to package.json
function resolveRepo() {
  // Try git remote first
  try {
    const remoteUrl = execSync('git remote get-url origin', { stdio: 'pipe', cwd: ROOT })
      .toString()
      .trim();
    // HTTPS: https://github.com/Owner/Repo.git -> Owner/Repo
    // SSH:   git@github.com:Owner/Repo.git    -> Owner/Repo
    const httpsMatch = remoteUrl.match(/github\.com\/([^/]+\/[^/]+?)(?:\.git)?\/?$/);
    if (httpsMatch) return httpsMatch[1];
    const sshMatch = remoteUrl.match(/github\.com:([^/]+\/[^/]+?)(?:\.git)?\/?$/);
    if (sshMatch) return sshMatch[1];
    console.warn(`Warning: Could not parse repo from remote URL: ${remoteUrl}`);
  } catch (_) {
    console.warn('Warning: Could not read git remote origin URL.');
  }

  // Fallback: package.json repository field
  if (pkg.repository && pkg.repository.url) {
    const pkgUrl = pkg.repository.url;
    const pkgMatch = pkgUrl.match(/github\.com\/([^/]+\/[^/]+?)(?:\.git)?\/?$/);
    if (pkgMatch) return pkgMatch[1];
    // Handle shorthand "github:Owner/Repo" or just "Owner/Repo"
    const shortMatch = pkgUrl.match(/^(?:github:)?([^/]+\/[^/]+?)(?:\.git)?\/?$/);
    if (shortMatch) return shortMatch[1];
  }
  // Also handle string-form repository field (e.g. "Owner/Repo")
  if (typeof pkg.repository === 'string') {
    const strMatch = pkg.repository.match(/^(?:github:)?([^/]+\/[^/]+?)(?:\.git)?\/?$/);
    if (strMatch) return strMatch[1];
  }

  console.error('ERROR: Could not determine GitHub repository.');
  console.error('Ensure `git remote origin` is set or package.json has a repository.url field.');
  process.exit(1);
}

const repo = resolveRepo();
if (repo === 'Lab-51/lifedash') {
  console.log('Publishing to official LifeDash repository');
} else {
  console.log('Publishing to fork: ' + repo);
}

// --- Determine platform artifacts ---

function getArtifacts() {
  if (platform === 'win32') {
    return {
      label: 'Windows',
      files: [
        {
          path: path.join(ROOT, 'out', 'make', `LifeDash-${version}.7z`),
          description: '7z archive (primary download)',
        },
        {
          path: path.join(ROOT, 'out', 'make', `LifeDash-${version}-Setup.exe`),
          description: 'Installer (auto-updater)',
        },
      ],
    };
  }

  if (platform === 'darwin') {
    // Electron Forge outputs DMG at out/make/ and ZIP at out/make/zip/darwin/arm64/
    // We rename them to include platform/arch for clarity on the release page.
    const makeDir = path.join(ROOT, 'out', 'make');
    const artifacts = [];

    // DMG — Forge puts it at out/make/LifeDash-{version}-arm64.dmg or LifeDash.dmg
    // Search for any .dmg in the make directory
    const dmgCandidates = findFiles(makeDir, '.dmg');
    if (dmgCandidates.length > 0) {
      const dmgSource = dmgCandidates[0];
      const dmgTarget = path.join(makeDir, `LifeDash-${version}-mac-arm64.dmg`);
      if (dmgSource !== dmgTarget) {
        fs.copyFileSync(dmgSource, dmgTarget);
      }
      artifacts.push({
        path: dmgTarget,
        description: 'macOS DMG (arm64)',
      });
    }

    // ZIP — Forge puts it at out/make/zip/darwin/arm64/lifedash-darwin-arm64-{version}.zip
    const zipDir = path.join(makeDir, 'zip');
    const zipCandidates = findFiles(zipDir, '.zip');
    if (zipCandidates.length > 0) {
      const zipSource = zipCandidates[0];
      const zipTarget = path.join(makeDir, `LifeDash-${version}-mac-arm64.zip`);
      if (zipSource !== zipTarget) {
        fs.copyFileSync(zipSource, zipTarget);
      }
      artifacts.push({
        path: zipTarget,
        description: 'macOS ZIP (arm64)',
      });
    }

    return { label: 'macOS (arm64)', files: artifacts };
  }

  console.error(`ERROR: Unsupported platform: ${platform}`);
  process.exit(1);
}

// Recursively find files with a given extension
function findFiles(dir, ext) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findFiles(fullPath, ext));
    } else if (entry.name.endsWith(ext)) {
      results.push(fullPath);
    }
  }
  return results;
}

const { label, files } = getArtifacts();

if (files.length === 0) {
  console.error(`ERROR: No ${label} artifacts found in out/make/`);
  console.error('Run the appropriate build command first:');
  if (platform === 'win32') {
    console.error('  npm run make:dist');
  } else if (platform === 'darwin') {
    console.error('  npx electron-forge make');
  }
  process.exit(1);
}

// Verify all artifacts exist
for (const artifact of files) {
  if (!fs.existsSync(artifact.path)) {
    console.error(`ERROR: Artifact not found: ${artifact.path}`);
    process.exit(1);
  }
}

// Verify GITHUB_TOKEN is set (gh CLI needs it for the public repo)
if (!process.env.GITHUB_TOKEN) {
  console.error('ERROR: GITHUB_TOKEN environment variable is not set.');
  console.error('Set it as a permanent env var or pass it inline: GITHUB_TOKEN=... node scripts/upload-release.js');
  process.exit(1);
}

console.log(`Uploading LifeDash ${tag} (${label}) to GitHub Releases (draft)...`);
console.log(`  Repo: ${repo}`);
for (const artifact of files) {
  console.log(`  ${artifact.description}: ${artifact.path}`);
}

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

// Upload artifacts
const filePaths = files.map(f => `"${f.path}"`).join(' ');
try {
  execSync(
    `${gh} release upload ${tag} ${filePaths} --repo ${repo} --clobber`,
    { stdio: 'inherit', cwd: ROOT }
  );
} catch (err) {
  console.error('ERROR: Failed to upload artifacts to GitHub Releases.');
  process.exit(1);
}

console.log(`\nDraft release URL: https://github.com/${repo}/releases/tag/${tag}`);
console.log('Artifacts uploaded:');
for (const artifact of files) {
  console.log(`  - ${path.basename(artifact.path)} (${artifact.description})`);
}
