# Change Log

## 0.3.0

* Fixed #7 — a colon inside a previous value (`content: ':'`, `url(data:...;base64,...)`) no longer splits that property. The parser is now a small tokenizer that respects strings, comments and parentheses.
* Fixed #2 — in SCSS/LESS, typing above a nested `&` selector no longer inserts prefixes inside the nested block.
* Fixed #3 — no more run of spaces before the semicolon; values are trimmed and the indentation is the property line's own.
* Fixed #6 — prefixed lines are inserted before the standard property so the W3C property comes last. `css-auto-prefix.prefixPosition: "after"` restores the old layout.
* Fixed #5 — every insertion is one edit with undo stops on both sides, so `Ctrl+Z` removes exactly the prefixes, and an undone declaration is not prefixed again until its value changes. Prefixes are added when a declaration is finished (`;`, Enter or `}`), not on every cursor move.
* Fixed #4 — new commands **CSS Auto Prefix: Prefix File** and **CSS Auto Prefix: Prefix Selection** for code that already exists.
* The default prefix table is now a modern set (`user-select`, `appearance`, `backdrop-filter`, `mask`, `clip-path`, `text-size-adjust`, ...). The 0.2.0 table is available behind `css-auto-prefix.includeLegacy`.
* LESS files are handled too.
* Requires VS Code 1.75+. Tests run with plain node (`npm test`).

## 0.2.0

Complete reimplementation for improved stability.
* More intelligent pattern matching requires no semicolons to parse attribute values.
* Attribute modification can take place regardless of css layout (i.e. your code won't get reformatted).

## 0.1.0

Spontaneously combusted through the thickness of a four dimensional universal sheet and began existing as a beta.
