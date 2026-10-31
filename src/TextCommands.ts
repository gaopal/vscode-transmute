import * as vscode from "vscode";
import { addChineseEnglishSpacing as spaceText } from "./ChineseSpacing";

import { openResult, selectionInputs, replaceInputs } from "./EditorScope";

export async function addChineseEnglishSpacing(editor: vscode.TextEditor) {
  if (!editor) return;
  try {
    const inputs = selectionInputs(editor);
    await replaceInputs(
      editor,
      inputs,
      inputs.map((input) => spaceText(input.text)),
      editor.document.version
    );
  } catch (error) {
    vscode.window.showErrorMessage("Unable to add spacing: " + error.message);
  }
}

// Keep existing keybindings working with the same automatic scope as the menu.
export const addChineseEnglishSpacingInDocument = addChineseEnglishSpacing;

export async function convertCurlToCode(editor: vscode.TextEditor) {
  if (!editor) return;
  try {
    const converter: typeof import("./CurlConverter") = require("./CurlConverter");
    const inputs = selectionInputs(editor);
    const requests = [];
    for (const input of inputs) requests.push(await converter.parseCurl(input.text));
    const target = await vscode.window.showQuickPick(converter.getCodeTargets(), {
      placeHolder: "Select a language and HTTP client library",
    });
    if (!target) return;
    const outputs: string[] = [];
    for (const request of requests) outputs.push(await converter.generateCode(request, target));
    for (const content of outputs) await openResult(content, target.languageId);
  } catch (error) {
    vscode.window.showErrorMessage("Unable to convert curl: " + error.message);
  }
}
