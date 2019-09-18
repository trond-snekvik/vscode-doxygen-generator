'use strict';
import * as vscode from 'vscode';

class DoxygenParseException extends Error {
    constructor(message: string) {
        super(message);
        this.name = "Doxygen Parsing Exception";
    }
}

function doxyFormatText(text: string, indent:string='') {
    return text.trim().replace(/^\s*\*/gm, `\n${indent} *`);
}

function getConfig(key: string) {
    var config = vscode.workspace.getConfiguration("doxygen-generator");
    var val = config.get(key);
    return (val == undefined) ? config.inspect(key).defaultValue : val;
}

function stripLineEndings(str: string): string {
    return str.substring(Math.max(str.lastIndexOf('\n'), str.lastIndexOf('\r'))).replace(/(\r\n|\n|\r)/gm, '');
}

export class FunctionParameter {
    name: string;
    direction?: string;
    index?: number;
    type?: string;
    description?: string;

    static directionFromType(type: string): string {
        var direction = 'in';
        if (type && type.includes('*') && !type.includes('const'))
            direction += ',out'
        return direction;
    }

    constructor(name: string, type?: string) {
        this.name = name;
        this.type = type;
        this.direction = getConfig("param_dir") ? FunctionParameter.directionFromType(type) : null;
    }
}

export class FunctionDefinition {
    name?: string;
    returns: boolean;
    parameters: FunctionParameter[];
    description: string;
    returnDescriptions?: string[];
    fullSignature?: string;
    indent: string;
    hasDoxyblock: boolean;
    isMacro: boolean;

    constructor(name?: string, returns?: boolean, parameters?: FunctionParameter[]) {
        if (name)
            this.name = name;
        else
            this.name = "";

        if (returns)
            this.returns = returns;
        else
            this.returns = false;

        if (parameters)
            this.parameters = parameters;
        else
            this.parameters = [];
        this.returnDescriptions = [];
        this.indent = '';
        this.description = '';
        this.hasDoxyblock = false;
        this.isMacro = false;
    }

    /** Merge the other definition into this. */
    merge(other: FunctionDefinition, adoptParamDirection: boolean) {
        // Adopt description if we don't have one.
        if (other.description && !this.description)
            this.description = other.description;

        // The parameters the other had, that we didn't have.
        var othersOrphans : FunctionParameter[] = other.parameters.filter(param => !this.parameters.find(p => p.name == param.name));
        // The parameters we had, that they didn't have.
        var ourOrphans: FunctionParameter[] = this.parameters.filter(param => !other.parameters.find(p => p.name == param.name));

        var pairs: {ours: FunctionParameter, theirs: FunctionParameter}[] = [];

        // pair params with the same name
        other.parameters.forEach(theirParam => {
            var ourParam = this.parameters.find(ourParam => (ourParam.name == theirParam.name));
            if (ourParam)
                pairs.push({ours: ourParam, theirs: theirParam});
        });
        // pair orphans with the same index (the name probably changed)
        ourOrphans.forEach(ourParam => {
            var theirParam = othersOrphans.find(theirParam => (theirParam.index == ourParam.index));
            if (theirParam)
                pairs.push({ours: ourParam, theirs: theirParam});
        });

        pairs.forEach(pair => {
            if (pair.theirs.description && !pair.ours.description) pair.ours.description = pair.theirs.description;
            if (adoptParamDirection) pair.ours.direction = pair.theirs.direction;
            if (pair.theirs.type && !pair.ours.type) pair.ours.type = pair.theirs.type;
        })

        if (this.returnDescriptions.length == 0 && this.returns)
            this.returnDescriptions = other.returnDescriptions.slice();
        if (other.hasDoxyblock)
            this.hasDoxyblock = true;
    }
}

function parseFuncParams(text: string): FunctionParameter[] {
    var params = new Array<FunctionParameter>();

    if (text.trim() != 'void') {
        text.split(',').forEach((textParam, index) => {
            var paramMatch = textParam.match(/\s*(.*)\s+\**([\w_][\w_\d]*)\s*/);
            if (paramMatch) {
                var param = new FunctionParameter(paramMatch[2], paramMatch[1]);
                param.index = index;
                params.push(param);
            }
        });
    }
    return params;
}

export function getFunction(text: string) : FunctionDefinition {
    var func = new FunctionDefinition();
    var prev_comment_end = text.lastIndexOf('*/')
    if (prev_comment_end >= 0)
    {
        text = text.slice(prev_comment_end);
    }
    // find the last function in the text
    var match = text.match(/(\s*)(((?:[*a-zA-Z_][*\w]*\s+|\**)+)([\w_\d*]+)\s*\(([^()]*?)\))\s*(;|{|\s*$)/);
    if (!match)
        return null;
    func.indent = stripLineEndings(match[1]);
    func.fullSignature = match[2];
    func.name = match[4];
    func.returns = (!match[3].includes('void') || match[3].includes('*'));
    func.parameters = parseFuncParams(match[5]);
    return func;
}

export function getMacro(text: string) : FunctionDefinition {
    var func = new FunctionDefinition();
    // find the last function in the text
    var match = text.match(/^(\s*)(#define\s+([\w][\w*]+)\(([^()]*?)\))\s*/m);
    if (!match)
        return null;
    func.indent = stripLineEndings(match[1]);
    func.fullSignature = match[2];
    func.name = match[3];
    func.returns = false;
    func.isMacro = true;
    (match[4] as string).split(',').filter(p => p.trim() != '...').forEach((textParam, index) => {
        var param = new FunctionParameter(textParam.replace(/\\$/gm, '').trim());
        param.index = index;
        func.parameters.push(param);
    });

    return func;
}

export function getFunctionType(text: string) : FunctionDefinition {
    var func = new FunctionDefinition();
    // find the last function in the text
    var match = text.match(/(\s*)((?:typedef\s+)?((?:[*a-zA-Z_][*\w]*\s+|\**)+)\(\*(?:[*a-zA-Z_][*\w]*\s+|\**)*\s*([\w_\d*]+)\)\s*\(([^()]*?)\))[\s;]*$/);
    if (!match)
        return null;
    func.indent = stripLineEndings(match[1]);
    func.fullSignature = match[2];
    func.name = match[4];
    func.returns = (!match[3].includes('void') || match[3].includes('*'));
    func.parameters = parseFuncParams(match[5]);

    return func;
}

function getLastDoxyBlock(text: string): string {
    var fullComment = text.match(/[\S\s]*(\/\*\*[\S\s]*?\*\/)\r?\n?$/);
    if (!fullComment || fullComment.length == 0) return null;
    return fullComment[1].trim();
}

/**
 * Parses the text as function documentation.
 */
export function getFunctionFromDoxygen(text: string) : FunctionDefinition {
    var func = new FunctionDefinition();
    var description = text.match(/^\/\*\*\s*([\s\S]*?)(?:@param|@ret|\*\/$)/);
    var params = text.match(/@param[\s\S]+?(?=@param|@ret|@note|@warning|@info|\*\/$)/g);
    var returns = text.match(/@(?:returns|return|retval)\s+[\s\S]*?(?=@param|@ret|@note|@warning|@info|\*\/$)/g);
    func.hasDoxyblock = true;
    if (description.length > 1) {
        func.description = description[1];
        func.description.replace(/@brief\s*/, ' ');
    }
    if (params) {
        params.forEach((text, index) => {
            var match = text.match(/@param(?:\[([^\]]+)\])?\s*([\w\d_]+)(?:\s+([\s\S]*))/);
            if (match.length > 0) {
                var param = new FunctionParameter(match[2]);
                param.direction = getConfig('param_dir') ? match[1] : null;
                param.description = match[3].replace(/(?:\s*\*)+\s*$/, '');
                param.index = index;
                func.parameters.push(param);
            }
        });
    }
    if (returns) {
        returns.forEach((text) => {
            var match = text.match(/@([\s\S]*?)(?:\s*\*?\s*$)/);
            if (match && match.length > 1) {
                func.returns = true;
                func.returnDescriptions.push(match[1]);
            }
        });
    }
    return func;
}

function generateParamSnippet(param: FunctionParameter, snippet: vscode.SnippetString, index: number, indent: string = ''): vscode.SnippetString {
    snippet.appendText(`${indent} * @param`);
    if (param.direction)
        snippet.appendText(`[${param.direction}]`);
    snippet.appendText(` ${param.name} `)
    if (param.description)
        snippet.appendPlaceholder(param.description.trim(), index);
    else
        snippet.appendTabstop(index);
    snippet.appendText('\n');
    return snippet;
}

function getStartAndIndent(indent: string, has_comment: boolean): [string, string] {
    const tabs = (!vscode.window.activeTextEditor.options.insertSpaces);
    console.log(`Indent: --${indent}-- (${indent.length}) (${tabs ? 'tabs' : 'spaces'})\n`);

    /* Weird vscode behavior: If there's already an indented block,
     * we'll have to make the indent a single space to avoid it adding
     * the indent twice, but only if we're indenting with spaces. */
    if (indent.length == 0 || !has_comment)
        return ['\n' + indent, indent];
    else if (!tabs)
        return [' ', ' '];
    return [indent, indent];
}

export function generateSnippet(func: FunctionDefinition): vscode.SnippetString {

    var [startText, indent] = getStartAndIndent(func.indent, func.hasDoxyblock);

    var snippet_start = `/**`;
    var snippet_end = indent + ' */';
    var line_start = `${indent} *`;
    var line_separator = line_start + '\n';

    var snippet = new vscode.SnippetString(startText + snippet_start);

    if (getConfig('first_line'))
        snippet.appendText(' ');
    else
        snippet.appendText(`\n${line_start} `);

    var tabstopIndex = 1;

    if (func.isMacro && getConfig('macro_def'))
        snippet.appendText(`@def ${func.name}\n${line_separator}${line_start} `);

    if (getConfig('brief'))
        snippet.appendText('@brief ');

    if (func.description) {
        func.description = doxyFormatText(func.description, indent);
        func.description = func.description.replace(/^\s*@def\s*\S+\s*/g, '').trim();
        func.description = func.description.replace(/@brief\s*/g, '').trim();
        func.description = func.description.replace(/^(\s*\*\s*(\r\n|\r|\n)?)+/g, '');
        console.log('DESCRIPTION: ' + func.description);
        func.description = func.description.replace(/(\s*\*\s*(\r\n|\r|\n)?)+$/, '').trim();

        if (func.hasDoxyblock && func.description.match(/^.*(?:\r\n|\r|\n)\s*\*?\s*(?:\r\n|\r|\n)/)) {
            var lines = func.description.match(/[^\r\n]+/g);
            func.description = lines.slice(2).join('\n');

            snippet.appendPlaceholder(lines[0], tabstopIndex++);
            snippet.appendText('\n');
            snippet.appendText(line_separator);
            snippet.appendText(line_start);
            func.description = func.description.replace(/^\s*\*\s*/g, ' ');
        }

        snippet.appendPlaceholder(func.description, tabstopIndex++);
    }
    else {
        snippet.appendTabstop(tabstopIndex++);
    }
    snippet.appendText('\n');

    if (func.parameters.length > 0) {
        snippet.appendText(line_separator);
        func.parameters.forEach((p, index) => {
            snippet = generateParamSnippet(p, snippet, tabstopIndex++, indent);
        });
    }
    if (func.returns) {
        snippet.appendText(line_separator);
        if (func.returnDescriptions.length > 0)
            func.returnDescriptions.forEach((r: string, index: number) => {
                let [_, retkind, space, text] = r.match(/^(\S+)(\s*)([\s\S]*)/);
                snippet.appendText(`${line_start} @${retkind}`);
                if (text) {
                    snippet.appendText(space);
                    snippet.appendPlaceholder(text, tabstopIndex++);
                }
                else {
                    snippet.appendText(' ');
                    snippet.appendTabstop(tabstopIndex++);
                }
                snippet.appendText('\n');
            });
        else {
            snippet.appendText(`${line_start} @${getConfig('default_return')} `);
            snippet.appendTabstop(tabstopIndex++);
            snippet.appendText('\n');
        }
    }
    snippet.appendText(snippet_end);
    return snippet;
}

function generateSnippetOfWholeComment(fullComment: string, lineIndent: string=''): vscode.SnippetString {

    var match = fullComment.match(/\/\*\*\s*([\s\S]*?)\*\//);

    var contents = match ? match[1].trim() : '';
    console.log(`FULL COMMENT: --${contents}--`)
    var [start, indent] = getStartAndIndent(lineIndent, fullComment.length > 0);

    var snippet = new vscode.SnippetString(`${start}/** `);
    snippet.appendPlaceholder(doxyFormatText(contents, indent));
    if (contents.match(/(\r\n|\r|\n)/))
        snippet.appendText('\n' + indent);
    snippet.appendText(' */');
    return snippet
}

function generateSnippetFromDoc(cursor: vscode.Position, document: vscode.TextDocument): [vscode.SnippetString, vscode.Position | vscode.Range] {
    var text = document.getText(new vscode.Range(0, 0, cursor.line + 50, 9999)).replace('\r\n', '\n');
    var fromCurrentLine = document.getText(new vscode.Range(cursor.line, 0, cursor.line + 50, 9999));
    var func: FunctionDefinition;
    if (fromCurrentLine.startsWith('#define')) {
        // This is a macro, and macro names must be defined on a single line
        func = getMacro(fromCurrentLine);

        if (func) {
            text = text.slice(0, text.lastIndexOf(func.fullSignature));
        } else {
            text = text.slice(0, text.lastIndexOf('#define'));
        }

        // find the last closing brace to reduce the regex search
        var blockStart = Math.max(text.lastIndexOf(';'), text.lastIndexOf('}'));
        if (blockStart > 0)
            text = text.slice(blockStart);
        else
            blockStart = 0;
    }
    else {
        // find the first block end after the cursor, and cut off there
        var matcher = new RegExp('((?:.*(?:\\r\\n|\\n|\\r)){' + (cursor.line - 1) + '}[\\s\\S]*?)[;{}]', 'm');
        var newTextMatch = text.match(matcher);
        if (newTextMatch && newTextMatch.length > 0) {
            text = newTextMatch[1]
        }

        // find the last closing brace to reduce the regex search
        var blockStart = Math.max(text.lastIndexOf(';'), text.lastIndexOf('}'), text.lastIndexOf('{'));
        if (blockStart > 0)
            text = text.slice(blockStart);
        else
            blockStart = 0;
        func = getFunction(text) || getFunctionType(text);

        if (func) {
            text = text.slice(0, text.lastIndexOf(func.fullSignature))
        }
    }
    var commentEnd = text.lastIndexOf('\n');
    var commentBlock = text.substr(0, commentEnd);
    var indentMatch = text.substr(commentEnd).match(/\s*/);
    var lineIndent = indentMatch ? stripLineEndings(indentMatch[0]) : '';

    console.log(`text:\n${commentBlock}----\n`);


    // cut off the text where the function we found begins, to find the doxyblock
    var fullComment = getLastDoxyBlock(commentBlock)
    if (fullComment) {
        console.log(`Found full comment ${fullComment}`);
        var range = new vscode.Range(document.positionAt(blockStart + commentBlock.lastIndexOf(fullComment)), document.positionAt(blockStart + commentBlock.length));
        if (func) {
            func.merge(getFunctionFromDoxygen(fullComment), true);
            return [generateSnippet(func), range];
        } else {
            return [generateSnippetOfWholeComment(fullComment, lineIndent), range];
        }
    }
    else {
        console.log('No comment found');
        var snippetPos = document.positionAt(blockStart + commentBlock.length);
        // return the snippet and the position where it should be placed
        if (func) {
            return [generateSnippet(func), snippetPos];
        }
        else {
            return [generateSnippetOfWholeComment('', lineIndent), snippetPos];
        }
    }
}

// class DoxyCodeActionProvider implements vscode.CodeActionProvider {
//     provideCodeActions(document: vscode.TextDocument,
//                        range: vscode.Range,
//                        context: vscode.CodeActionContext,
//                        token: vscode.CancellationToken): vscode.ProviderResult<vscode.Command[]> {

//         return [];
//     }
// }

class DoxyCodeFormatProvider implements vscode.OnTypeFormattingEditProvider {
    constructor() {

    }
    provideOnTypeFormattingEdits(document: vscode.TextDocument, position: vscode.Position, ch: string, options: vscode.FormattingOptions, token: vscode.CancellationToken): vscode.ProviderResult<vscode.TextEdit[]> {
        if (document.getText(new vscode.Range(new vscode.Position(0, 0), position)).match(/\/\*\*[\s\S]*(?!>\*\/)/)) {
            return [new vscode.TextEdit(new vscode.Range(position, position), ' * ')];
        }
    }
}

const tags = [
    {label: '{'               },
    {label: '}'               },
    {label: 'msc'             },
    {label: 'endmsc'          },
    {label: 'note'            },
    {label: 'file'            },
    {label: 'details'         },
    {label: 'short'           },
    {label: 'since'           },
    {label: 'test'            },
    {label: 'brief'           },
    {label: 'return'          },
    {label: 'returns'         },
    {label: 'warning'         },
    {label: 'todo'            },
    {label: 'dir'             },
    {label: 'static'          },
    {label: 'author'          },
    {label: 'authors'         },
    {label: 'attention'       },
    {label: 'bug'             },
    {label: 'copyright'       },
    {label: 'date'            },
    {label: 'deprecated'      },
    {label: 'invariant'       },
    {label: 'par'             },
    {label: 'parblock'        },
    {label: 'endparblock'     },
    {label: 'remarks'         },
    {label: 'result'          },
    {label: 'version'         },
    {label: 'secreflist'      },
    {label: 'endsecreflist'   },
    {label: 'tableofcontents' },
    {label: 'arg'             },
    {label: 'manonly'         },
    {label: 'htmlonly'        },
    {label: 'endhtmlonly'     },
    {label: 'rtfonly'         },
    {label: 'endrtfonly'      },
    {label: 'latexonly'       },
    {label: 'endlatexonly'    },
    {label: 'xml'             },
    {label: 'xmlonly'         },
    {label: 'n'               },
    {label: 'internal'        },
    {label: 'defgroup',      parameter: 'name'               },
    {label: 'addtogroup',    parameter: 'name'               },
    {label: 'ingroup',       parameter: 'name'               },
    {label: 'weakgroup',     parameter: 'name'               },
    {label: 'sa',            parameter: 'name'               },
    {label: 'see',           parameter: 'name'               },
    {label: 'ref',           parameter: 'name'               },
    {label: 'class',         parameter: 'name'               },
    {label: 'enum',          parameter: 'name'               },
    {label: 'union',         parameter: 'name'               },
    {label: 'struct',        parameter: 'name'               },
    {label: 'retval',        parameter: 'value'              },
    {label: 'subpage',       parameter: 'pagename'           },
    {label: 'subsection',    parameter: 'subsection-name'    },
    {label: 'section',       parameter: 'section-name'       },
    {label: 'subsubsection', parameter: 'subsubsection-name' },
    {label: 'var',           parameter: 'name'               },
    {label: 'fn',            parameter: 'name'               },
    {label: 'property',      parameter: 'name'               },
    {label: 'typedef',       parameter: 'name'               },
    {label: 'def',           parameter: 'name'               },
    {label: 'exception',     parameter: 'exception-object'   },
    {label: 'throw',         parameter: 'exception-object'   },
    {label: 'throws',        parameter: 'exception-object'   },
    {label: 'anchor',        parameter: 'word'               },
    {label: 'cite',          parameter: 'label'              },
    {label: 'link',          parameter: 'link-object'        },
    {label: 'endlink'},
    {label: 'refitem',       parameter: 'name'               },
    {label: 'include',       parameter: 'file-name'          },
    {label: 'dontinclude',   parameter: 'file-name'          },
    {label: 'includelineno', parameter: 'file-name'          },
    {label: 'includedoc',    parameter: 'file-nae'           },
    {label: 'line',          parameter: 'pattern'            },
    {label: 'skip',          parameter: 'pattern'            },
    {label: 'skipline',      parameter: 'pattern'            },
    {label: 'snippet',       parameter: 'file-name'          },
    {label: 'snippetlineno', parameter: 'file-name'          },
    {label: 'snippetdoc',    parameter: 'file-name'          },
    {label: 'until',         parameter: 'pattern'            },
    {label: 'verbinclude',   parameter: 'file-name'          },
    {label: 'htmlinclude',   parameter: 'file-name'          },
    {label: 'latexinclude',  parameter: 'file-name'          },
    {label: 'copydoc',       parameter: 'link-object'        },
    {label: 'copybrief',     parameter: 'link-object'        },
    {label: 'copydetails',   parameter: 'link-object'        },
    {label: 'emoji',         parameter: 'name'               },
    {label: 'dotfile',       parameter: 'file'               },
    {label: 'mscfile',       parameter: 'file'               },
    {label: 'diafile',       parameter: 'file'               },
    {label: 'li',            parameter: 'item-description'   },
    {label: 'cond',          parameter: 'condition'          },
    {label: 'endcond'},
];

function inDoxyblock(document: vscode.TextDocument, position: vscode.Position): boolean {
    const maxLen = 100;
    var start = position.line > maxLen ? position.translate(-maxLen) : new vscode.Position(0, 0);
    var text = document.getText(new vscode.Range(start, position));
    var lastStart = text.lastIndexOf('/**');
    var lastEnd = text.lastIndexOf('*/');
    return (lastStart > lastEnd);
}

class DoxyCompletionProvider implements vscode.CompletionItemProvider {
    items: vscode.CompletionItem[];

    constructor() {
        this.items = tags.map(t => {
            var item = new vscode.CompletionItem(t.label, vscode.CompletionItemKind.Value);
            if (t.parameter) {
                item.insertText = new vscode.SnippetString(t.label + ' ');
                item.insertText.appendPlaceholder(t.parameter);
                item.insertText.appendText(' ');
            }
            else
                item.insertText = item.label + ' ';

            return item;
        });
    }
    provideCompletionItems(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): vscode.ProviderResult<vscode.CompletionItem[] | vscode.CompletionList> {
        if (inDoxyblock(document, position))
            return this.items;
        return [];
    }
}

class DoxyRangeFormatProvider implements vscode.DocumentRangeFormattingEditProvider {
    provideDocumentRangeFormattingEdits(document: vscode.TextDocument, range: vscode.Range, options: vscode.FormattingOptions, token: vscode.CancellationToken): vscode.ProviderResult<vscode.TextEdit[]> {
        if (inDoxyblock(document, range.start)) {
            var text = document.getText(range);
            var indent = text.match(/^\s*/);
            var startsEmpty = text.replace(/^\s*\*\s*/, '').match(/^[^\r\n]+/)
            var lines = text.match(/[^\r\n]+/g).map(line => {
                line = line.replace(/^\s*\*/, '').trim();
                if (line.length == 0) {
                    line = '\n\n';
                }
                return line;
            }).join(' ');

            var newLines = new Array<string>();
            do {
                var slice = lines.slice(0, 80).lastIndexOf(' ');
                var newline = lines.search(/(\r\n|\r|\n)/);
                if (newline >= 0 && newline < slice)
                    slice = newline;
                newLines.push(lines.slice(0, slice).trim());
                lines = lines.slice(slice).trim();
            } while (lines.length > 80);
            newLines.push(lines);
            return [new vscode.TextEdit(range, newLines.reduce((prev, line) => `${prev}${indent}* ${line}`))];
        }
        return [];
    }

}

export function activate(context: vscode.ExtensionContext) {

    let disposable = vscode.commands.registerCommand('doxygen-generator.generate', () => {
        if (['c', 'cpp'].indexOf(vscode.window.activeTextEditor.document.languageId) >= 0) {
            let lineStart = new vscode.Position(vscode.window.activeTextEditor.selection.start.line, 0);

            let [snippet, position] = generateSnippetFromDoc(lineStart, vscode.window.activeTextEditor.document);

            if (snippet)
                vscode.window.activeTextEditor.insertSnippet(snippet, position);
        }
    });
    context.subscriptions.push(disposable);

    // disposable = vscode.languages.registerCodeActionsProvider(['c', 'cpp'], new DoxyCodeActionProvider());
    // context.subscriptions.push(disposable);

    // disposable = vscode.languages.registerOnTypeFormattingEditProvider(['c', 'cpp'], new DoxyCodeFormatProvider(), '@');
    disposable = vscode.workspace.onDidChangeTextDocument(e => {
        if (['c', 'cpp'].indexOf(e.document.languageId) >= 0 && e.contentChanges[0].text.match(/^(\r\n|\r|\n)\s*$/)) {
            var selectionPos = new vscode.Position(e.contentChanges[0].range.start.line + 1, e.contentChanges[0].text.replace(/(\r\n|\r|\n)/, '').length);
            if (inDoxyblock(e.document, selectionPos)) {
                var line = e.document.lineAt(selectionPos.line).text;
                var insertion : string;

                var starPos = line.indexOf('*');
                var isBeforeStar = selectionPos.character <= starPos;
                var prevLine = e.document.lineAt(selectionPos.line - 1).text;
                var wasStartLine = !!prevLine.trim().match(/^\s*\/\*\*+/);
                // var wasSingleLineComment = !!(prevLine.match(/\/\*\*/) && line.match(/\*\//));
                // if (line.trim() === '*/' && prevLine.trim().length !== 0) {
                //     return;
                // }

                if (isBeforeStar) {
                    if (prevLine.trim().length === 0) {
                        var indent = prevLine.match(/^\s*/)[0];
                        insertion = ' '.repeat(starPos - selectionPos.character);
                        // insertion = indent.length > selectionPos.character ? indent + ' '.repeat(indent.length - selectionPos.character + 1) : '';
                        insertion += '* ';
                        selectionPos = selectionPos.translate(-1);
                    }
                    else {
                        var indent = prevLine.match(/^\s*/)[0];
                        var firstNonSpace = line.search(/\S/);
                        insertion = indent + ' '.repeat(Math.max(0, indent.length - firstNonSpace + (wasStartLine ? 1 : 0) + ((prevLine.trim().length === 0) ? 1 : 0)));

                        if (line.trim() !== '*/') {
                            insertion += '* ';
                        }
                    }
                }
                else {
                    insertion = wasStartLine ? ' * ' : '* ';
                }

                vscode.window.activeTextEditor.edit(editBuilder => {
                    editBuilder.insert(selectionPos, insertion);
                }, { undoStopBefore: false, undoStopAfter: true });
            }
        }
    });
    context.subscriptions.push(disposable);

    vscode.languages.registerDocumentRangeFormattingEditProvider(['c', 'cpp'], new DoxyRangeFormatProvider());

    disposable = vscode.languages.registerCompletionItemProvider(['c', 'cpp'], new DoxyCompletionProvider(), '@', '\\')
    context.subscriptions.push(disposable);
}

export function deactivate() {
}