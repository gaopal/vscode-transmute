import * as vscode from "vscode";
import { addChineseEnglishSpacing as spaceText } from "./ChineseSpacing";

async function applySpacing(editor: vscode.TextEditor, ranges: vscode.Range[]) {
  const orderedRanges = ranges.slice().sort((a, b) => a.start.compareTo(b.start));
  const mergedRanges: vscode.Range[] = [];
  for (const range of orderedRanges) {
    const previous = mergedRanges[mergedRanges.length - 1];
    if (previous && range.start.compareTo(previous.end) <= 0) {
      mergedRanges[mergedRanges.length - 1] = previous.union(range);
    } else {
      mergedRanges.push(range);
    }
  }
  const changes = mergedRanges
    .map((range) => {
      const text = editor.document.getText(range);
      return { range, text, spaced: spaceText(text) };
    })
    .filter((change) => change.text !== change.spaced);
  if (!changes.length) return;
  await editor.edit((builder) => {
    for (const change of changes) builder.replace(change.range, change.spaced);
  });
}

export async function addChineseEnglishSpacing(editor: vscode.TextEditor) {
  if (!editor) return;
  const ranges = editor.selections.map((selection) =>
    selection.isEmpty ? editor.document.lineAt(selection.active.line).range : selection,
  );
  await applySpacing(editor, ranges);
}

export async function addChineseEnglishSpacingInDocument(editor: vscode.TextEditor) {
  if (!editor) return;
  const lastLine = editor.document.lineCount - 1;
  const range = new vscode.Range(0, 0, lastLine, editor.document.lineAt(lastLine).text.length);
  await applySpacing(editor, [range]);
}

export async function convertCurlToCode(editor: vscode.TextEditor) {
  if (!editor) return;
  const source = editor.document.getText(editor.selection.isEmpty ? undefined : editor.selection);
  try {
    const converter: typeof import("./CurlConverter") = require("./CurlConverter");
    const request = await converter.parseCurl(source);
    const target = await vscode.window.showQuickPick(converter.getCodeTargets(), {
      placeHolder: "Select a language and HTTP client library",
    });
    if (!target) return;
    const content = await converter.generateCode(request, target);
    const languages = await vscode.languages.getLanguages();
    const language = languages.includes(target.languageId) ? target.languageId : "plaintext";
    const document = await vscode.workspace.openTextDocument({ content, language });
    await vscode.window.showTextDocument(document, { preview: false });
  } catch (error) {
    vscode.window.showErrorMessage("Unable to convert curl: " + error.message);
  }
}
