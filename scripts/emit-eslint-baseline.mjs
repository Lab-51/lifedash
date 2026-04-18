// One-shot: read temp/codeq-baseline.json, emit ready-to-paste JS arrays
// for eslint.config.mjs overrides.
import fs from 'node:fs';

const data = JSON.parse(fs.readFileSync('temp/codeq-baseline.json', 'utf8'));

function emit(title, entries) {
  console.log(`// ${title} (${entries.length} files, ${entries.reduce((a, [, n]) => a + n, 0)} hits total)`);
  console.log('[');
  for (const [path, count] of entries) {
    console.log(`  '${path}', // ${count}`);
  }
  console.log('],');
  console.log('');
}

emit('no-floating-promises baseline', data.floating);
emit('complexity baseline', data.complexity);
