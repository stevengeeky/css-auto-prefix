/**
 * @name CSS Auto Prefixer — core
 * @author Steven O'Riley
 * @desc Pure, editor-independent prefixing. Takes document text (+ an offset
 *       or a range) and returns a list of non-overlapping edits
 *       `{ start, end, text }` expressed as offsets into the ORIGINAL text.
 *
 * Nothing in here touches VS Code, so it can be unit-tested with plain node.
 */
'use strict';

/**
 * Properties that still need a vendor prefix in at least one browser that is
 * commonly supported today. Anything that has been unprefixed everywhere for
 * years lives in LEGACY_PREFIXES instead (opt-in).
 */
const MODERN_PREFIXES = {
    'appearance': ['webkit', 'moz'],
    'backdrop-filter': ['webkit'],
    'background-clip': ['webkit'],
    'box-decoration-break': ['webkit'],
    'clip-path': ['webkit'],
    'hyphens': ['webkit'],
    'initial-letter': ['webkit'],
    'line-clamp': ['webkit'],
    'mask': ['webkit'],
    'mask-clip': ['webkit'],
    'mask-image': ['webkit'],
    'mask-origin': ['webkit'],
    'mask-position': ['webkit'],
    'mask-repeat': ['webkit'],
    'mask-size': ['webkit'],
    'print-color-adjust': ['webkit'],
    'text-size-adjust': ['webkit'],
    'user-select': ['webkit']
};

/** The 0.2.0 table plus the usual suspects. Off by default (see `includeLegacy`). */
const LEGACY_PREFIXES = {
    'animation': ['webkit'],
    'animation-delay': ['webkit'],
    'animation-direction': ['webkit'],
    'animation-duration': ['webkit'],
    'animation-fill-mode': ['webkit'],
    'animation-iteration-count': ['webkit'],
    'animation-name': ['webkit'],
    'animation-play-state': ['webkit'],
    'animation-timing-function': ['webkit'],
    'backface-visibility': ['webkit'],
    'border-radius': ['webkit', 'moz', 'ms', 'o'],
    'box-reflect': ['webkit'],
    'box-shadow': ['webkit', 'moz'],
    'box-sizing': ['webkit', 'moz'],
    'column-count': ['webkit', 'moz'],
    'column-gap': ['webkit', 'moz'],
    'column-rule': ['webkit', 'moz'],
    'column-width': ['webkit', 'moz'],
    'columns': ['webkit', 'moz'],
    'filter': ['webkit'],
    'font-feature-settings': ['webkit', 'moz'],
    'marquee-direction': ['webkit'],
    'marquee-play-count': ['webkit'],
    'marquee-speed': ['webkit'],
    'marquee-style': ['webkit'],
    'perspective': ['webkit', 'moz'],
    'perspective-origin': ['webkit', 'moz'],
    'tab-size': ['moz', 'o'],
    'text-combine-upright': ['webkit', 'moz', 'ms'],
    'text-decoration-color': ['webkit', 'moz'],
    'text-decoration-line': ['webkit', 'moz'],
    'text-decoration-style': ['webkit', 'moz'],
    'text-orientation': ['webkit'],
    'transform': ['webkit', 'moz', 'ms', 'o'],
    'transform-origin': ['webkit', 'moz', 'ms', 'o'],
    'transform-style': ['webkit', 'moz'],
    'transition': ['webkit', 'moz', 'ms', 'o'],
    'transition-delay': ['webkit', 'moz', 'o'],
    'transition-duration': ['webkit', 'moz', 'o'],
    'transition-property': ['webkit', 'moz', 'o'],
    'transition-timing-function': ['webkit', 'moz', 'o'],
    'writing-mode': ['webkit', 'ms']
};

/**
 * Build the effective prefix table from the user's configuration.
 * @param {{prefixes?: object, includeLegacy?: boolean, legacyPrefixes?: object}} cfg
 */
function resolvePrefixes(cfg) {
    cfg = cfg || {};
    const table = {};
    if (cfg.includeLegacy) Object.assign(table, cfg.legacyPrefixes || LEGACY_PREFIXES);
    Object.assign(table, cfg.prefixes || MODERN_PREFIXES);
    return table;
}

function detectNewline(text) {
    return text.indexOf('\r\n') !== -1 ? '\r\n' : '\n';
}

function normalizeOptions(text, options) {
    options = options || {};
    const syntax = options.syntax || 'css';
    return {
        prefixes: options.prefixes || MODERN_PREFIXES,
        prefixPosition: options.prefixPosition === 'after' ? 'after' : 'before',
        syntax: syntax,
        lineComments: options.lineComments !== undefined
            ? !!options.lineComments
            : (syntax === 'scss' || syntax === 'less'),
        newline: options.newline || detectNewline(text)
    };
}

// ---------------------------------------------------------------------------
// Tokenizer. The scanner never looks *inside* a string, a comment or a
// parenthesised group, so a colon, a semicolon or a brace in `content: ':'`,
// `url(data:image/png;base64,...)` or `/* } */` cannot be mistaken for syntax.
// Each skip* function returns the index just past the token.
// ---------------------------------------------------------------------------

function skipString(text, i) {
    const quote = text[i];
    let j = i + 1;
    while (j < text.length) {
        const c = text[j];
        if (c === '\\') { j += 2; continue; }
        if (c === quote) return j + 1;
        if (c === '\n') return j; // unterminated ("bad string"): CSS ends it at the newline
        j++;
    }
    return text.length;
}

function skipBlockComment(text, i) {
    const end = text.indexOf('*/', i + 2);
    return end === -1 ? text.length : end + 2;
}

function skipLineComment(text, i) {
    const end = text.indexOf('\n', i);
    return end === -1 ? text.length : end;
}

function skipParens(text, i) {
    let depth = 0;
    let j = i;
    while (j < text.length) {
        const c = text[j];
        if (c === '"' || c === '\'') { j = skipString(text, j); continue; }
        if (c === '/' && text[j + 1] === '*') { j = skipBlockComment(text, j); continue; }
        if (c === '(') depth++;
        else if (c === ')') { depth--; if (depth === 0) return j + 1; }
        else if (c === '{' || c === '}') break;
        j++;
    }
    // Unterminated (still being typed): treat the '(' as plain text up to the end of its line.
    const nl = text.indexOf('\n', i);
    return nl === -1 ? text.length : nl;
}

/** Index just past the non-structural token at `i`, or `i` itself if text[i] is structural. */
function skipNonCode(text, i, opts) {
    const c = text[i];
    if (c === '"' || c === '\'') return skipString(text, i);
    if (c === '/' && text[i + 1] === '*') return skipBlockComment(text, i);
    if (c === '/' && text[i + 1] === '/' && opts.lineComments) return skipLineComment(text, i);
    if (c === '(') return skipParens(text, i);
    return i;
}

/**
 * Every `{ ... }` block in the document, in order of their opening brace.
 * An unterminated block (still being typed) closes at the end of the text.
 * @returns {{open: number, close: number, parent: number}[]}
 */
function findBlocks(text, options) {
    const opts = normalizeOptions(text, options);
    const blocks = [];
    const stack = [];
    let i = 0;
    while (i < text.length) {
        const j = skipNonCode(text, i, opts);
        if (j !== i) { i = j; continue; }
        const c = text[i];
        if (c === '{') {
            blocks.push({ open: i, close: text.length, parent: stack.length ? stack[stack.length - 1] : -1 });
            stack.push(blocks.length - 1);
        } else if (c === '}') {
            const b = stack.pop();
            if (b !== undefined) blocks[b].close = i;
        }
        i++;
    }
    return blocks;
}

/** The innermost block whose braces enclose `offset`, or null when at top level. */
function blockAt(blocks, offset) {
    let best = null;
    for (const b of blocks) {
        if (b.open < offset && offset <= b.close && (!best || b.open > best.open)) best = b;
    }
    return best;
}

/**
 * The declarations that belong directly to `block` (nested blocks are stepped
 * over, never entered). A value ends at `;`, at the closing brace, or — so
 * that a half-typed line without a semicolon still works — at the end of the
 * line unless the line ends with a comma or the value is still empty.
 */
function parseDeclarations(text, block, blocks, options) {
    const opts = normalizeOptions(text, options);
    const closeOf = new Map();
    for (const b of blocks) closeOf.set(b.open, b.close);
    const skipBlock = (openIndex) => (closeOf.has(openIndex) ? closeOf.get(openIndex) : block.close) + 1;

    const decls = [];
    const end = block.close;
    let i = block.open + 1;

    while (i < end) {
        const c = text[i];
        if (c === ';' || c === ' ' || c === '\t' || c === '\r' || c === '\n' || c === '\f') { i++; continue; }
        const skipped = skipNonCode(text, i, opts);
        if (skipped !== i) { i = skipped; continue; }
        if (c === '{') { i = skipBlock(i); continue; }
        if (c === '}') break;

        // --- statement head: everything up to the first ':' at this level
        const start = i;
        let colon = -1;
        let k = i;
        while (k < end) {
            const s = skipNonCode(text, k, opts);
            if (s !== k) { k = s; continue; }
            const ch = text[k];
            if (ch === ':') { colon = k; break; }
            if (ch === ';' || ch === '{' || ch === '}') break;
            k++;
        }
        if (colon === -1) {
            // `@include x;`, `@media ... {`, a stray `}` — not a declaration
            i = (k < end && text[k] === '{') ? skipBlock(k) : k + 1;
            continue;
        }

        // --- value
        const valueStart = colon + 1;
        let valueEnd = -1;
        let terminator = null;
        let nested = false;
        let m = valueStart;
        while (m < end) {
            const s = skipNonCode(text, m, opts);
            if (s !== m) { m = s; continue; }
            const ch = text[m];
            if (ch === ';') { valueEnd = m; terminator = ';'; break; }
            if (ch === '{') { nested = true; break; }
            if (ch === '}') { valueEnd = m; break; }
            if (ch === '\n') {
                const soFar = text.slice(valueStart, m).trim();
                if (soFar !== '' && !soFar.endsWith(',')) { valueEnd = m; break; }
            }
            m++;
        }
        if (nested) { i = skipBlock(m); continue; } // `&:hover {`, `a:not(.b) {`, `font: { ... }`
        if (valueEnd === -1) valueEnd = Math.min(m, end);

        const raw = text.slice(valueStart, valueEnd);
        const value = raw.trim();
        const lead = raw.length - raw.replace(/^\s+/, '').length;
        const valueTrimStart = valueStart + lead;
        const valueTrimEnd = valueTrimStart + value.length;
        const declEnd = terminator ? valueEnd + 1 : valueEnd;
        const lineStart = text.lastIndexOf('\n', start - 1) + 1;

        decls.push({
            name: text.slice(start, colon).trim(),
            start: start,
            colon: colon,
            valueStart: valueStart,
            valueTrimStart: valueTrimStart,
            valueTrimEnd: valueTrimEnd,
            valueEnd: valueEnd,
            value: value,
            terminator: terminator,
            end: declEnd,
            afterPos: terminator ? declEnd : valueTrimEnd,
            lineStart: lineStart,
            block: block
        });
        i = declEnd;
    }
    return decls;
}

// ---------------------------------------------------------------------------
// Edits
// ---------------------------------------------------------------------------

function isPrefixable(decl, opts) {
    if (!decl || decl.name.charAt(0) === '-' || decl.value === '') return false;
    const list = opts.prefixes[decl.name];
    return Array.isArray(list) && list.length > 0;
}

/** Edits that bring the vendor-prefixed copies of `decl` in line with it. */
function editsForDeclaration(text, decl, decls, opts) {
    if (!isPrefixable(decl, opts)) return [];
    const existing = new Map();
    for (const d of decls) if (d !== decl) existing.set(d.name, d);

    const edits = [];
    const missing = [];
    const tag = (e) => { e.decl = { name: decl.name, value: decl.value }; return e; };
    for (const p of opts.prefixes[decl.name]) {
        const name = '-' + p + '-' + decl.name;
        const ex = existing.get(name);
        if (!ex) { missing.push(name); continue; }
        if (ex.value === decl.value) continue;
        if (ex.value === '') {
            const hasSpace = ex.valueTrimStart > ex.valueStart;
            edits.push({ start: ex.valueTrimStart, end: ex.valueTrimStart, text: (hasSpace ? '' : ' ') + decl.value });
        } else {
            edits.push({ start: ex.valueTrimStart, end: ex.valueTrimEnd, text: decl.value });
        }
    }
    if (!missing.length) return edits.map(tag);

    const before = text.slice(decl.lineStart, decl.start);
    const inline = before.trim() !== '';
    const nl = opts.newline;
    // an unterminated inline declaration (`a { transform: x }`) can only take
    // prefixes in front of it without breaking the block
    const after = opts.prefixPosition === 'after' && !(inline && !decl.terminator);

    if (!inline) {
        const indent = before;
        if (after) {
            edits.push({ start: decl.afterPos, end: decl.afterPos,
                text: missing.map(n => nl + indent + n + ': ' + decl.value + ';').join('') });
        } else {
            edits.push({ start: decl.lineStart, end: decl.lineStart,
                text: missing.map(n => indent + n + ': ' + decl.value + ';' + nl).join('') });
        }
    } else if (after) {
        edits.push({ start: decl.afterPos, end: decl.afterPos,
            text: missing.map(n => ' ' + n + ': ' + decl.value + ';').join('') });
    } else {
        edits.push({ start: decl.start, end: decl.start,
            text: missing.map(n => n + ': ' + decl.value + '; ').join('') });
    }
    return edits.map(tag);
}

/**
 * The declaration whose value the cursor sits in (from just after the colon
 * to just after the semicolon), or null.
 */
function declarationAt(text, offset, options) {
    const opts = normalizeOptions(text, options);
    const blocks = findBlocks(text, opts);
    const block = blockAt(blocks, offset);
    if (!block) return null;
    const decls = parseDeclarations(text, block, blocks, opts);
    const decl = decls.find(d => d.colon + 1 <= offset && offset <= d.end) || null;
    return decl ? { decl: decl, decls: decls } : null;
}

/** Edits for the declaration under `offset` (the as-you-type entry point). */
function prefixAt(text, offset, options) {
    const opts = normalizeOptions(text, options);
    const found = declarationAt(text, offset, opts);
    if (!found) return [];
    return editsForDeclaration(text, found.decl, found.decls, opts);
}

/**
 * Edits for every prefixable declaration that touches [start, end]
 * (the "prefix selection" command, and a typed change). When a block repeats a
 * standard property, only its last occurrence is prefixed.
 */
function prefixRange(text, start, end, options) {
    const opts = normalizeOptions(text, options);
    const blocks = findBlocks(text, opts);
    const edits = [];
    for (const block of blocks) {
        if (block.open >= end || block.close < start) continue;
        const decls = parseDeclarations(text, block, blocks, opts);
        const last = new Map();
        for (const d of decls) if (isPrefixable(d, opts)) last.set(d.name, d);
        for (const d of last.values()) {
            if (d.start < end && d.end >= start) edits.push(...editsForDeclaration(text, d, decls, opts));
        }
    }
    return normalizeEdits(edits);
}

/** Edits for every prefixable declaration in the document (the "prefix file" command). */
function prefixAll(text, options) {
    return prefixRange(text, 0, text.length + 1, options);
}

/** Sort ascending, drop exact duplicates and anything overlapping an earlier edit. */
function normalizeEdits(edits) {
    const sorted = edits.slice().sort((a, b) => a.start - b.start || a.end - b.end);
    const out = [];
    let cursor = -1;
    for (const e of sorted) {
        const prev = out[out.length - 1];
        if (prev && prev.start === e.start && prev.end === e.end && prev.text === e.text) continue;
        if (e.start < cursor) continue;
        out.push(e);
        cursor = Math.max(cursor, e.end);
    }
    return out;
}

// ---------------------------------------------------------------------------
// As-you-type. A declaration is prefixed once, when it is finished: the typed
// change contains ';', a newline or '}' (one editor.edit, one undo step).
// ---------------------------------------------------------------------------

const TRIGGER = /[;\n}]/;

/**
 * Edits for a document change event. `changes` are VS Code-shaped
 * `{ rangeOffset, rangeLength, text }` entries in PRE-change coordinates,
 * ordered bottom-up (as VS Code sends them); `text` is the POST-change
 * document text.
 */
function editsForChanges(text, changes, options) {
    const opts = normalizeOptions(text, options);
    const edits = [];
    let blocks = null;
    for (let i = 0; i < changes.length; i++) {
        const ch = changes[i];
        if (!TRIGGER.test(ch.text)) continue;
        // a change's post-change offset shifts by the deltas of the changes above it
        let shift = 0;
        for (let j = i + 1; j < changes.length; j++) shift += changes[j].text.length - changes[j].rangeLength;
        const start = ch.rangeOffset + shift;
        const end = start + ch.text.length;
        edits.push(...prefixRange(text, start, end, opts));
        if (ch.text.indexOf('}') !== -1) {
            // closing a block finishes its last, semicolon-less declaration too
            if (!blocks) blocks = findBlocks(text, opts);
            for (const b of blocks) {
                if (b.close >= start && b.close < end) edits.push(...prefixRange(text, b.open, b.close, opts));
            }
        }
    }
    return normalizeEdits(edits);
}

/** Copy of `edits` with `postStart`: where each one sits once all of them are applied. */
function postOffsets(edits) {
    let delta = 0;
    return normalizeEdits(edits).map(e => {
        const copy = Object.assign({}, e, { postStart: e.start + delta });
        delta += e.text.length - (e.end - e.start);
        return copy;
    });
}

/**
 * Given the edits we last applied (with postStart) and the changes of an
 * *undo* event, the "name:value" keys of the declarations whose prefixes the
 * user just took back. Those must not be prefixed again until their value changes.
 */
function undoneKeys(applied, changes) {
    const keys = new Set();
    if (!applied) return keys;
    for (const ch of changes) {
        const hit = applied.find(e => e.postStart === ch.rangeOffset && e.text.length === ch.rangeLength);
        if (hit && hit.decl) keys.add(hit.decl.name + ':' + hit.decl.value);
    }
    return keys;
}

/** Drop edits whose declaration is in `keys` (a Set of "name:value"). */
function withoutUndone(edits, keys) {
    if (!keys || !keys.size) return edits;
    return edits.filter(e => !e.decl || !keys.has(e.decl.name + ':' + e.decl.value));
}

/** Apply `edits` (offsets into `text`) and return the new text. Handy for tests. */
function applyEdits(text, edits) {
    const sorted = edits.slice().sort((a, b) => b.start - a.start || b.end - a.end);
    let out = text;
    for (const e of sorted) out = out.slice(0, e.start) + e.text + out.slice(e.end);
    return out;
}

module.exports = {
    MODERN_PREFIXES,
    LEGACY_PREFIXES,
    resolvePrefixes,
    detectNewline,
    findBlocks,
    blockAt,
    parseDeclarations,
    declarationAt,
    prefixAt,
    prefixRange,
    prefixAll,
    normalizeEdits,
    editsForChanges,
    postOffsets,
    undoneKeys,
    withoutUndone,
    applyEdits
};
