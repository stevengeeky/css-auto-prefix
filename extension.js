/**
 * @name CSS Auto Prefixer
 * @author Steven O'Riley
 * @desc Auto prefixes certain CSS attributes as you type
 */

let vscode = require('vscode');

let enabled = true;
let prefixes = {};
let dontUpdate = false;

function activate(context) {
    let prefixer = Prefixer();
    let config = vscode.workspace.getConfiguration("css-auto-prefix");
    prefixes = config.get("prefixes");
    enabled = config.get("enabled");
    
    vscode.workspace.onDidChangeConfiguration(() => {
        config = vscode.workspace.getConfiguration("css-auto-prefix");
        prefixes = config.get("prefixes");
        enabled = config.get("enabled");
    });

    vscode.window.onDidChangeTextEditorSelection(prefixer.update, this);
}
exports.activate = activate;

function deactivate() {
}

function Prefixer() {
    let update = async function() {
        let editor = vscode.window.activeTextEditor;
        let document = editor.document;
        let selection = editor.selection;
        
        if (document.getText().length == 0)
            return;
        
        if (!dontUpdate && enabled && /^(css|scss)$/i.test(document.languageId)) {
            let current_line = document.lineAt(editor.selection.start).text;
            
            if (selection.isEmpty) {
                let comment_between = in_between(selection, current_line, "/*", "*/");
                if (!comment_between.after_start && !comment_between.before_end) {
                    let range = get_range(selection, document);
                    
                    if (range) {
                        let brackets = new vscode.Selection(range.start.start.line, range.start.start.character, range.end.start.line, range.end.start.character);
                        let current_token_name = token_at_cursor(selection, document);
                        let current_token_value = get_token_value(brackets, document, current_token_name) || "";
                        
                        if (prefixes[current_token_name]) {
                            let modifications = [];
                            
                            for (let prefix of prefixes[current_token_name]) {
                                modifications.push({
                                    token: '-' + prefix + '-' + current_token_name,
                                    value: current_token_value
                                });
                            }
                            
                            dontUpdate = true;
                            let edits = set_token_values(brackets, document, modifications);
                            
                            try {
                                await editor.edit(function(builder) {
                                    for (let edit of edits) {
                                        if (edit.type == 'insert') {
                                            let start_character = edit.start.character;
                                            
                                            if (edit.start.line == range.start.start.line) {
                                                start_character += range.start.start.character;
                                            }
                                            
                                            builder.replace(new vscode.Selection(edit.start.line, start_character, edit.start.line, start_character), edit.value);
                                        } else if (edit.type == 'replace') {
                                            let start_character = edit.start.character;
                                            let end_character = edit.end.character;
                                            
                                            if (edit.start.line == range.start.start.line) {
                                                start_character += range.start.start.character;
                                            }
                                            if (edit.end.line == range.start.start.line) {
                                                end_character += range.start.start.character;
                                            }
                                            
                                            builder.replace(new vscode.Selection(edit.start.line, start_character, edit.end.line, end_character), edit.value);
                                        }
                                    }
                                }, { undoStopAfter: false, undoStopBefore: false })
                                .then(function() {
                                    editor.selection = new vscode.Selection(editor.selection.start, editor.selection.start);
                                    dontUpdate = false;
                                });
                            } catch (ex) {
                                console.error(ex);
                            }
                        }
                    }    
                }
                
                //editor.selection = new vscode.Selection(range.start.anchor, range.end.anchor);
            }
            
        }
    };
    
    return {
        update: function() {
            update();
        }
    };
}

function range_greater_than(a, b) {
    if (a.line > b.line) return true;
    if (a.line < b.line) return false;
    
    return a.character > b.character;
}

function lines_between_selection(selection, document) {
    let start = selection.start;
    let end = selection.end;
    
    if (range_greater_than(start, end)) {
        start = selection.end;
        end = selection.start;
    }
    
    if (start.line == end.line) {
        return [{
            line: start.line,
            text: document
                .lineAt(start.line).text
                .substring(start.character, end.character)
        }];
    }
    
    let line, result = [];
    for (let l = start.line; l <= end.line; l++) {
        line = document.lineAt(l).text;
        if (l == start.line) line = line.substring(start.character);
        else if (l == end.line) line = line.substring(0, end.character);
        
        result.push({
            line: l,
            text: line
        });
    }
    
    return result;
}

function value_between_selection(selection, document) {
    let start = selection.start;
    let end = selection.end;
    
    if (range_greater_than(start, end)) {
        start = selection.end;
        end = selection.start;
    }
    
    if (start.line == end.line) {
        return document
                .lineAt(start.line).text
                .substring(start.character, end.character);
    }
    
    let line, lines = [];
    for (let l = start.line; l <= end.line; l++) {
        line = document.lineAt(l).text;
        if (l == start.line) line = line.substring(start.character);
        else if (l == end.line) line = line.substring(0, end.character);
        
        lines.push(line);
    }
    
    return lines.join("\n");
}

function get_token_value(selection, document, token) {
    let selection_text = value_between_selection(selection, document);
    let token_matcher = new RegExp('(^|\\{|\\}|[ \\r\\t\\n]+|;)' + escape_regex(token) + '[ \\t\\r]*:', 'g');
    if (!token_matcher.test(selection_text)) return null;
    
    let token_text = selection_text.match(token_matcher)[0];
    let text_from_token = selection_text.substring(selection_text.indexOf(token_text));
    let text_from_colon = text_from_token.substring(text_from_token.indexOf(":") + 1);
    
    let value_at_end = (text_from_colon.match(/[\w\-]+\W*\:|;|[\n\r]/g) || [])[0];
    let index_end_of_value = text_from_token.length;
    if (value_at_end) index_end_of_value = text_from_token.indexOf(":")
                                            + 1 + text_from_colon.indexOf(value_at_end);
    
    let value = text_from_token.substring(text_from_token.indexOf(":") + 1, index_end_of_value);
    
    return value;
}

function set_token_values(selection, document, pairs) {
    let lines = lines_between_selection(selection, document);
    let result = [];
    
    for (let i = 0; i < pairs.length; i++) {
        for (let l = 0; l < lines.length; l++) {
            let line = lines[l];
            let pair = pairs[i];
            let current_value = get_token_value(selection, document, pair.token);
            let token_matcher = new RegExp('(^|[ \\r\\t\\n]+|;|\\{|\\})' + escape_regex(pair.token) + '[ \\t\\r]*:', 'g');
            
            if (line.text.match(token_matcher) && typeof current_value == 'string') {
                let token_text = line.text.match(token_matcher)[0];
                let text_from_token = line.text.substring(line.text.indexOf(token_text));
                let value_index = line.text.indexOf(token_text) + text_from_token.indexOf(":") + 1;
                
                result.push({
                    type: 'replace',
                    start: {
                        line: line.line,
                        character: value_index,
                    },
                    end: {
                        line: line.line,
                        character: value_index + current_value.length,
                    },
                    value: pair.value
                });
                
                break;
            } else {
                if (l == lines.length - 1) {
                    // for now, just take immediate whitespace as indentation
                    // could have a smarter algorithm but worried about it being expensive
                    // i.e. having a linear computational runtime
                    let approx_whitespace = (line.text.match(/[ \t]*/g) || [])
                                            .filter(x => x.length > 0).reverse()[0] || "\t";
                    
                    let newline = approx_whitespace
                                + pair.token + ":"
                                + pair.value + ";";
                    
                    // should we break a line before appending the new attribute?
                    // for now break if \n at end
                    if (line.text.trim().length == 0) {
                        result.push({
                            type: 'insert',
                            start: {
                                line: line.line,
                                character: line.text.length,
                            },
                            value: newline + '\n'
                        });
                    } else {
                        result.push({
                            type: 'insert',
                            start: {
                                line: line.line,
                                character: line.text.length,
                            },
                            value: newline + " "
                        });
                    }
                    
                    break;
                } else {
                    continue;
                }
            }
        }
    }
    
    return result;
}

function token_at_cursor(selection, document) {
    let current_line = document.lineAt(selection.start).text;
    let colon_index = current_line
                        .substring(0, selection.start.character)
                        .lastIndexOf(":");
    if (colon_index == -1) return null;
    
    let token_beginning = colon_index;
    let reached_non_whitespace = false;
    for (let i = colon_index; i > 0; i--) {
        if (/[;{}]/.test(current_line.charAt(i - 1))) {
            break;
        } else if (/[ \t\r]/.test(current_line.charAt(i - 1))) {
            if (reached_non_whitespace) break;
        } else {
            reached_non_whitespace = true;
        }
        token_beginning = i - 1;
    }
    
    return current_line.substring(token_beginning, colon_index);
}

function escape_regex(text) {
    return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
}

function get_range(selection, document) {
    var pos = selection;
    var raw = "", newStuff = "";
    var fline = document.lineAt(pos.start);
    var first = in_between(pos, fline.text, "{", "}");
    
    var start = null, end = null;
    var no_beginning = false, no_end = false;
    
    if (first.after_start && first.before_end)
        return make_range( fline.text.substring(first.start + 1, first.end), new vscode.Selection(pos.start.line, first.start + 1, pos.start.line, first.start + 1), new vscode.Selection(pos.start.line, first.end, pos.start.line, first.end), true );
    
    var line = pos.start.line;
    var whitespace = "";
    
    while (line >= 0) {
        newStuff = document.lineAt(line).text;
        
        var end_brack = newStuff.lastIndexOf("{");
        var other = newStuff.lastIndexOf("}");
        
        if (end_brack > other) {
            start = new vscode.Selection(line, end_brack + 1, line, end_brack + 1);
            raw = newStuff.substring(end_brack + 1) + "\n" + raw;
            break;
        }
        else if (other != -1 && line != pos.start.line || other != -1 && line == pos.start.line && pos.start.character > other) {
            start = new vscode.Selection(line, other + 1, line, other + 1);
            raw = newStuff.substring(other + 1) + "\n" + raw;
            no_beginning = true;
            break;
        }
        else {
            raw = newStuff + "\n" + raw;
            if (whitespace == "")
                whitespace = newStuff.substring(0, document.lineAt(line).firstNonWhitespaceCharacterIndex);
        }        
        --line;
        
    }
    if (start == null)
        start = new vscode.Selection(0, 0, 0, 0);
    
    line = pos.start.line;
    while (line < document.lineCount) {
        newStuff = document.lineAt(line).text;
        
        var startind = newStuff.indexOf("{"), endind = newStuff.indexOf("}");
        var rev = endind == -1 && startind != -1 || startind != -1 && startind < endind;
        
        if (startind == -1 && endind != -1 || endind != -1 && endind < startind) {
            if (line == pos.start.line)
                raw = raw.substring(0, raw.length - newStuff.length) + newStuff.substring(0, endind);
            else
                raw += "\n" + newStuff.substring(0, endind);
            end = new vscode.Selection(line, endind, line, endind);
            break;
        }
        else if (rev && pos.start.line != line || rev && pos.start.line == line && pos.start.character < startind) {
            if (line == pos.start.line)
                raw = raw.substring(0, raw.length - newStuff.length) + newStuff.substring(0, startind);
            else
                raw += "\n" + newStuff.substring(0, startind);
            end = new vscode.Selection(line, startind, line, startind);
            no_end = true;
            break;
        }
        else if (line != pos.start.line)
            raw += "\n" + newStuff;
        ++line;
    }
    if (line == document.lineCount)
        end = new vscode.Selection(document.lineCount, document.lineAt(document.lineCount - 1).text.length);
    
    if (no_end && no_beginning)
        return false;
    
    return make_range( raw, start, end, whitespace );
}

function make_range(value, start, end, same_line) {
    same_line = same_line || false;
    return {
        value: value,
        start: start,
        end: end,
        same_line: same_line
    };
}

function in_between(position, line, a, b) {
    var beginning = line.substring(0, position.start.character);
    var end = line.substring(position.start.character);
    
    var blind = beginning.lastIndexOf(a), blind2 = beginning.lastIndexOf(b);
    var bind = end.indexOf(b), bind2 = end.indexOf(a);
    
    var after_start = blind != -1 && (blind2 == -1 || blind2 < blind);
    var before_end = bind != -1 && (bind2 == -1 || bind < bind2);
    var start = after_start ? blind : ( blind2 == -1 ? 0 : blind2 );
    var end = (before_end ? bind : ( bind2 == -1 ? end.length : bind2 )) + position.start.character;
    
    return { 
        between: after_start || before_end,
        after_start: after_start,
        before_end: before_end,
        start: start,
        end: end
    };
}

exports.deactivate = deactivate;