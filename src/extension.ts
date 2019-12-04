'use strict';
import * as vscode from 'vscode';

class DoxygenParseException extends Error {
    constructor(message: string) {
        super(message);
        this.name = "Doxygen Parsing Exception";
    }
}

function doxyFormatText(text: string) {
    return text.replace(/^\s*\*/gm, ` *`);
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

function generateParamSnippet(param: FunctionParameter, snippet: vscode.SnippetString, index: number, indent: string = '', paramMaxWidth=0, lineStartSpace=' '): vscode.SnippetString {
    snippet.appendText(`${indent} *${lineStartSpace}@param`);
    if (param.direction)
        snippet.appendText(`[${param.direction}]`);
    snippet.appendText(` ${param.name} `)
    snippet.appendText(' '.repeat(paramMaxWidth - param.name.length));
    if (param.description)
        snippet.appendPlaceholder(doxyFormatText(param.description.trim()), index);
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
        return [indent, indent];
    else if (!tabs)
        return [' ', ' '];
    return [indent, indent];
}

export function generateSnippet(func: FunctionDefinition, indent='', startText=''): vscode.SnippetString {

    // var [startText, indent] = getStartAndIndent(func.indent, func.hasDoxyblock);

    var snippet_start = `/**`;
    var snippet_end = indent + ' */';
    var lineStart = `${indent} *`;
    var lineStartSpace = getConfig('first_line') ? '  ' : ' ';
    var lineSeparator = lineStart + '\n';

    var snippet = new vscode.SnippetString(startText + indent + snippet_start);

    if (getConfig('first_line'))
        snippet.appendText(' ');
    else
        snippet.appendText(`\n${lineStart}${lineStartSpace}`);

    var tabstopIndex = 1;

    if (func.isMacro && getConfig('macro_def'))
        snippet.appendText(`@def ${func.name}\n${lineSeparator}${lineStart}${lineStartSpace}`);

    if (getConfig('brief'))
        snippet.appendText('@brief ');

    if (func.description) {
        func.description = doxyFormatText(func.description);
        func.description = func.description.replace(/^\s*@def\s*\S+\s*/g, '').trim();
        func.description = func.description.replace(/@brief\s*/g, '').trim();
        func.description = func.description.replace(/^(\s*\*\s*(\r?\n)?)+/g, '');
        console.log('DESCRIPTION: ' + func.description);
        func.description = func.description.replace(/(\s*\*\s*(\r?\n)?)+$/, '').trim();

        if (func.hasDoxyblock && func.description.match(/^.*(?:\r?\n)\s*\*?\s*(?:\r?\n)/)) {
            var lines = func.description.match(/[^\r\n]+/g);
            func.description = lines.slice(2).join('\n');

            snippet.appendPlaceholder(lines[0], tabstopIndex++);
            snippet.appendText('\n');
            snippet.appendText(lineSeparator);
            snippet.appendText(lineStart);
            func.description = func.description.replace(/^[ \t]*\*[ \t]*/gm, lineStart + lineStartSpace);
            func.description = func.description.replace(/^\s*\*\s*/g, lineStartSpace);
        }

        snippet.appendPlaceholder(func.description, tabstopIndex++);
    }
    else {
        snippet.appendTabstop(tabstopIndex++);
    }
    snippet.appendText('\n');

    if (func.parameters.length > 0) {
        snippet.appendText(lineSeparator);

        var paramMaxWidth = getConfig('align_params') && [...func.parameters].sort((a, b) => b.name.length - a.name.length)[0].name.length;
        func.parameters.forEach((p, index) => {
            snippet = generateParamSnippet(p, snippet, tabstopIndex++, indent, paramMaxWidth, lineStartSpace);
        });
    }
    if (func.returns) {
        snippet.appendText(lineSeparator);
        if (func.returnDescriptions.length > 0)
            func.returnDescriptions.forEach((r: string, index: number) => {
                let [_, retkind, space, text] = r.match(/^(\S+)(\s*)([\s\S]*)/);
                snippet.appendText(`${lineStart}${lineStartSpace}@${retkind}`);
                if (text) {
                    snippet.appendText(space);
                    snippet.appendPlaceholder(doxyFormatText(text), tabstopIndex++);
                }
                else {
                    snippet.appendText(' ');
                    snippet.appendTabstop(tabstopIndex++);
                }
                snippet.appendText('\n');
            });
        else {
            snippet.appendText(`${lineStart}${lineStartSpace}@${getConfig('default_return')} `);
            snippet.appendTabstop(tabstopIndex++);
            snippet.appendText('\n');
        }
    }
    snippet.appendText(snippet_end);
    return snippet;
}

function generateSnippetOfWholeComment(fullComment: string, indent: string='', start=''): vscode.SnippetString {
    var match = fullComment.match(/\/\*\*\s*([\s\S]*?)\*\//);

    var contents = match ? match[1].trim().replace(/\n\s*\*/g, '\n *').replace(/^\s*\*\s*/, '\n * ') : '';
    console.log(`FULL COMMENT: --${contents}--`)

    var snippet = new vscode.SnippetString(`${start}/** `);
    snippet.appendPlaceholder(contents);
    if (contents.match(/(\r\n|\r|\n)/))
        snippet.appendText('\n');
    snippet.appendText(' */');
    return snippet
}

function generateSnippetFromDoc(cursor: vscode.Position, document: vscode.TextDocument): [vscode.SnippetString, vscode.Position | vscode.Range] {
    var beforeCursor = document.getText(new vscode.Range(new vscode.Position(Math.max(0, cursor.line - 100), 0), cursor)).replace('\r\n', '\n');
    var afterCursor = document.getText(new vscode.Range(cursor, new vscode.Position(Math.max(0, cursor.line + 20), 0))).replace('\r\n', '\n');

    // find first statement separator after cursor, and end the text there:
    var index = afterCursor.search(/(;|#|\)\s*[{;])[\s\S]*/);
    if (index >= 0) {
        afterCursor = afterCursor.slice(0, index+1);
    }

    var cleanBefore = beforeCursor.replace(/[\s\S]*([{};#])/g, '$1');
    var text = cleanBefore + afterCursor;
    var fullText = beforeCursor + afterCursor;

    var thisLine = afterCursor.slice(0, afterCursor.indexOf('\n'));

    var func: FunctionDefinition;
    if (thisLine.startsWith('#define')) {
        // This is a macro, and macro names must be defined on a single line
        func = getMacro(thisLine);

        if (func) {
            text = text.slice(0, text.lastIndexOf(func.fullSignature));
        } else {
            text = text.slice(0, text.lastIndexOf('#define'));
        }
    }
    else {
        var strippedText = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^#[\s\S]*(?<!\\)\r?\n/, '');
        // find the first block end after the cursor, and cut off there
        var funcText = strippedText.match(/(?:(?:\w+[*\s]+)+\(\s*\*+(?:\w+[*\s]+)*\w+\s*\)|(?:\w+[*\s]+)+\w+)\s*\([^;]*?\)$/);
        if (funcText) {
            text = text.slice(0, text.lastIndexOf(funcText[0]));
            func = getFunction(funcText[0]) || getFunctionType(funcText[0]);
        } else {
            text = cleanBefore + thisLine.match(/[ \t]*/)[0];
        }
    }

    var commentMatch = text.match(/([ \t]*)(\/\*\*[\s\S]*\*\/)[ \t]*\n?[ \t]*$/)
    if (commentMatch) {
        var fullComment = commentMatch[2];
        var lineIndent = commentMatch[1];
        console.log(`Found full comment ${fullComment}`);

        var blockStart = document.offsetAt(cursor) - beforeCursor.length + fullText.lastIndexOf(fullComment);

        var range = new vscode.Range(document.positionAt(blockStart), document.positionAt(blockStart + fullComment.length));
        if (func) {
            func.merge(getFunctionFromDoxygen(fullComment), true);
            return [generateSnippet(func), range];
        } else {
            return [generateSnippetOfWholeComment(fullComment, lineIndent), range];
        }
    }
    else {
        console.log('No comment found');
        var indentMatch = text.match(/[ \t]*$/);
        var indent = indentMatch ? indentMatch[0] : '';
        if (func) {
            var blockStart = document.offsetAt(cursor) - beforeCursor.length + fullText.indexOf(func.fullSignature) - indent.length - 1;
            var snippetPos = document.positionAt(blockStart);
            return [generateSnippet(func, indent.slice(snippetPos.character), '\n'), snippetPos];
        }
        else {
            var snippetPos = cursor.translate(-1);
            return [generateSnippetOfWholeComment('', indent, '\n' + indent), snippetPos];
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

                var lineStartSpace = ' ';

                var starPos = line.indexOf('*');
                var isBeforeStar = selectionPos.character <= starPos;
                var prevLine = e.document.lineAt(selectionPos.line - 1).text;
                var wasStartLine = !!prevLine.trim().match(/^\s*\/\*\*+/);

                var prevLineIndentMatch = prevLine.match(/^\s*[/*]*(\s*(?:[@\\]param(?:\s*\[.*?\])?\s+\w+\s+)?)/);
                if (prevLineIndentMatch) {
                    var prevLineIndent = prevLineIndentMatch[1].length;
                    lineStartSpace = ' '.repeat(prevLineIndent);
                }

                var indent: string;

                if (isBeforeStar) {
                    if (prevLine.trim().length === 0) {
                        indent = prevLine.match(/^\s*/)[0];
                        insertion = ' '.repeat(starPos - selectionPos.character);
                        // insertion = indent.length > selectionPos.character ? indent + ' '.repeat(indent.length - selectionPos.character + 1) : '';
                        insertion += '*' + lineStartSpace;
                        selectionPos = selectionPos.translate(-1);
                    }
                    else {
                        indent = prevLine.match(/^\s*/)[0];

                        var firstNonSpace = line.search(/\S/);

                        if (line.trim() === '*/') {
                            insertion = ' '.repeat((wasStartLine ? 1 : 0) - firstNonSpace);
                        } else {
                            insertion = ' '.repeat(Math.max(0, selectionPos.character - indent.length + (wasStartLine ? 1 : 0) + ((prevLine.trim().length === 0) ? 1 : 0)));
                            insertion += '*' + lineStartSpace;
                        }
                    }
                }
                else {
                    insertion = (wasStartLine ? ' *' : '*') + lineStartSpace;
                }

                vscode.window.activeTextEditor.edit(editBuilder => {
                    editBuilder.insert(selectionPos, insertion);
                }, { undoStopBefore: false, undoStopAfter: false });
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
