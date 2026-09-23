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

describe('#2 SCSS: typing above a nested & selector', () => {
    const SCSS = Object.assign({ syntax: 'scss' }, LEGACY);

    test('prefixes stay in the outer block, the & block is untouched', () => {
        const src = [
            '.card {',
            '  transform: scale(1)|;',
            '  &:hover {',
            '    color: red;',
            '  }',
            '}'
        ].join('\n');
        const { out } = atCursor(src, SCSS);
        assert.equal(out, [
            '.card {',
            '  -webkit-transform: scale(1);',
            '  -moz-transform: scale(1);',
            '  -ms-transform: scale(1);',
            '  -o-transform: scale(1);',
            '  transform: scale(1);',
            '  &:hover {',
            '    color: red;',
            '  }',
            '}'
        ].join('\n'));
    });

    test('a half-typed line (no semicolon yet) directly above `&:hover {`', () => {
        const src = '.card {\n  transition: all .2s|\n  &:hover {\n    transform: none;\n  }\n}';
        const { out } = atCursor(src, SCSS);
        assert.equal(out, '.card {\n  -webkit-transition: all .2s;\n  -moz-transition: all .2s;\n  -ms-transition: all .2s;\n  -o-transition: all .2s;\n  transition: all .2s\n  &:hover {\n    transform: none;\n  }\n}');
    });

    test('typing inside the nested & block only touches that block', () => {
        const src = '.card {\n  color: red;\n  &:hover {\n    user-select: none|;\n  }\n  & + & { margin: 0; }\n}';
        const { out } = atCursor(src, { syntax: 'scss' });
        assert.equal(out, '.card {\n  color: red;\n  &:hover {\n    -webkit-user-select: none;\n    user-select: none;\n  }\n  & + & { margin: 0; }\n}');
    });

    test('a `&:hover` selector is never mistaken for a `&` property', () => {
        const src = '.a {\n  &:hover|{\n    color: red;\n  }\n}';
        const { edits } = atCursor(src, { syntax: 'scss', prefixes: { '&': ['webkit'] } });
        assert.deepEqual(edits, []);
    });

    test('nested block whose brace sits on the next line', () => {
        const src = '.a {\n  &:hover\n  {\n    color: red;\n  }\n  user-select: none|;\n}';
        const { out } = atCursor(src, { syntax: 'scss' });
        assert.equal(out, '.a {\n  &:hover\n  {\n    color: red;\n  }\n  -webkit-user-select: none;\n  user-select: none;\n}');
    });

    test('// line comments with braces are ignored in scss', () => {
        const src = '.a {\n  // } { user-select: x;\n  user-select: none|;\n  .b { color: red; } // {\n}';
        const { out } = atCursor(src, { syntax: 'scss' });
        assert.equal(out, '.a {\n  // } { user-select: x;\n  -webkit-user-select: none;\n  user-select: none;\n  .b { color: red; } // {\n}');
    });

    test('@include, @media, maps and $variables around the property', () => {
        const src = '.a {\n  @include foo(1, (a: b));\n  $m: (k: v, k2: v2);\n  @media (max-width: 1px) { color: red; }\n  user-select: none|;\n  @if $x == 1 { color: blue; }\n}';
        const { out } = atCursor(src, { syntax: 'scss' });
        assert.equal(out, '.a {\n  @include foo(1, (a: b));\n  $m: (k: v, k2: v2);\n  @media (max-width: 1px) { color: red; }\n  -webkit-user-select: none;\n  user-select: none;\n  @if $x == 1 { color: blue; }\n}');
    });

    test('an unterminated block (still being typed) still resolves to the right owner', () => {
        const src = '.a {\n  .b {\n    user-select: none|\n';
        const { out } = atCursor(src, { syntax: 'scss' });
        assert.equal(out, '.a {\n  .b {\n    -webkit-user-select: none;\n    user-select: none\n');
    });
});

describe('#3 no padding before the semicolon, indentation copied from the property line', () => {
    test('the issue snippet: value padded with spaces before `;` comes out trimmed', () => {
        const src = '.a {\n        border-radius: 2px       |;\n}';
        const { out } = atCursor(src, LEGACY);
        assert.equal(out, [
            '.a {',
            '        -webkit-border-radius: 2px;',
            '        -moz-border-radius: 2px;',
            '        -ms-border-radius: 2px;',
            '        -o-border-radius: 2px;',
            '        border-radius: 2px       ;',
            '}'
        ].join('\n'));
    });

    test('exactly one space after the colon, none before the semicolon, tabs kept', () => {
        const src = '.a {\n\tuser-select:none|;\n}';
        const { out } = atCursor(src);
        assert.equal(out, '.a {\n\t-webkit-user-select: none;\n\tuser-select:none;\n}');
    });

    test('indentation is the property line\'s own, not the last whitespace run', () => {
        const src = '.a {\n    user-select:     none    |\n}';
        const { out } = atCursor(src);
        assert.equal(out, '.a {\n    -webkit-user-select: none;\n    user-select:     none    \n}');
    });

    test('a single-line block gets inline prefixes separated by one space', () => {
        const { out } = atCursor('a { color: red; user-select: none|; }');
        assert.equal(out, 'a { color: red; -webkit-user-select: none; user-select: none; }');
    });

    test('CRLF files get CRLF prefix lines', () => {
        const { out } = atCursor('.a {\r\n  user-select: none|;\r\n}');
        assert.equal(out, '.a {\r\n  -webkit-user-select: none;\r\n  user-select: none;\r\n}');
    });

    test('an existing prefixed line with a stale value is updated in place, not duplicated', () => {
        const src = '.a {\n  -webkit-user-select: text;\n  user-select: none|;\n}';
        const { out } = atCursor(src);
        assert.equal(out, '.a {\n  -webkit-user-select: none;\n  user-select: none;\n}');
    });

    test('an existing prefixed line with an empty value gets exactly one space', () => {
        assert.equal(atCursor('.a {\n  -webkit-user-select:;\n  user-select: none|;\n}').out,
            '.a {\n  -webkit-user-select: none;\n  user-select: none;\n}');
        assert.equal(atCursor('.a {\n  -webkit-user-select: ;\n  user-select: none|;\n}').out,
            '.a {\n  -webkit-user-select: none;\n  user-select: none;\n}');
    });

    test('a multi-line comma-continued value is taken whole', () => {
        const src = '.a {\n  transition: color .2s,\n    background .3s|;\n}';
        const { out } = atCursor(src, { prefixes: { transition: ['webkit'] } });
        assert.equal(out, '.a {\n  -webkit-transition: color .2s,\n    background .3s;\n  transition: color .2s,\n    background .3s;\n}');
    });
});

describe('#6 the W3C property comes last', () => {
    const issue = '#my-element {\n\ttransition: margin 0.3s|;\n}';

    test('the exact snippet from the issue produces the expected block', () => {
        const { out } = atCursor(issue, LEGACY);
        assert.equal(out, [
            '#my-element {',
            '\t-webkit-transition: margin 0.3s;',
            '\t-moz-transition: margin 0.3s;',
            '\t-ms-transition: margin 0.3s;',
            '\t-o-transition: margin 0.3s;',
            '\ttransition: margin 0.3s;',
            '}'
        ].join('\n'));
    });

    test('prefixPosition: "after" restores the 0.2.0 layout', () => {
        const { out } = atCursor(issue, Object.assign({ prefixPosition: 'after' }, LEGACY));
        assert.equal(out, [
            '#my-element {',
            '\ttransition: margin 0.3s;',
            '\t-webkit-transition: margin 0.3s;',
            '\t-moz-transition: margin 0.3s;',
            '\t-ms-transition: margin 0.3s;',
            '\t-o-transition: margin 0.3s;',
            '}'
        ].join('\n'));
    });

    test('"after" on a half-typed line leaves the standard line unterminated, as before', () => {
        const { out } = atCursor('.a {\n  user-select: none|\n}', { prefixPosition: 'after' });
        assert.equal(out, '.a {\n  user-select: none\n  -webkit-user-select: none;\n}');
    });

    test('"after" inline with a semicolon', () => {
        const { out } = atCursor('a { user-select: none|; }', { prefixPosition: 'after' });
        assert.equal(out, 'a { user-select: none; -webkit-user-select: none; }');
    });

    test('"after" inline without a semicolon falls back to before so the block stays valid', () => {
        const { out } = atCursor('a { user-select: none| }', { prefixPosition: 'after' });
        assert.equal(out, 'a { -webkit-user-select: none; user-select: none }');
    });

    test('only the missing prefixes are inserted, in table order', () => {
        const src = '.a {\n  -moz-appearance: none;\n  appearance: none|;\n}';
        const { out } = atCursor(src);
        assert.equal(out, '.a {\n  -moz-appearance: none;\n  -webkit-appearance: none;\n  appearance: none;\n}');
    });
});
