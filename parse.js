const fs = require('fs');
const ts = require('typescript');
const code = fs.readFileSync('src/renderer/components/CardDetailModal.tsx', 'utf8');

const sf = ts.createSourceFile('test.tsx', code, ts.ScriptTarget.Latest, true);

function visit(node) {
    if (ts.isJsxElement(node)) {
        const open = node.openingElement.tagName.getText();
        const close = node.closingElement.tagName.getText();
        if (open !== close) {
            const pos = sf.getLineAndCharacterOfPosition(node.getStart());
            console.log(`Mismatched tag: <${open}> vs </${close}> at line ${pos.line + 1}`);
        }
    }
    ts.forEachChild(node, visit);
}
try {
    visit(sf);
    console.log("No mismatched JSX elements found by simple AST walk");
} catch (e) {
    console.log("AST error: ", e.message);
}
