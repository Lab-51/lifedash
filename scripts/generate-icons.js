/**
 * Generate icon.png from icon.svg using @resvg/resvg-js.
 * Run with: node scripts/generate-icons.js
 *
 * Produces a 512x512 PNG suitable for Electron Forge packaging.
 * No Electron runtime required — works in plain Node.js.
 */
const { Resvg } = require('@resvg/resvg-js');
const fs = require('fs');
const path = require('path');

const SVG_PATH = path.join(__dirname, '../src/renderer/assets/icon.svg');
const OUT_PATH = path.join(__dirname, '../src/assets/icon.png');
const SIZE = 512;

if (!fs.existsSync(SVG_PATH)) {
  console.error(`SVG not found at: ${SVG_PATH}`);
  process.exit(1);
}

const svg = fs.readFileSync(SVG_PATH, 'utf-8');

const resvg = new Resvg(svg, {
  fitTo: { mode: 'width', value: SIZE },
});

const rendered = resvg.render();
const buffer = rendered.asPng();

fs.writeFileSync(OUT_PATH, buffer);
console.log(`Generated ${SIZE}x${SIZE} icon.png at ${OUT_PATH} (${buffer.length} bytes)`);
