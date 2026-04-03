// === FILE PURPOSE ===
// Pre-release validation for LifeDash.
// Checks all prerequisites (tokens, tools, git state) before any release work
// begins, so failures surface early with clear fix instructions.
// Cross-platform: works on both Windows and macOS.
// Usage: node scripts/preflight-release.js
// Exit code 0 = all checks pass, 1 = at least one check failed.

'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const platform = process.platform; // 'win32', 'darwin', 'linux'

// ---------------------------------------------------------------------------
// Result tracking
// ---------------------------------------------------------------------------

let failures = 0;
let warnings = 0;

function pass(msg) {
  console.log(`  \x1b[32m\u2713\x1b[0m ${msg}`);
}

function fail(msg) {
  console.log(`  \x1b[31m\u2717\x1b[0m ${msg}`);
  failures++;
}

function warn(msg) {
  console.log(`  \x1b[33m\u26A0\x1b[0m ${msg}`);
  warnings++;
}

function skip(msg) {
  console.log(`  \x1b[90m- ${msg} (skipped)\x1b[0m`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function exec(cmd) {
  return execSync(cmd, { stdio: 'pipe', encoding: 'utf-8' }).trim();
}

function tryExec(cmd) {
  try {
    return { ok: true, output: exec(cmd) };
  } catch (_) {
    return { ok: false, output: '' };
  }
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

/**
 * 1. Node.js version — compare against engines field if present.
 */
function checkNodeVersion() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
  const engines = pkg.engines;

  if (!engines || !engines.node) {
    skip('Node.js version (no engines.node in package.json)');
    return;
  }

  // Parse simple semver range: ">=18", ">=18.0.0", "^20", etc.
  const constraint = engines.node;
  const match = constraint.match(/(\d+)/);
  if (!match) {
    skip(`Node.js version (could not parse engines.node: ${constraint})`);
    return;
  }

  const requiredMajor = parseInt(match[1], 10);
  const currentMajor = parseInt(process.versions.node.split('.')[0], 10);

  if (currentMajor >= requiredMajor) {
    pass(`Node.js ${process.versions.node} meets requirement (${constraint})`);
  } else {
    fail(`Node.js ${process.versions.node} does not meet requirement (${constraint})`);
  }
}

/**
 * 2. GITHUB_TOKEN env var is set.
 */
function checkGithubToken() {
  if (process.env.GITHUB_TOKEN) {
    pass('GITHUB_TOKEN is set');
  } else {
    fail('GITHUB_TOKEN is not set \u2014 required for release upload');
  }
}

/**
 * 3. gh CLI is installed.
 *    Returns the resolved gh path (or null) for use by the auth check.
 */
function checkGhInstalled() {
  // Try PATH first
  const pathResult = tryExec('gh --version');
  if (pathResult.ok) {
    const ver = pathResult.output.split('\n')[0];
    pass(`gh CLI found (${ver})`);
    return 'gh';
  }

  // Try known Windows install locations
  if (platform === 'win32') {
    const candidates = [
      'C:\\Program Files\\GitHub CLI\\gh.exe',
      'C:\\Program Files (x86)\\GitHub CLI\\gh.exe',
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'GitHub CLI', 'gh.exe'),
    ];
    for (const candidate of candidates) {
      if (candidate && fs.existsSync(candidate)) {
        const ver = tryExec(`"${candidate}" --version`);
        const label = ver.ok ? ver.output.split('\n')[0] : 'unknown version';
        pass(`gh CLI found at ${candidate} (${label})`);
        return `"${candidate}"`;
      }
    }
  }

  fail('gh CLI not found \u2014 install: ' + (platform === 'win32'
    ? 'winget install GitHub.cli'
    : 'brew install gh'));
  return null;
}

/**
 * 4. gh CLI is authenticated.
 */
function checkGhAuth(ghPath) {
  if (!ghPath) {
    skip('gh auth (gh CLI not found)');
    return;
  }

  const result = tryExec(`${ghPath} auth status`);
  if (result.ok) {
    pass('gh CLI is authenticated');
  } else {
    fail('gh CLI is not authenticated \u2014 run: gh auth login');
  }
}

/**
 * 5. Inno Setup installed (Windows only).
 */
function checkInnoSetup() {
  if (platform !== 'win32') {
    skip('Inno Setup (Windows only)');
    return;
  }

  // Check PATH
  const pathResult = tryExec('where ISCC.exe');
  if (pathResult.ok) {
    pass(`Inno Setup found in PATH (${pathResult.output.split('\n')[0]})`);
    return;
  }

  // Check common install locations
  const candidates = [
    'C:\\Program Files (x86)\\Inno Setup 6\\ISCC.exe',
    'C:\\Program Files\\Inno Setup 6\\ISCC.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Inno Setup 6', 'ISCC.exe'),
  ];
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      pass(`Inno Setup found at ${candidate}`);
      return;
    }
  }

  fail('Inno Setup not found \u2014 install: choco install innosetup --yes');
}

/**
 * 6. Working tree is clean.
 */
function checkCleanTree() {
  const result = tryExec('git status --porcelain');
  if (!result.ok) {
    fail('Could not run git status');
    return;
  }

  if (result.output === '') {
    pass('Working tree is clean');
  } else {
    const lines = result.output.split('\n').filter(Boolean);
    fail(`Working tree has ${lines.length} uncommitted change(s)`);
    // Show first few changed files for context
    for (const line of lines.slice(0, 5)) {
      console.log(`       ${line}`);
    }
    if (lines.length > 5) {
      console.log(`       ... and ${lines.length - 5} more`);
    }
  }
}

/**
 * 7. Remote detection — identify owner/repo from origin URL.
 */
function checkRemote() {
  const result = tryExec('git remote get-url origin');
  if (!result.ok) {
    warn('No git remote "origin" configured');
    return;
  }

  const url = result.output;
  let owner = null;
  let repo = null;

  // HTTPS: https://github.com/Owner/Repo.git
  const httpsMatch = url.match(/github\.com\/([^/]+)\/([^/.]+)/);
  if (httpsMatch) {
    owner = httpsMatch[1];
    repo = httpsMatch[2];
  }

  // SSH: git@github.com:Owner/Repo.git
  if (!owner) {
    const sshMatch = url.match(/github\.com:([^/]+)\/([^/.]+)/);
    if (sshMatch) {
      owner = sshMatch[1];
      repo = sshMatch[2];
    }
  }

  if (!owner || !repo) {
    warn(`Could not parse remote URL: ${url}`);
    return;
  }

  const slug = `${owner}/${repo}`;
  if (slug === 'Lab-51/lifedash') {
    pass('Remote: Lab-51/lifedash (official)');
  } else {
    warn(`Remote: ${slug} (not official Lab-51/lifedash \u2014 artifacts will go to fork's releases)`);
  }
}

// ---------------------------------------------------------------------------
// Run all checks
// ---------------------------------------------------------------------------

console.log('');
console.log('LifeDash Release Preflight');
console.log('='.repeat(50));
console.log('');

checkNodeVersion();
checkGithubToken();
const ghPath = checkGhInstalled();
checkGhAuth(ghPath);
checkInnoSetup();
checkCleanTree();
checkRemote();

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log('');
console.log('-'.repeat(50));

if (failures > 0) {
  console.log(`\x1b[31mPreflight FAILED\x1b[0m \u2014 ${failures} check(s) failed` +
    (warnings > 0 ? `, ${warnings} warning(s)` : ''));
  console.log('Fix the issues above before running the release.');
  process.exit(1);
} else if (warnings > 0) {
  console.log(`\x1b[32mPreflight PASSED\x1b[0m with ${warnings} warning(s)`);
  process.exit(0);
} else {
  console.log('\x1b[32mPreflight PASSED\x1b[0m \u2014 all checks OK');
  process.exit(0);
}
