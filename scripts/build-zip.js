// === FILE PURPOSE ===
// Create a ZIP archive of the packaged app for distribution.
// This is the primary download artifact (no SmartScreen on ZIP files).
// The Inno Setup installer is still built separately for silent auto-updates.
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
const outputFile = path.join(outputDir, `LifeDash-${version}.zip`);

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

// Remove old ZIP if it exists (Compress-Archive doesn't overwrite)
if (fs.existsSync(outputFile)) {
  fs.unlinkSync(outputFile);
}

console.log(`Building LifeDash distribution ZIP v${version}...`);
console.log(`  Source: ${sourceDir}`);
console.log(`  Output: ${outputFile}`);

try {
  // Use PowerShell's Compress-Archive (available on all modern Windows)
  execSync(
    `powershell.exe -NoProfile -Command "Compress-Archive -Path '${sourceDir}\\*' -DestinationPath '${outputFile}' -CompressionLevel Optimal"`,
    { stdio: 'inherit', cwd: ROOT }
  );
} catch (err) {
  console.error('ERROR: ZIP creation failed.');
  process.exit(1);
}

if (!fs.existsSync(outputFile)) {
  console.error(`ERROR: Expected output not found: ${outputFile}`);
  process.exit(1);
}

const stats = fs.statSync(outputFile);
const sizeMb = (stats.size / 1024 / 1024).toFixed(1);
console.log(`\nZIP built successfully:`);
console.log(`  File: ${outputFile}`);
console.log(`  Size: ${sizeMb} MB`);
