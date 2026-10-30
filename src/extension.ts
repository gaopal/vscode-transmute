'use strict';
import * as vscode from 'vscode';
import * as transforms from './Transforms';
import * as textCommands from './TextCommands';
import * as conversionCommands from './ConversionCommands';
import {Modify, View, Application} from 'vscode-extension-common'
/**
 * TODO - planned features:
 * - unique selections as new document
 * - filter sections based on text found in levels to the right
 * - trim identical parts of lines
 * - sort folding regions / sort sections as determined by each cursor location
 * - split/join lines using token or expression
 * - Live realtime filtering view. click on filtered lines to jump to location.  Line numbers with filtered content
 *  - combined live filter from all open documents.
 * - Power selections
 *  - all lines containing...
 *  - remove selections containing...
 *  - all lines with same level
 *  - expand selection that can work with multiple cursors
 *  - select all highlighted (there is a vscode keybinding, but no command in palette)
 * - wrap at designated length
 * - constrain/transform selected text to certain chars.  Specify valid chars like a-z.  All other chars will be transformed to specified char.
 * - live preview hovers or such on some transforms when only 1 line selected
 * - filter lines as new document with line numbers of original as text in document
 * - https://stackoverflow.com/questions/990904/remove-accents-diacritics-in-a-string-in-javascript
 * - JSON Where - https://www.npmjs.com/package/json-where
 *   - popup how to use from quick pick button
 * - XPath filtering using - https://github.com/FontoXML/fontoxpath
 * - constrain - limit all chars within a regex, all chars outside substituted with specified chars. also limit to lower case or uppercase.  possibly combine with remove accents.
 */

export function activate(context: vscode.ExtensionContext) {
    const registerCommand = (name:string, callback:(...args:any[])=>any) => {
        context.subscriptions.push(vscode.commands.registerCommand(name, callback));
    };

    const registerEditorCommand = (name:string, callback:(editor:vscode.TextEditor)=>void) => {
        registerCommand(name, () => callback(vscode.window.activeTextEditor));
    };

    registerEditorCommand('dakara-transformer.sortLines', textEditor => {
        transforms.sortLines(textEditor, textEditor.selections);
    });

    registerEditorCommand('dakara-transformer.sortSelections', textEditor => {
        transforms.sortSelections(textEditor, textEditor.selections);
    });

    registerEditorCommand('dakara-transformer.reverseLines', textEditor => {
        Modify.reverseLines(textEditor, textEditor.selections);
    });

    registerEditorCommand('dakara-transformer.reverseSelections', textEditor => {
        transforms.reverseSelections(textEditor, textEditor.selections);
    });

    registerEditorCommand('dakara-transformer.uniqueLines', textEditor => {
        transforms.uniqueLines(textEditor, textEditor.selections);
    });

    registerEditorCommand('dakara-transformer.uniqueLinesNewDocument', textEditor => {
        transforms.uniqueLinesToNewDocument(textEditor, textEditor.selections);
    });

    registerEditorCommand('dakara-transformer.countUniqueLinesNewDocument', textEditor => {
        transforms.countUniqueLinesToNewDocument(textEditor, textEditor.selections);
    });

    registerEditorCommand('dakara-transformer.sortByLineLength', textEditor => {
        transforms.sortLinesByLength(textEditor, textEditor.selections);
    });

    registerEditorCommand('dakara-transformer.trimLines', textEditor => {
        transforms.trimLines(textEditor, textEditor.selections);
    });

    registerEditorCommand('dakara-transformer.trimSelections', textEditor => {
        transforms.trimSelections(textEditor, textEditor.selections);
    });

    registerEditorCommand('dakara-transformer.randomLines', textEditor => {
        transforms.randomizeLines(textEditor, textEditor.selection);
    });

    registerEditorCommand('dakara-transformer.randomSelections', textEditor => {
        transforms.randomizeSelections(textEditor, textEditor.selections);
    });

    registerEditorCommand('dakara-transformer.filter', textEditor => {
        transforms.filterLines(textEditor, textEditor.selection);
    });

    registerEditorCommand('dakara-transformer.filterAsNewDocument', textEditor => {
        transforms.filterLinesWithContextToNewDocument(textEditor, textEditor.selection);
    });

    registerCommand('dakara-internal.command', onCommand => onCommand());

    registerEditorCommand('dakara-transformer.alignCursor', textEditor => {
        transforms.alignToCursor(textEditor, textEditor.selections);
    });

    registerEditorCommand('dakara-transformer.alignCSV', textEditor => {
        transforms.alignCSV(textEditor, textEditor.selections);
    });

    registerEditorCommand('dakara-transformer.compactCSV', textEditor => {
        transforms.compactCSV(textEditor, textEditor.selections);
    });

    registerCommand('dakara-transformer.commands', () => {
        const textEditor = vscode.window.activeTextEditor;
        const commands = vscode.commands.getCommands().then(commandList => {
            const content = commandList.reduce((prev, curr) => prev + '\n' + curr);
            return View.openShowDocument('untitled:commands.txt', content);
        })
    });

    registerEditorCommand('dakara-transformer.copyToNewDocument', textEditor => {
        transforms.copyToNewDocument(textEditor);
    });

    registerEditorCommand('dakara-transformer.selectLines', textEditor => {
        transforms.selectLines(textEditor);
    });

    Application.registerCommand(context, 'dakara-transformer.selectHighlights', () => {
        transforms.selectHighlights();
    });

    registerEditorCommand('dakara-transformer.linesAsJSON', textEditor => {
        transforms.linesAsJSON(textEditor);
    });

    registerEditorCommand('dakara-transformer.selectionAsJSON', textEditor => {
        transforms.selectionAsJSON(textEditor);
    });

    Application.registerCommand(context, 'dakara-transformer.JsonAsText', () => {
        const textEditor = vscode.window.activeTextEditor;
        transforms.jsonStringAsText(textEditor);
    });

    registerEditorCommand('dakara-transformer.escapes', textEditor => {
        transforms.escapes(textEditor);
    });

    Application.registerCommand(context, 'dakara-transformer.joinLines', () => {
        const textEditor = vscode.window.activeTextEditor;
        transforms.joinLines(textEditor);
    });

    Application.registerCommand(context, 'dakara-transformer.splitLines', () => {
        const textEditor = vscode.window.activeTextEditor;
        transforms.splitLines(textEditor);
    });

    Application.registerCommand(context, 'dakara-transformer.splitLinesBeforeDelimiter', () => {
        const textEditor = vscode.window.activeTextEditor;
        transforms.splitLinesBeforeDelimiter(textEditor);
    });

    Application.registerCommand(context, 'dakara-transformer.splitLinesAfterDelimiter', () => {
        const textEditor = vscode.window.activeTextEditor;
        transforms.splitLinesAfterDelimiter(textEditor);
    });

    Application.registerCommand(context, 'dakara-transformer.rotateForwardSelections', () => {
        const textEditor = vscode.window.activeTextEditor;
        transforms.rotateForwardSelections(textEditor);
    });

    Application.registerCommand(context, 'dakara-transformer.rotateBackwardSelections', () => {
        const textEditor = vscode.window.activeTextEditor;
        transforms.rotateBackwardSelections(textEditor);
    });

    Application.registerCommand(context, 'dakara-transformer.normalizeDiacriticalMarks', () => {
        const textEditor = vscode.window.activeTextEditor;
        transforms.normalizeDiacriticalMarks(textEditor);
    });

    registerCommand('dakara-transformer.addChineseEnglishSpacing', () => {
        return textCommands.addChineseEnglishSpacing(vscode.window.activeTextEditor);
    });

    registerCommand('dakara-transformer.addChineseEnglishSpacingInDocument', () => {
        return textCommands.addChineseEnglishSpacingInDocument(vscode.window.activeTextEditor);
    });

    registerCommand('dakara-transformer.convertCurlToCode', () => {
        return textCommands.convertCurlToCode(vscode.window.activeTextEditor);
    });

    registerCommand('dakara-transformer.encodingTools', () => {
        return conversionCommands.encodingTools(vscode.window.activeTextEditor);
    });

    registerCommand('dakara-transformer.convertDataFormat', () => {
        return conversionCommands.convertDataFormat(vscode.window.activeTextEditor);
    });
}


export function deactivate() {
}
