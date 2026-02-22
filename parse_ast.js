const ts = require('typescript');
const fs = require('fs');
const code = fs.readFileSync('src/renderer/components/CardDetailModal.tsx', 'utf8');
const sf = ts.createSourceFile('f.tsx', code, ts.ScriptTarget.Latest, true);

const func = sf.statements.find(s => ts.isFunctionDeclaration(s) && s.name && s.name.text === 'CardDetailModal');
if (func) {
    func.body.statements.forEach(s => console.log(ts.SyntaxKind[s.kind], sf.getLineAndCharacterOfPosition(s.getStart()).line + 1));
} else {
    console.log("CardDetailModal function not found (might be completely unparseable)");
}
