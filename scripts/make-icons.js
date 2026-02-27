/**
 * Unified icon generation script.
 * Reads src/assets/icon.png and produces:
 *   - src/assets/icon.icns  (macOS, via png2icons)
 *   - src/assets/icon.ico   (Windows, via png-to-ico)
 *
 * Run with: node scripts/make-icons.js
 */

const fs = require('fs');
const path = require('path');
const png2icons = require('png2icons');
const { default: pngToIco } = require('png-to-ico');

const ASSETS_DIR = path.join(__dirname, '../src/assets');
const PNG_PATH = path.join(ASSETS_DIR, 'icon.png');
const ICNS_PATH = path.join(ASSETS_DIR, 'icon.icns');
const ICO_PATH = path.join(ASSETS_DIR, 'icon.ico');

if (!fs.existsSync(PNG_PATH)) {
  console.error(`Source PNG not found at: ${PNG_PATH}`);
  console.error('Run `node scripts/generate-icons.js` first to generate icon.png from SVG.');
  process.exit(1);
}

const pngBuffer = fs.readFileSync(PNG_PATH);
console.log(`Read icon.png (${pngBuffer.length} bytes)`);

// Generate icon.icns (macOS)
const icnsBuffer = png2icons.createICNS(pngBuffer, png2icons.BICUBIC, 0);
if (!icnsBuffer) {
  console.error('png2icons.createICNS returned null — check that icon.png is a valid PNG.');
  process.exit(1);
}
fs.writeFileSync(ICNS_PATH, icnsBuffer);
console.log(`Generated icon.icns at ${ICNS_PATH} (${icnsBuffer.length} bytes)`);

// Generate icon.ico (Windows)
pngToIco(PNG_PATH)
  .then(icoBuffer => {
    fs.writeFileSync(ICO_PATH, icoBuffer);
    console.log(`Generated icon.ico at ${ICO_PATH} (${icoBuffer.length} bytes)`);
    console.log('All icons generated successfully.');
  })
  .catch(err => {
    console.error('Failed to generate ICO:', err);
    process.exit(1);
  });
