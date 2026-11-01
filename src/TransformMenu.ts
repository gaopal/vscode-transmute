import * as vscode from "vscode";

type Choice = { label: string; command?: string; children?: Choice[] };
const action = (label: string, command: string): Choice => ({ label, command });

const menu: Choice[] = [
  {
    label: "Text / Lines",
    children: [
      { label: "Sort...", children: [action("Natural order", "sortLines"), action("Line length", "sortByLineLength")] },
      action("Reverse lines", "reverseLines"),
      action("Randomize lines", "randomLines"),
      {
        label: "Unique / Count...",
        children: [
          action("Keep unique lines", "uniqueLines"),
          action("Unique lines in new documents", "uniqueLinesNewDocument"),
          action("Count duplicate lines in new documents", "countUniqueLinesNewDocument"),
        ],
      },
      {
        label: "Filter...",
        children: [
          action("Replace input", "filter"),
          action("New document with context options", "filterAsNewDocument"),
        ],
      },
      { label: "Trim...", children: [action("Each line", "trimLines"), action("Entire input", "trimSelections")] },
      action("Join lines...", "joinLines"),
      {
        label: "Split...",
        children: [
          action("Remove delimiter", "splitLines"),
          action("Before delimiter", "splitLinesBeforeDelimiter"),
          action("After delimiter", "splitLinesAfterDelimiter"),
        ],
      },
      {
        label: "JSON text...",
        children: [
          action("Lines to JSON strings", "linesAsJSON"),
          action("Input to JSON string", "selectionAsJSON"),
          action("JSON string to text", "JsonAsText"),
        ],
      },
      action("Remove accents", "normalizeDiacriticalMarks"),
      action("Add Chinese-English spacing", "addChineseEnglishSpacing"),
    ],
  },
  {
    label: "CSV / Alignment",
    children: [
      { label: "CSV...", children: [action("Align columns", "alignCSV"), action("Compact columns", "compactCSV")] },
      action("Align to cursor", "alignCursor"),
    ],
  },
  action("Encoding / Crypto...", "encodingTools"),
  action("Data Formats...", "convertDataFormat"),
  action("cURL to Code...", "convertCurlToCode"),
  {
    label: "Selections / Helpers",
    children: [
      {
        label: "Reorder selected fragments...",
        children: [
          action("Natural order", "sortSelections"),
          action("Reverse", "reverseSelections"),
          action("Randomize", "randomSelections"),
          action("Rotate forward", "rotateForwardSelections"),
          action("Rotate backward", "rotateBackwardSelections"),
        ],
      },
      action("Copy input to new documents", "copyToNewDocument"),
      action("Select full lines", "selectLines"),
      action("Select highlights", "selectHighlights"),
      action("List all VS Code commands", "commands"),
    ],
  },
];

export async function openMenu(editor: vscode.TextEditor) {
  if (!editor) return;
  let choices = menu;
  let title = "Transform";
  const selected = editor.selections.filter((selection) => !selection.isEmpty).length;
  const scope = selected ? "Selected text (" + selected + ")" : "Entire document";
  while (choices) {
    const choice = await vscode.window.showQuickPick(choices, {
      title,
      placeHolder: scope + " — choose a transformation",
    });
    if (!choice) return;
    if (choice.command) return vscode.commands.executeCommand("transmute." + choice.command, editor);
    title = "Transform / " + choice.label;
    choices = choice.children;
  }
}
