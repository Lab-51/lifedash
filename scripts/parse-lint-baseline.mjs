// One-shot: parse eslint output at /tmp/codeq-lint.txt and emit per-file counts
// grouped by rule. Used once to build the CODE-Q.1b baseline.
import fs from 'node:fs';

const text = fs.readFileSync('temp/codeq-lint.txt', 'utf8');
const lines = text.split('\n');
let currentFile = null;
const filesByRule = {
  'no-floating-promises': new Map(),
  complexity: new Map(),
};
for (const line of lines) {
  const fileMatch = line.match(/^(D:\\.+\.tsx?)\s*$/);
  if (fileMatch) {
    const rel = fileMatch[1]
      .replace(/^.*PROJECT-LIVING-DASHBOARD\\/, '')
      .replace(/\\/g, '/');
    currentFile = rel;
    continue;
  }
  const ruleMatch = line.match(
    /\s+(?:error|warning)\s+.*\s+(@typescript-eslint\/no-floating-promises|complexity)\s*$/,
  );
  if (ruleMatch && currentFile) {
    const rule =
      ruleMatch[1] === 'complexity' ? 'complexity' : 'no-floating-promises';
    const m = filesByRule[rule];
    m.set(currentFile, (m.get(currentFile) || 0) + 1);
  }
}
const out = {
  floating: Array.from(filesByRule['no-floating-promises'].entries()).sort(
    (a, b) => b[1] - a[1],
  ),
  complexity: Array.from(filesByRule.complexity.entries()).sort(
    (a, b) => b[1] - a[1],
  ),
};
fs.writeFileSync('temp/codeq-baseline.json', JSON.stringify(out, null, 2));
console.log('FLOATING_FILES=' + filesByRule['no-floating-promises'].size);
console.log('COMPLEXITY_FILES=' + filesByRule.complexity.size);
console.log(
  'Total floating hits:',
  [...filesByRule['no-floating-promises'].values()].reduce((a, b) => a + b, 0),
);
console.log(
  'Total complexity hits:',
  [...filesByRule.complexity.values()].reduce((a, b) => a + b, 0),
);
console.log('Written /tmp/codeq-baseline.json');
