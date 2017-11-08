'use strict';
import * as vscode from 'vscode';

var LINE_WIDTH = 100;

function doxyFormatText(text: string) {
    return text.replace(/^\s*\*/gm, '\n *');
}

export class FunctionParameter {
    name: string;
    direction: string; 
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
        this.direction = FunctionParameter.directionFromType(type);
    }
}

export class FunctionDefinition {
    name?: string;
    returns: boolean;
    parameters: FunctionParameter[];
    description?: string;
    returnDescriptions?: string[];
    fullSignature?: string;

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
    }

    /** Merge the other definition into this. */
    merge(other: FunctionDefinition, adoptParamDirection: boolean) {
        // Adopt description if we don't have one.
        if (other.description && !this.description) 
            this.description = other.description;

        // The parameters the other had, that we didn't have.
        var othersOrphans : FunctionParameter[] = other.parameters.filter((param: FunctionParameter) => !this.parameters.find(p => p.name == param.name)); 
        // The parameters we had, that they didn't have.
        var ourOrphans: FunctionParameter[] = this.parameters.filter((param: FunctionParameter) => !other.parameters.find(p => p.name == param.name)); 

        var pairs: {ours: FunctionParameter, theirs: FunctionParameter}[] = [];

        // pair params with the same name
        other.parameters.forEach((theirParam: FunctionParameter) => {
            var ourParam = this.parameters.find((ourParam: FunctionParameter) => (ourParam.name == theirParam.name));
            if (ourParam) 
                pairs.push({ours: ourParam, theirs: theirParam});
        });
        // pair orphans with the same index (the name probably changed)
        ourOrphans.forEach(ourParam => {
            var theirParam = other.parameters.find((theirParam: FunctionParameter) => (theirParam.index == ourParam.index));
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
    }
}

export function getFunction(text: string) : FunctionDefinition {
    var func = new FunctionDefinition();
    // find the last function in the text
    var match = text.match(/(((?:[\w_\d*]+\s+|\**)+)([\w_\d*]+)\s*\(([\s\S]*?)\))\s*(;|{|\s*$)[^{}();]*$/);
    if (!match) 
        return null; 
    func.fullSignature = match[1];
    func.name = match[3];
    func.returns = (!match[2].includes('void') || match[2].includes('*'));

    if ((match[4] as string).trim() != 'void') {
        (match[4] as string).split(',').forEach(textParam => {
            var paramMatch = textParam.match(/\s*(.*)\s+\**([\w_][\w_\d]*)\s*/);
            if (!paramMatch)
                return null;
            var param = new FunctionParameter(paramMatch[2], paramMatch[1]);
            func.parameters.push(param);
        });
    }
    return func;
}

function getLastDoxyBlock(text: string): string {
    var fullComment = text.match(/.*[\s\S]*(\/\*\*[\S\s]*?\*\/)/);
    if (!fullComment || fullComment.length == 0) return null;
    return fullComment[1];
}

/** 
 * Parses the text as function documentation. 
 */
export function getFunctionFromDoxygen(text: string) : FunctionDefinition {
    var func = new FunctionDefinition();
    var description = text.match(/^\/\*\*\s*([\s\S]*?)(?:@param|@ret|\*\/$)/);
    var params = text.match(/@param[\s\S]+?(?=@param|@ret|@note|@warning|@info|\*\/$)/g);
    var returns = text.match(/@(?:returns|return|retval)\s+[\s\S]*?(?=@param|@ret|@note|@warning|@info|\*\/$)/g);
    
    if (description.length > 1) func.description = description[1];
    if (params) {
        params.forEach((text, index) => {
            var match = text.match(/@param(?:\[([^\]]+)\])?\s*([\w\d_]+)(?:\s+([\s\S]*))/);
            if (match.length > 0) {
                var param = new FunctionParameter(match[2]);
                param.direction = match[1];
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

function generateParamSnippet(param: FunctionParameter, snippet: vscode.SnippetString, index: number): vscode.SnippetString {
    snippet.appendText(` * @param`);
    if (param.direction)
        snippet.appendText(`[${param.direction}]`);
    snippet.appendText(` ${param.name} `)
    if (param.description) 
        snippet.appendPlaceholder(param.description, index);
    else
        snippet.appendTabstop(index);
    snippet.appendText('\n');
    return snippet;
}

var SNIPPET_START = '/**\n';
var SNIPPET_END = ' */\n';
var LINE_SEPARATOR = ' *\n';

export function generateSnippet(func: FunctionDefinition): vscode.SnippetString {
    var snippet = new vscode.SnippetString(SNIPPET_START);
    
    snippet.appendText(' * ');
    var tabstopIndex = 1;

    if (func.description) {
        func.description = doxyFormatText(func.description);
        func.description = func.description.replace(/^\s*\*\s*/, '');
        func.description = func.description.replace(/(?:(?:\s*\*)+\s*)+$/, '\n *');
        snippet.appendPlaceholder(func.description, tabstopIndex++);
        snippet.appendText('\n');
    }
    else {
        snippet.appendTabstop(tabstopIndex++);
        snippet.appendText('\n' + LINE_SEPARATOR);
    }
    
    if (func.parameters.length > 0) {
        func.parameters.forEach((p, index) => {
            snippet = generateParamSnippet(p, snippet, tabstopIndex++);
        });
    }
    if (func.returns) {
        snippet.appendText(LINE_SEPARATOR);
        if (func.returnDescriptions.length > 0) 
            func.returnDescriptions.forEach((r: string, index: number) => {
                let [_, retkind, space, text] = r.match(/^(\S+)(\s*)([\s\S]*)/);
                snippet.appendText(' * @'+retkind);
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
            snippet.appendText(' * @returns ');
            snippet.appendTabstop(tabstopIndex++);
            snippet.appendText('\n');
        }
    }
    snippet.appendText(SNIPPET_END);
    return snippet;
}

function generateSnippetFromDoc(cursor: vscode.Position, document: vscode.TextDocument): [vscode.SnippetString, vscode.Position | vscode.Range] {
    var text = document.getText(new vscode.Range(0, 0, cursor.line + 50, 9999));
    // find the first block end after the cursor, and cut off there
    var matcher = new RegExp('((?:.*(?:\\r\\n|\\n|\\r)){' + (cursor.line - 1) + '}[\\s\\S]*?)[;{}]', 'm');
    var newTextMatch = text.match(matcher);
    if (newTextMatch && newTextMatch.length > 0) {
        text = newTextMatch[1]
    }
    // find the last closing brace to reduce the regex search
    var blockStart = text.lastIndexOf(';');
    if (blockStart > 0)
        text = text.slice(blockStart);
    else
        blockStart = 0;
    var func = getFunction(text);
    if (!func) return [null, null];
    // cut off the text where the function we found begins, to find the doxyblock
    text = text.slice(0, text.lastIndexOf(func.fullSignature));
    var fullComment = getLastDoxyBlock(text);
    if (fullComment) {
        func.merge(getFunctionFromDoxygen(fullComment), true);
        
        var range = new vscode.Range(document.positionAt(blockStart + text.lastIndexOf(fullComment)), document.positionAt(blockStart + text.length));
        return [generateSnippet(func), range];
    }
    else {
        // return the snippet and the position where it should be placed
        return [generateSnippet(func), document.positionAt(blockStart + text.length)];
    }
}

class DoxyCodeActionProvider implements vscode.CodeActionProvider {
    provideCodeActions(document: vscode.TextDocument, 
                       range: vscode.Range, 
                       context: vscode.CodeActionContext, 
                       token: vscode.CancellationToken): vscode.ProviderResult<vscode.Command[]> {
        
        return [];
    }
}

export function activate(context: vscode.ExtensionContext) {

    console.log('Congratulations, your extension "doxygen-generator" is now active!');
    
    let disposable = vscode.commands.registerCommand('doxygen-generator.generate', () => {
        let lineStart = new vscode.Position(vscode.window.activeTextEditor.selection.start.line, 0);

        let [snippet, position] = generateSnippetFromDoc(lineStart, vscode.window.activeTextEditor.document);

        if (snippet) 
            vscode.window.activeTextEditor.insertSnippet(snippet, position);
    });
    context.subscriptions.push(disposable);

    disposable = vscode.languages.registerCodeActionsProvider(['c', 'cpp'], new DoxyCodeActionProvider());
    context.subscriptions.push(disposable);
}

export function deactivate() {
}