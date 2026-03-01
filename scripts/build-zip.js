// === FILE PURPOSE ===
// Create a 7z archive of the packaged app for distribution.
// This is the primary download artifact (7z extraction avoids MOTW propagation,
// eliminating SmartScreen warnings). The Inno Setup installer is still built
// separately for silent auto-updates.
// Usage: node scripts/build-zip.js

'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
const version = pkg.version;

const sourceDir = path.join(ROOT, 'out', 'lifedash-win32-x64');
const outputDir = path.join(ROOT, 'out', 'make');
const outputFile = path.join(outputDir, `LifeDash-${version}.7z`);

// Locate 7z.exe — check PATH first, then known install locations
function find7z() {
  // 1. Try PATH
  try {
    execSync('where 7z.exe', { stdio: 'pipe' });
    return '7z.exe';
  } catch (_) {
    // Not in PATH
  }

  // 2. Try common install locations
  const candidates = [
    'C:\\Program Files\\7-Zip\\7z.exe',
    'C:\\Program Files (x86)\\7-Zip\\7z.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Programs', '7-Zip', '7z.exe'),
  ];
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return `"${candidate}"`;
    }
  }

  return null;
}

const sevenZip = find7z();
if (!sevenZip) {
  console.error('ERROR: 7z.exe not found.');
  console.error('Install 7-Zip from https://www.7-zip.org/download.html');
  console.error('Or: winget install 7zip.7zip');
  process.exit(1);
}

// Verify packaged app exists
if (!fs.existsSync(sourceDir)) {
  console.error(`ERROR: Packaged app not found: ${sourceDir}`);
  console.error('Run "electron-forge package" first.');
  process.exit(1);
}

// Ensure output directory exists
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// Remove old archive if it exists
if (fs.existsSync(outputFile)) {
  fs.unlinkSync(outputFile);
}

console.log(`Building LifeDash distribution archive v${version}...`);
console.log(`  Source: ${sourceDir}`);
console.log(`  Output: ${outputFile}`);

try {
  execSync(
    `${sevenZip} a -t7z -mx=7 "${outputFile}" "${sourceDir}\\*"`,
    { stdio: 'inherit', cwd: ROOT }
  );
} catch (err) {
  console.error('ERROR: 7z archive creation failed.');
  process.exit(1);
}

if (!fs.existsSync(outputFile)) {
  console.error(`ERROR: Expected output not found: ${outputFile}`);
  process.exit(1);
}

const stats = fs.statSync(outputFile);
const sizeMb = (stats.size / 1024 / 1024).toFixed(1);
console.log(`\n7z archive built successfully:`);
console.log(`  File: ${outputFile}`);
console.log(`  Size: ${sizeMb} MB`);
