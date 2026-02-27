/**
 * verify-package.js
 * Inspects the packaged Electron output and validates all required files are present.
 * Usage: node scripts/verify-package.js [platform-arch]
 * Example: node scripts/verify-package.js win32-x64
 * Exit code 0 = all critical checks pass, 1 = at least one critical check failed.
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Platform / path resolution
// ---------------------------------------------------------------------------

const platformArg = process.argv[2]; // e.g. "win32-x64"

function getCurrentPlatformArch() {
  return `${process.platform}-${process.arch}`;
}

const platformArch = platformArg || getCurrentPlatformArch();
const projectRoot = path.resolve(__dirname, '..');
const outDir = path.join(projectRoot, 'out', `lifedash-${platformArch}`);
const resourcesDir = path.join(outDir, 'resources');
const asarPath = path.join(resourcesDir, 'app.asar');

// ---------------------------------------------------------------------------
// Result tracking
// ---------------------------------------------------------------------------

const results = [];
let criticalFailures = 0;

/**
 * @param {string} label - Human-readable check name
 * @param {boolean} passed - Whether the check passed
 * @param {boolean} critical - Whether failure of this check is a hard failure
 * @param {string} [detail] - Optional detail message
 */
function record(label, passed, critical, detail) {
  const status = passed ? 'PASS' : (critical ? 'FAIL' : 'WARN');
  results.push({ label, status, detail });
  if (!passed && critical) {
    criticalFailures++;
  }
}

// ---------------------------------------------------------------------------
// File system helpers
// ---------------------------------------------------------------------------

function fileExists(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function dirExists(dirPath) {
  try {
    return fs.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

function countFilesWithExt(dirPath, ext) {
  try {
    const entries = fs.readdirSync(dirPath);
    return entries.filter(e => e.endsWith(ext)).length;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// asar helpers
// ---------------------------------------------------------------------------

let asarModule = null;
let asarFiles = null;

function loadAsar() {
  if (asarModule) return true;
  try {
    // @electron/asar is a transitive dep of electron-forge
    asarModule = require('@electron/asar');
    return true;
  } catch {
    return false;
  }
}

function getAsarFiles() {
  if (asarFiles) return asarFiles;
  if (!loadAsar()) return [];
  try {
    asarFiles = asarModule.listPackage(asarPath);
    return asarFiles;
  } catch {
    asarFiles = [];
    return asarFiles;
  }
}

/**
 * Check whether a given path exists inside the asar.
 * listPackage returns backslash-prefixed paths on Windows (e.g. "\.vite\build\main.js"),
 * so we normalize both the needle and the haystack to forward slashes for comparison.
 * @param {string} asarRelPath - forward-slash path relative to asar root (e.g. ".vite/build/main.js")
 * @param {boolean} [prefix] - if true, check whether any entry starts with this path (directory check)
 */
function asarHas(asarRelPath, prefix) {
  const files = getAsarFiles();
  // Normalize: strip leading sep, convert all backslashes to forward slashes
  const normalize = (p) => p.replace(/^[\\\/]/, '').replace(/\\/g, '/');
  const needle = normalize(asarRelPath);
  if (prefix) {
    return files.some(f => normalize(f).startsWith(needle));
  }
  return files.some(f => normalize(f) === needle);
}

/**
 * Extract a file's content from the asar archive.
 * Returns a Buffer, or null if not found.
 * @param {string} asarRelPath - forward-slash path relative to asar root
 */
function asarExtract(asarRelPath) {
  if (!loadAsar()) return null;
  const files = getAsarFiles();
  // Find the matching entry to get the exact asar-internal path
  const normalize = (p) => p.replace(/^[\\\/]/, '').replace(/\\/g, '/');
  const needle = normalize(asarRelPath);
  const entry = files.find(f => normalize(f) === needle);
  if (!entry) return null;
  try {
    // extractFile expects the path without a leading separator
    const extractPath = entry.replace(/^[\\\/]/, '');
    return asarModule.extractFile(asarPath, extractPath);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

function checkOutputDir() {
  const exists = dirExists(outDir);
  record(
    `Output directory exists: out/lifedash-${platformArch}/`,
    exists,
    true,
    exists ? '' : `Expected: ${outDir}`
  );
  return exists;
}

function checkExecutable() {
  const isWindows = platformArch.startsWith('win32');
  const isMac = platformArch.startsWith('darwin');
  if (isWindows) {
    const exe = path.join(outDir, 'lifedash.exe');
    record('lifedash.exe exists', fileExists(exe), true);
  } else if (isMac) {
    const app = path.join(outDir, 'LifeDash.app');
    record('LifeDash.app exists', dirExists(app), true);
  } else {
    const bin = path.join(outDir, 'lifedash');
    record('lifedash binary exists', fileExists(bin), true);
  }
}

function checkAsarExists() {
  const exists = fileExists(asarPath);
  record('resources/app.asar exists', exists, true);
  return exists;
}

function checkAsarModule() {
  const loaded = loadAsar();
  record(
    '@electron/asar module available (needed to inspect asar)',
    loaded,
    true,
    loaded ? '' : 'Install @electron/asar or run from the project root'
  );
  return loaded;
}

function checkBuildOutputsInsideAsar() {
  record('asar: .vite/build/main.js', asarHas('.vite/build/main.js'), true);
  record('asar: .vite/build/preload.js', asarHas('.vite/build/preload.js'), true);
  record('asar: .vite/renderer/ directory', asarHas('.vite/renderer', true), true);
  record(
    'asar: .vite/renderer/main_window/index.html',
    asarHas('.vite/renderer/main_window/index.html'),
    true
  );
}

function checkExternalPackages() {
  record(
    'asar: node_modules/@electric-sql/pglite/',
    asarHas('node_modules/@electric-sql/pglite', true),
    true
  );
  record(
    'asar: node_modules/@fugood/whisper.node/',
    asarHas('node_modules/@fugood/whisper.node', true),
    true
  );
  // Platform whisper binary — warn if missing, not critical (may be cross-platform build)
  const isWindows = platformArch.startsWith('win32');
  const isMac = platformArch.includes('darwin');
  if (isWindows) {
    record(
      'asar: node_modules/@fugood/node-whisper-win32-x64/',
      asarHas('node_modules/@fugood/node-whisper-win32-x64', true),
      false // warn only — platform binary might not always be present
    );
  } else if (isMac) {
    const arch = platformArch.includes('arm64') ? 'arm64' : 'x64';
    record(
      `asar: node_modules/@fugood/node-whisper-darwin-${arch}/`,
      asarHas(`node_modules/@fugood/node-whisper-darwin-${arch}`, true),
      false
    );
  }
}

function checkMigrations() {
  const drizzleDir = path.join(resourcesDir, 'drizzle');
  const exists = dirExists(drizzleDir);
  record('resources/drizzle/ directory exists', exists, true);
  if (exists) {
    const sqlCount = countFilesWithExt(drizzleDir, '.sql');
    record(
      `resources/drizzle/ contains .sql files (found ${sqlCount})`,
      sqlCount > 0,
      true,
      sqlCount === 0 ? 'No .sql migration files found' : ''
    );
  }
}

function checkIconFiles() {
  const iconPng = path.join(resourcesDir, 'icon.png');
  record('resources/icon.png exists', fileExists(iconPng), false);
}

function checkSecurityNoSourceMaps() {
  // .map files from our own build are a security risk (expose source).
  // node_modules may ship their own .map files (e.g. pglite) — those are acceptable.
  const files = getAsarFiles();
  const normalize = (p) => p.replace(/^[\\\/]/, '').replace(/\\/g, '/');
  const ourMapFiles = files
    .map(normalize)
    .filter(f => f.endsWith('.map') && !f.startsWith('node_modules/'));

  record(
    `Security: no source map files outside node_modules (found ${ourMapFiles.length})`,
    ourMapFiles.length === 0,
    false,
    ourMapFiles.length > 0 ? `Found: ${ourMapFiles.slice(0, 5).join(', ')}` : ''
  );
}

function checkSecurityNoEnvFiles() {
  const files = getAsarFiles();
  const normalize = (p) => p.replace(/^[\\\/]/, '').replace(/\\/g, '/');
  const envFiles = files
    .map(normalize)
    .filter(f => f === '.env' || f.endsWith('/.env'));

  record(
    `Security: no .env files inside asar (found ${envFiles.length})`,
    envFiles.length === 0,
    true,
    envFiles.length > 0 ? `Found: ${envFiles.join(', ')}` : ''
  );
}

/**
 * Check that a JS file looks obfuscated.
 * A file is considered obfuscated if:
 *  - It contains _0x hex identifiers (javascript-obfuscator output), OR
 *  - It does NOT contain any of the readable plain-text patterns that would appear
 *    in unobfuscated code.
 */
function isObfuscated(content) {
  // Strong positive signal: obfuscator output uses _0x hex identifiers
  if (/_0x[0-9a-fA-F]{4,}/.test(content)) return true;
  // Weak check: absence of recognizable function names
  const plainPatterns = [
    'function registerCardAgentHandlers',
    'ipcMain.handle(',
    'registerHandlers(',
    'export default ',
    'const __filename =',
  ];
  return !plainPatterns.some(p => content.includes(p));
}

function checkObfuscation() {
  const mainBuf = asarExtract('.vite/build/main.js');
  if (mainBuf) {
    const mainStr = mainBuf.toString('utf8');
    record(
      'Security: main.js is obfuscated',
      isObfuscated(mainStr),
      false, // warn only — obfuscation can be disabled
      isObfuscated(mainStr) ? '' : 'main.js appears to be unobfuscated plain-text JavaScript'
    );
  } else {
    record('Security: main.js is obfuscated', false, false, 'Could not extract main.js from asar');
  }

  const preloadBuf = asarExtract('.vite/build/preload.js');
  if (preloadBuf) {
    const preloadStr = preloadBuf.toString('utf8');
    record(
      'Security: preload.js is obfuscated',
      isObfuscated(preloadStr),
      false,
      isObfuscated(preloadStr) ? '' : 'preload.js appears to be unobfuscated plain-text JavaScript'
    );
  } else {
    record('Security: preload.js is obfuscated', false, false, 'Could not extract preload.js from asar');
  }
}

// ---------------------------------------------------------------------------
// Run all checks
// ---------------------------------------------------------------------------

console.log('');
console.log('LifeDash Package Verification');
console.log('='.repeat(60));
console.log(`Platform  : ${platformArch}`);
console.log(`Output dir: ${outDir}`);
console.log('');

const outputExists = checkOutputDir();

if (!outputExists) {
  console.log('ERROR: Output directory does not exist. Has the app been packaged?');
  console.log('  Run: npm run package');
  console.log('');
  printResults();
  process.exit(1);
}

checkExecutable();
const asarExists = checkAsarExists();

if (asarExists && checkAsarModule()) {
  checkBuildOutputsInsideAsar();
  checkExternalPackages();
  checkSecurityNoSourceMaps();
  checkSecurityNoEnvFiles();
  checkObfuscation();
}

checkMigrations();
checkIconFiles();

// ---------------------------------------------------------------------------
// Print results
// ---------------------------------------------------------------------------

function printResults() {
  const total = results.length;
  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  const warned = results.filter(r => r.status === 'WARN').length;

  // Column widths
  const labelWidth = Math.max(...results.map(r => r.label.length), 10);

  for (const r of results) {
    const statusColor =
      r.status === 'PASS' ? '\x1b[32m' :
      r.status === 'FAIL' ? '\x1b[31m' :
      '\x1b[33m'; // WARN = yellow
    const reset = '\x1b[0m';
    const label = r.label.padEnd(labelWidth);
    const detail = r.detail ? `  (${r.detail})` : '';
    console.log(`  ${statusColor}${r.status}${reset}  ${label}${detail}`);
  }

  console.log('');
  console.log('-'.repeat(60));
  console.log(`Summary: ${passed}/${total} checks passed  |  ${failed} failed  |  ${warned} warnings`);
  console.log('');

  return { passed, failed, warned, total };
}

const { failed } = printResults();

if (criticalFailures > 0) {
  console.log('\x1b[31mPackage verification FAILED\x1b[0m — fix critical issues before distribution.');
  process.exit(1);
} else if (failed > 0) {
  // This shouldn't happen since all FAILs are critical, but guard anyway
  console.log('\x1b[31mPackage verification FAILED\x1b[0m');
  process.exit(1);
} else {
  console.log('\x1b[32mPackage verification PASSED\x1b[0m');
  process.exit(0);
}
