/**
 * @name CSS Auto Prefixer
 * @desc Auto prefixes certain CSS attributes as you type
 *
 * This file is only the VS Code adapter. Everything that decides *what* to
 * insert lives in lib/prefixer.js and is tested with plain node (npm test).
 */
'use strict';

const vscode = require('vscode');
const prefixer = require('./lib/prefixer');

const LANGUAGES = new Set(['css', 'scss', 'less']);

/** True while one of our own edits is being applied. */
let applying = false;
/** The edits we applied last, per document, so an undo of them can be recognised. */
const lastApplied = new Map();
/** "name:value" keys the user undid, per document. Never re-prefixed until the value changes. */
const undone = new Map();

function settings(document) {
    const cfg = vscode.workspace.getConfiguration('css-auto-prefix', document);
    return {
        enabled: cfg.get('enabled', true),
        options: {
            prefixes: prefixer.resolvePrefixes({
                prefixes: cfg.get('prefixes'),
                includeLegacy: cfg.get('includeLegacy', false),
                legacyPrefixes: cfg.get('legacyPrefixes')
            }),
            prefixPosition: cfg.get('prefixPosition', 'before'),
            syntax: LANGUAGES.has(document.languageId) ? document.languageId : 'css',
            newline: document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n'
        }
    };
}

function editorFor(document) {
    const active = vscode.window.activeTextEditor;
    if (active && active.document === document) return active;
    return vscode.window.visibleTextEditors.find(e => e.document === document) || null;
}

/**
 * Apply all edits in ONE editor.edit with an undo stop on both sides, so a
 * single Ctrl+Z takes back exactly the prefixes and nothing else (#5).
 */
async function apply(editor, edits) {
    edits = prefixer.normalizeEdits(edits);
    if (!edits.length) return 0;
    const document = editor.document;
    applying = true;
    try {
        const ok = await editor.edit(builder => {
            for (const e of edits) {
                const start = document.positionAt(e.start);
                if (e.start === e.end) builder.insert(start, e.text);
                else builder.replace(new vscode.Range(start, document.positionAt(e.end)), e.text);
            }
        }, { undoStopBefore: true, undoStopAfter: true });
        if (!ok) return 0;
        lastApplied.set(document.uri.toString(), prefixer.postOffsets(edits));
        return new Set(edits.map(e => e.decl && e.decl.name)).size;
    } finally {
        applying = false;
    }
}

function onDidChangeTextDocument(event) {
    const document = event.document;
    if (!LANGUAGES.has(document.languageId)) return;
    const key = document.uri.toString();

    // Never fight the undo stack: an undo is final until the value changes.
    if (event.reason === vscode.TextDocumentChangeReason.Undo) {
        const keys = prefixer.undoneKeys(lastApplied.get(key), event.contentChanges);
        if (keys.size) {
            const set = undone.get(key) || new Set();
            for (const k of keys) set.add(k);
            undone.set(key, set);
        }
        return;
    }
    if (event.reason === vscode.TextDocumentChangeReason.Redo) {
        undone.delete(key);
        return;
    }
    if (applying) return;

    const { enabled, options } = settings(document);
    if (!enabled) return;
    const editor = editorFor(document);
    if (!editor) return;

    const edits = prefixer.withoutUndone(
        prefixer.editsForChanges(document.getText(), event.contentChanges, options),
        undone.get(key));
    if (edits.length) apply(editor, edits).catch(err => console.error('css-auto-prefix', err));
}

function report(count) {
    vscode.window.setStatusBarMessage(
        count ? `css-auto-prefix: prefixed ${count} propert${count === 1 ? 'y' : 'ies'}` : 'css-auto-prefix: nothing to prefix',
        3000);
}

async function prefixFile() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    const { options } = settings(editor.document);
    report(await apply(editor, prefixer.prefixAll(editor.document.getText(), options)));
}

async function prefixSelection() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    const document = editor.document;
    const { options } = settings(document);
    const text = document.getText();
    const edits = [];
    for (const sel of editor.selections) {
        if (sel.isEmpty) edits.push(...prefixer.prefixAt(text, document.offsetAt(sel.active), options));
        else edits.push(...prefixer.prefixRange(text, document.offsetAt(sel.start), document.offsetAt(sel.end), options));
    }
    report(await apply(editor, edits));
}

function activate(context) {
    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument(onDidChangeTextDocument),
        vscode.workspace.onDidCloseTextDocument(doc => {
            lastApplied.delete(doc.uri.toString());
            undone.delete(doc.uri.toString());
        }),
        vscode.commands.registerCommand('css-auto-prefix.prefixFile', prefixFile),
        vscode.commands.registerCommand('css-auto-prefix.prefixSelection', prefixSelection)
    );
}

function deactivate() {}

exports.activate = activate;
exports.deactivate = deactivate;
