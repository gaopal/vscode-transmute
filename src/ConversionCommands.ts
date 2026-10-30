import * as vscode from "vscode";

async function openResult(content: string, languageId: string) {
  const languages = await vscode.languages.getLanguages();
  const language = languages.includes(languageId) ? languageId : "plaintext";
  const document = await vscode.workspace.openTextDocument({ content, language });
  await vscode.window.showTextDocument(document, { preview: false });
}

function selectionInputs(editor: vscode.TextEditor) {
  const ranges = editor.selections
    .map((selection) => (selection.isEmpty ? editor.document.lineAt(selection.active.line).range : selection))
    .sort((a, b) => a.start.compareTo(b.start) || a.end.compareTo(b.end));
  const inputs: { range: vscode.Range; text: string }[] = [];
  for (const range of ranges) {
    const previous = inputs[inputs.length - 1];
    if (previous && range.start.compareTo(previous.range.start) === 0 && range.end.compareTo(previous.range.end) === 0)
      continue;
    if (previous && range.start.compareTo(previous.range.end) < 0)
      throw new Error("Overlapping selections cannot be converted independently");
    inputs.push({ range, text: editor.document.getText(range) });
  }
  return inputs;
}

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
      const changes = inputs
        .map((input, index) => ({ ...input, output: outputs[index] }))
        .filter((input) => input.text !== input.output);
      if (!changes.length) return;
      const edited = await editor.edit((builder) => {
        for (const change of changes) builder.replace(change.range, change.output);
      });
      if (!edited) throw new Error("Unable to edit the document");
    }
  } catch (error) {
    vscode.window.showErrorMessage("Unable to transform text: " + error.message);
  }
}

export async function convertDataFormat(editor: vscode.TextEditor) {
  if (!editor) return;
  try {
    const converter: typeof import("./DataFormats") = require("./DataFormats");
    const text = editor.document.getText(editor.selection.isEmpty ? undefined : editor.selection);
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
      { placeHolder: "Select the target data format" },
    );
    if (!target) return;
    const output = converter.convertData(text, source.id, target.id);
    await openResult(output, target.languageId);
  } catch (error) {
    vscode.window.showErrorMessage("Unable to convert data: " + error.message);
  }
}
