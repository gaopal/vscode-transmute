import * as vscode from "vscode";

import { openResult, selectionInputs, replaceInputs } from "./EditorScope";

export async function encodingTools(editor: vscode.TextEditor) {
  if (!editor) return;
  try {
    const tools: typeof import("./TextEncoding") = require("./TextEncoding");
    const version = editor.document.version;
    const inputs = selectionInputs(editor);
    const operation = await vscode.window.showQuickPick(tools.getTextOperations(), {
      placeHolder: "Select an encoding, hash or encryption operation",
    });
    if (!operation) return;
    let secret: string | undefined;
    if (operation.secret) {
      secret = await vscode.window.showInputBox({
        prompt: "Enter the " + operation.secret + " for this operation",
        password: true,
        ignoreFocusOut: true,
        validateInput: (value) => (value ? undefined : "A nonempty " + operation.secret + " is required"),
      });
      if (secret === undefined) return;
    }
    const outputs: string[] = [];
    for (const input of inputs) outputs.push(await tools.transformText(input.text, operation.id, secret));
    secret = undefined;
    if (editor.document.version !== version) throw new Error("The document changed; run this command again");
    if (operation.newDocument) {
      for (const output of outputs) await openResult(output, operation.id === "aes:encrypt" ? "json" : "plaintext");
    } else {
      await replaceInputs(editor, inputs, outputs, version);
    }
  } catch (error) {
    vscode.window.showErrorMessage("Unable to transform text: " + error.message);
  }
}

export async function convertDataFormat(editor: vscode.TextEditor) {
  if (!editor) return;
  try {
    const converter: typeof import("./DataFormats") = require("./DataFormats");
    const inputs = selectionInputs(editor);
    const formats = converter.getDataFormats();
    const extension = editor.document.fileName.split(".").pop().toLowerCase();
    const preferred =
      formats.find((format) => format.languageId === editor.document.languageId) ||
      formats.find((format) => format.id === (extension === "yml" ? "yaml" : extension));
    const sourceOptions = preferred ? [preferred, ...formats.filter((format) => format !== preferred)] : formats;
    const source = await vscode.window.showQuickPick(sourceOptions, { placeHolder: "Select the source data format" });
    if (!source) return;
    const target = await vscode.window.showQuickPick(
      formats.filter((format) => format.id !== source.id),
      { placeHolder: "Select the target data format" }
    );
    if (!target) return;
    const outputs = inputs.map((input) => converter.convertData(input.text, source.id, target.id));
    for (const output of outputs) await openResult(output, target.languageId);
  } catch (error) {
    vscode.window.showErrorMessage("Unable to convert data: " + error.message);
  }
}
