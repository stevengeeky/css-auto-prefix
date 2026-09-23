'use strict';
// Pure tests for lib/prefixer.js — run with `npm test` (node's built-in runner, no VS Code needed).
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const P = require('../lib/prefixer');

const LEGACY = { prefixes: P.LEGACY_PREFIXES };

/** Run prefixAt with the cursor where `|` sits in `src`. */
function atCursor(src, options) {
    const offset = src.indexOf('|');
    assert.notEqual(offset, -1, 'snippet needs a | cursor marker');
    const text = src.slice(0, offset) + src.slice(offset + 1);
    const edits = P.prefixAt(text, offset, options);
    return { text, edits, out: P.applyEdits(text, edits) };
}

describe('#7 a colon inside a value must not split the previous property', () => {
    const issue = "::test {\n  example: ':'; \n  animation: a|;\n}";

    test('the exact snippet from the issue keeps `example` intact', () => {
        const { out } = atCursor(issue, LEGACY);
        assert.equal(out, "::test {\n  example: ':'; \n  -webkit-animation: a;\n  animation: a;\n}");
    });

    test('data URIs with colons and semicolons are opaque', () => {
        const src = ".a {\n  background: url(data:image/png;base64,AAAA/x+y=);\n  user-select: none|;\n}";
        const { out } = atCursor(src);
        assert.equal(out, ".a {\n  background: url(data:image/png;base64,AAAA/x+y=);\n  -webkit-user-select: none;\n  user-select: none;\n}");
    });

    test('a value that is itself a string containing `;` `}` `{` and `:`', () => {
        const src = ".a {\n  content: \"a;b}c{d:e\";\n  user-select: text|;\n}";
        const { out } = atCursor(src);
        assert.equal(out, ".a {\n  content: \"a;b}c{d:e\";\n  -webkit-user-select: text;\n  user-select: text;\n}");
    });

    test('escaped quotes inside strings do not end the string early', () => {
        const src = ".a {\n  content: 'it\\'s: }';\n  user-select: all|;\n}";
        const { out } = atCursor(src);
        assert.equal(out, ".a {\n  content: 'it\\'s: }';\n  -webkit-user-select: all;\n  user-select: all;\n}");
    });

    test('block comments containing braces, colons and semicolons are ignored', () => {
        const src = ".a {\n  /* } user-select: x; { */\n  user-select: none|;\n  /* mask: y; */\n}";
        const { out } = atCursor(src);
        assert.equal(out, ".a {\n  /* } user-select: x; { */\n  -webkit-user-select: none;\n  user-select: none;\n  /* mask: y; */\n}");
    });

    test('unquoted url() with a colon before the prefixable property', () => {
        const src = ".a {\n  background: url(http://x.test/a;b.png) no-repeat;\n  mask: url(#m)|;\n}";
        const { out } = atCursor(src);
        assert.equal(out, ".a {\n  background: url(http://x.test/a;b.png) no-repeat;\n  -webkit-mask: url(#m);\n  mask: url(#m);\n}");
    });

    test('cursor inside a non-prefixable value does nothing', () => {
        const { edits } = atCursor("::test {\n  example: ':'|; \n  animation: a;\n}", LEGACY);
        assert.deepEqual(edits, []);
    });

    test('parseDeclarations sees exactly two declarations in the issue snippet', () => {
        const text = issue.replace('|', '');
        const blocks = P.findBlocks(text);
        const decls = P.parseDeclarations(text, blocks[0], blocks);
        assert.deepEqual(decls.map(d => [d.name, d.value]), [['example', "':'"], ['animation', 'a']]);
    });
});
