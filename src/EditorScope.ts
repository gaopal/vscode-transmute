import * as vscode from "vscode";

export function selectionInputs(editor: vscode.TextEditor) {
  let ranges: vscode.Range[] = editor.selections.filter((selection) => !selection.isEmpty);
  if (!ranges.length) {
    const last = editor.document.lineCount - 1;
    ranges = [new vscode.Range(0, 0, last, editor.document.lineAt(last).text.length)];
  }
  ranges = ranges.slice().sort((a, b) => a.start.compareTo(b.start) || a.end.compareTo(b.end));
  const inputs: { range: vscode.Range; text: string }[] = [];
  for (const range of ranges) {
    const previous = inputs[inputs.length - 1];
    if (previous && range.start.compareTo(previous.range.start) === 0 && range.end.compareTo(previous.range.end) === 0)
      continue;
    if (previous && range.start.compareTo(previous.range.end) < 0)
      throw new Error("Overlapping selections cannot be transformed independently");
    inputs.push({ range, text: editor.document.getText(range) });
  }
  return inputs;
}

export async function replaceInputs(
  editor: vscode.TextEditor,
  inputs: ReturnType<typeof selectionInputs>,
  outputs: string[],
  version: number
) {
  if (editor.document.version !== version) throw new Error("The document changed; run this command again");
  const changes = inputs
    .map((input, index) => ({ ...input, output: outputs[index] }))
    .filter((input) => input.text !== input.output);
  if (!changes.length) return;
  const edited = await editor.edit((builder) => {
    for (const change of changes) builder.replace(change.range, change.output);
  });
  if (!edited) throw new Error("Unable to edit the document");
}

export async function openResult(content: string, languageId = "plaintext") {
  const languages = await vscode.languages.getLanguages();
  const language = languages.includes(languageId) ? languageId : "plaintext";
  const document = await vscode.workspace.openTextDocument({ content, language });
  await vscode.window.showTextDocument(document, { preview: false });
}
