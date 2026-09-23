'use strict';
// Smoke test of the VS Code adapter against a minimal stub of the 'vscode' module.
// It checks the plumbing (positionAt, the edit builder, undo/redo reasons, commands),
// not VS Code itself.
const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

// ---- a tiny vscode --------------------------------------------------------
class Position { constructor(line, character) { this.line = line; this.character = character; } }
class Range { constructor(start, end) { this.start = start; this.end = end; } }
class Selection extends Range { constructor(a, b) { super(a, b); this.anchor = a; this.active = b; this.isEmpty = a.line === b.line && a.character === b.character; } }
const EndOfLine = { LF: 1, CRLF: 2 };
const TextDocumentChangeReason = { Undo: 1, Redo: 2 };

function makeDocument(text, languageId) {
    const doc = {
        languageId, text, eol: EndOfLine.LF, uri: { toString: () => 'file:///x.' + languageId },
        getText: () => doc.text,
        positionAt(offset) {
            const before = doc.text.slice(0, offset); const line = before.split('\n').length - 1;
            return new Position(line, before.length - before.lastIndexOf('\n') - 1);
        },
        offsetAt(pos) {
            const lines = doc.text.split('\n'); let off = 0;
            for (let i = 0; i < pos.line; i++) off += lines[i].length + 1;
            return off + pos.character;
        }
    };
    return doc;
}

function makeEditor(doc) {
    const editor = {
        document: doc, selections: [new Selection(new Position(0, 0), new Position(0, 0))], editCalls: [],
        async edit(fn, opts) {
            const ops = [];
            fn({
                insert: (pos, text) => ops.push({ start: doc.offsetAt(pos), end: doc.offsetAt(pos), text }),
                replace: (range, text) => ops.push({ start: doc.offsetAt(range.start), end: doc.offsetAt(range.end), text })
            });
            editor.editCalls.push({ ops, opts });
            ops.sort((a, b) => b.start - a.start);
            let t = doc.text; for (const o of ops) t = t.slice(0, o.start) + o.text + t.slice(o.end);
            // VS Code fires the change event for our own edit while it is being applied
            const changes = ops.map(o => ({ rangeOffset: o.start, rangeLength: o.end - o.start, text: o.text }));
            doc.text = t; fire({ document: doc, contentChanges: changes, reason: undefined });
            return true;
        }
    };
    return editor;
}

const listeners = { change: [], close: [] };
const commands = {};
const config = { enabled: true, prefixPosition: 'before', includeLegacy: false };
const statusMessages = [];
function fire(e) { for (const l of listeners.change) l(e); }

const vscode = {
    Position, Range, Selection, EndOfLine, TextDocumentChangeReason,
    window: { activeTextEditor: null, visibleTextEditors: [], setStatusBarMessage: (m) => statusMessages.push(m) },
    workspace: {
        getConfiguration: () => ({ get: (k, d) => (k in config ? config[k] : d) }),
        onDidChangeTextDocument: (l) => { listeners.change.push(l); return { dispose() {} }; },
        onDidCloseTextDocument: (l) => { listeners.close.push(l); return { dispose() {} }; }
    },
    commands: { registerCommand: (id, fn) => { commands[id] = fn; return { dispose() {} }; } }
};
const realLoad = Module._load;
Module._load = function (request, ...rest) { return request === 'vscode' ? vscode : realLoad.call(this, request, ...rest); };
const ext = require('../extension');
ext.activate({ subscriptions: [] });

const tick = () => new Promise(r => setTimeout(r, 0));

describe('extension.js adapter', () => {
    beforeEach(() => { statusMessages.length = 0; config.enabled = true; config.includeLegacy = false; });

    test('typing `;` in a css document applies one edit with undo stops on both sides', async () => {
        const doc = makeDocument('.a {\n  user-select: none;\n}', 'css');
        const editor = makeEditor(doc); vscode.window.activeTextEditor = editor;
        fire({ document: doc, contentChanges: [{ rangeOffset: doc.text.indexOf(';'), rangeLength: 0, text: ';' }], reason: undefined });
        await tick();
        assert.equal(doc.text, '.a {\n  -webkit-user-select: none;\n  user-select: none;\n}');
        assert.equal(editor.editCalls.length, 1, 'the change fired by our own edit must not cause a second edit');
        assert.deepEqual(editor.editCalls[0].opts, { undoStopBefore: true, undoStopAfter: true });
    });

    test('an Undo event marks the declaration and a following Enter does not re-prefix it', async () => {
        const doc = makeDocument('.a {\n  user-select: none;\n}', 'css');
        const editor = makeEditor(doc); vscode.window.activeTextEditor = editor;
        fire({ document: doc, contentChanges: [{ rangeOffset: doc.text.indexOf(';'), rangeLength: 0, text: ';' }], reason: undefined });
        await tick();
        const inserted = editor.editCalls[0].ops[0];
        doc.text = doc.text.slice(0, inserted.start) + doc.text.slice(inserted.start + inserted.text.length);
        fire({ document: doc, contentChanges: [{ rangeOffset: inserted.start, rangeLength: inserted.text.length, text: '' }], reason: TextDocumentChangeReason.Undo });
        await tick();
        assert.equal(editor.editCalls.length, 1, 'undo must not trigger an edit');
        const at = doc.text.indexOf(';') + 1;
        doc.text = doc.text.slice(0, at) + '\n  ' + doc.text.slice(at);
        fire({ document: doc, contentChanges: [{ rangeOffset: at, rangeLength: 0, text: '\n  ' }], reason: undefined });
        await tick();
        assert.equal(editor.editCalls.length, 1, 'an undone declaration stays undone');
        assert.equal(doc.text, '.a {\n  user-select: none;\n  \n}');
    });

    test('non-css documents and enabled=false are ignored; commands still work', async () => {
        const doc = makeDocument('.a {\n  user-select: none;\n}', 'javascript');
        const editor = makeEditor(doc); vscode.window.activeTextEditor = editor;
        fire({ document: doc, contentChanges: [{ rangeOffset: doc.text.indexOf(';'), rangeLength: 0, text: ';' }], reason: undefined });
        await tick();
        assert.equal(editor.editCalls.length, 0);

        const css = makeDocument('.a {\n  user-select: none;\n}', 'css');
        const ed2 = makeEditor(css); vscode.window.activeTextEditor = ed2; config.enabled = false;
        fire({ document: css, contentChanges: [{ rangeOffset: css.text.indexOf(';'), rangeLength: 0, text: ';' }], reason: undefined });
        await tick();
        assert.equal(ed2.editCalls.length, 0);
        await commands['css-auto-prefix.prefixFile']();
        assert.equal(css.text, '.a {\n  -webkit-user-select: none;\n  user-select: none;\n}');
        assert.match(statusMessages.pop(), /prefixed 1 property/);
        await commands['css-auto-prefix.prefixFile']();
        assert.match(statusMessages.pop(), /nothing to prefix/);
    });

    test('prefixSelection: a range prefixes what it covers, an empty selection the declaration under the cursor', async () => {
        const doc = makeDocument('.a { mask: x; }\n.b { user-select: none; }', 'scss');
        const editor = makeEditor(doc); vscode.window.activeTextEditor = editor;
        editor.selections = [new Selection(new Position(1, 0), new Position(1, 24))];
        await commands['css-auto-prefix.prefixSelection']();
        assert.equal(doc.text, '.a { mask: x; }\n.b { -webkit-user-select: none; user-select: none; }');
        editor.selections = [new Selection(new Position(0, 12), new Position(0, 12))];
        await commands['css-auto-prefix.prefixSelection']();
        assert.equal(doc.text, '.a { -webkit-mask: x; mask: x; }\n.b { -webkit-user-select: none; user-select: none; }');
    });

    test('includeLegacy turns the 0.2.0 table back on', async () => {
        config.includeLegacy = true;
        const doc = makeDocument('#my-element {\n\ttransition: margin 0.3s;\n}', 'css');
        const editor = makeEditor(doc); vscode.window.activeTextEditor = editor;
        await commands['css-auto-prefix.prefixFile']();
        assert.equal(doc.text, '#my-element {\n\t-webkit-transition: margin 0.3s;\n\t-moz-transition: margin 0.3s;\n\t-ms-transition: margin 0.3s;\n\t-o-transition: margin 0.3s;\n\ttransition: margin 0.3s;\n}');
    });
});
