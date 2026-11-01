import * as vscode from "vscode";
import * as transforms from "./Transforms";
import * as textCommands from "./TextCommands";
import * as conversionCommands from "./ConversionCommands";
import { run } from "./ScopedCommands";
import { openMenu } from "./TransformMenu";
import { selectionInputs, openResult } from "./EditorScope";

export function activate(context: vscode.ExtensionContext) {
  const register = (name: string, callback: (editor: vscode.TextEditor) => unknown) => {
    context.subscriptions.push(
      vscode.commands.registerCommand("transmute." + name, (editor?: vscode.TextEditor) =>
        callback(editor || vscode.window.activeTextEditor)
      )
    );
  };
  register("openMenu", openMenu);
  for (const name of [
    "sortLines",
    "sortSelections",
    "reverseLines",
    "reverseSelections",
    "uniqueLines",
    "uniqueLinesNewDocument",
    "countUniqueLinesNewDocument",
    "sortByLineLength",
    "trimLines",
    "trimSelections",
    "randomLines",
    "randomSelections",
    "filter",
    "alignCursor",
    "alignCSV",
    "compactCSV",
    "copyToNewDocument",
    "linesAsJSON",
    "selectionAsJSON",
    "JsonAsText",
    "joinLines",
    "splitLines",
    "splitLinesBeforeDelimiter",
    "splitLinesAfterDelimiter",
    "rotateForwardSelections",
    "rotateBackwardSelections",
    "normalizeDiacriticalMarks",
  ])
    register(name, (editor) => run(editor, name));
  register("filterAsNewDocument", (editor) => {
    if (!editor) return;
    try {
      const inputs = selectionInputs(editor);
      return transforms.filterLinesWithContextToNewDocument(
        editor,
        editor.selection,
        inputs.map((input) => input.range)
      );
    } catch (error) {
      vscode.window.showErrorMessage("Unable to filter text: " + error.message);
    }
  });
  register("selectLines", (editor) => {
    if (editor) return transforms.selectLines(editor);
  });
  register("selectHighlights", () => transforms.selectHighlights());
  register("commands", async () => openResult((await vscode.commands.getCommands()).join("\n")));
  register("addChineseEnglishSpacing", textCommands.addChineseEnglishSpacing);
  register("addChineseEnglishSpacingInDocument", textCommands.addChineseEnglishSpacingInDocument);
  register("convertCurlToCode", textCommands.convertCurlToCode);
  register("encodingTools", conversionCommands.encodingTools);
  register("escapes", conversionCommands.encodingTools);
  register("convertDataFormat", conversionCommands.convertDataFormat);
  context.subscriptions.push(vscode.commands.registerCommand("transmute.internal.command", (onCommand) => onCommand()));
}

export function deactivate(): void {
  return;
}
