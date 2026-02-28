// === FILE PURPOSE ===
// Build the Inno Setup installer for LifeDash.
// Reads version from package.json, locates ISCC.exe, and produces
// out/make/LifeDash-{version}-Setup.exe.
// Usage: node scripts/build-installer.js

'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
const version = pkg.version;

// Locate ISCC.exe — check PATH first, then default install location
function findIscc() {
  // 1. Try PATH (works in CI after choco install innosetup)
  try {
    execSync('where ISCC.exe', { stdio: 'pipe' });
    return 'ISCC.exe';
  } catch (_) {
    // Not in PATH
  }

  // 2. Try common install locations
  const candidates = [
    'C:\\Program Files (x86)\\Inno Setup 6\\ISCC.exe',
    'C:\\Program Files\\Inno Setup 6\\ISCC.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Inno Setup 6', 'ISCC.exe'),
  ];
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

const iscc = findIscc();
if (!iscc) {
  console.error('ERROR: ISCC.exe not found.');
  console.error('Install Inno Setup 6 from https://jrsoftware.org/isdl.php');
  console.error('Or on CI: choco install innosetup --yes --no-progress');
  process.exit(1);
}

const issFile = path.join(ROOT, 'installer', 'lifedash.iss');
const outputFile = path.join(ROOT, 'out', 'make', `LifeDash-${version}-Setup.exe`);

console.log(`Building LifeDash installer v${version}...`);
console.log(`ISCC: ${iscc}`);
console.log(`Script: ${issFile}`);

try {
  execSync(`"${iscc}" /DMyAppVersion=${version} "${issFile}"`, {
    stdio: 'inherit',
    cwd: ROOT,
  });
} catch (err) {
  console.error('ERROR: Inno Setup compilation failed.');
  process.exit(1);
}

// Verify output exists
if (!fs.existsSync(outputFile)) {
  console.error(`ERROR: Expected output not found: ${outputFile}`);
  process.exit(1);
}

const stats = fs.statSync(outputFile);
const sizeMb = (stats.size / 1024 / 1024).toFixed(1);
console.log(`\nInstaller built successfully:`);
console.log(`  File: ${outputFile}`);
console.log(`  Size: ${sizeMb} MB`);
