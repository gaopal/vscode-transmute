import * as vscode from "vscode";
import { View } from "vscode-extension-common";
import { openResult, selectionInputs, replaceInputs } from "./EditorScope";
const split = require("split-string");
const naturalOrder = require("natural-orderby").orderBy;

function shuffle<T>(items: T[]) {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

function rowsOf(text: string) {
  const eol = (text.match(/\r\n|\n|\r/) || ["\n"])[0];
  const trailing = /(?:\r\n|\n|\r)$/.test(text);
  const rows = text.split(/\r\n|\n|\r/);
  if (trailing) rows.pop();
  return { rows, join: (output: string[]) => output.join(eol) + (trailing && output.length ? eol : "") };
}

export async function run(editor: vscode.TextEditor, command: string) {
  if (!editor) return;
  try {
    const version = editor.document.version;
    const inputs = selectionInputs(editor);
    let delimiter: string;
    if (
      [
        "alignCSV",
        "compactCSV",
        "joinLines",
        "splitLines",
        "splitLinesBeforeDelimiter",
        "splitLinesAfterDelimiter",
      ].includes(command)
    ) {
      delimiter = await vscode.window.showInputBox({
        prompt: "Specify Delimiter",
        value: command.includes("CSV") ? "," : "",
      });
      if (delimiter === undefined) return;
      if (command.includes("CSV")) {
        delimiter = JSON.parse('"' + delimiter + '"');
        if (!delimiter) throw new Error("CSV delimiter must not be empty");
      }
    }
    let filter: (text: string) => boolean;
    if (command === "filter") {
      const expression = await vscode.window.showInputBox({ prompt: "Enter regex or [space] + literal" });
      if (expression === undefined) return;
      filter = View.makeFilterFunction(expression);
    }
    const natural = (values: string[]): string[] => naturalOrder(values);
    let outputs: string[];
    if (
      [
        "sortSelections",
        "reverseSelections",
        "randomSelections",
        "rotateForwardSelections",
        "rotateBackwardSelections",
      ].includes(command)
    ) {
      if (editor.selections.filter((selection) => !selection.isEmpty).length < 2 || inputs.length < 2)
        throw new Error("Select at least two text fragments to reorder");
      outputs = inputs.map((input) => input.text);
      if (command === "sortSelections") outputs = natural(outputs);
      if (command === "reverseSelections") outputs.reverse();
      if (command === "randomSelections") shuffle(outputs);
      if (command === "rotateForwardSelections") outputs.unshift(outputs.pop());
      if (command === "rotateBackwardSelections") outputs.push(outputs.shift());
    } else {
      outputs = inputs.map((input) => {
        const { rows, join } = rowsOf(input.text);
        switch (command) {
          case "sortLines":
            return join(natural(rows));
          case "sortByLineLength":
            return join(rows.sort((a, b) => a.length - b.length));
          case "reverseLines":
            return join(rows.reverse());
          case "randomLines":
            return join(shuffle(rows));
          case "uniqueLines":
          case "uniqueLinesNewDocument":
            return join(Array.from(new Set(rows)));
          case "countUniqueLinesNewDocument": {
            const counts = new Map<string, number>();
            rows.forEach((row) => counts.set(row, (counts.get(row) || 0) + 1));
            return Array.from(counts, ([text, count]) => count + " : " + text).join("\n");
          }
          case "trimLines":
            return join(rows.map((row) => row.trim()));
          case "trimSelections":
            return input.text.trim();
          case "filter":
            return join(rows.filter(filter));
          case "normalizeDiacriticalMarks":
            return input.text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
          case "copyToNewDocument":
            return input.text;
          case "selectionAsJSON":
            return JSON.stringify(input.text);
          case "linesAsJSON":
            return join(rows.map((row) => JSON.stringify(row) + ","));
          case "JsonAsText": {
            const value = JSON.parse(input.text);
            if (typeof value !== "string") throw new Error("Input must be a JSON string");
            return value;
          }
          case "joinLines":
            return input.text.split(/\r\n|\n|\r/).join(delimiter);
          case "splitLines":
          case "splitLinesBeforeDelimiter":
          case "splitLinesAfterDelimiter": {
            const eol = editor.document.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n";
            const separator =
              command === "splitLinesBeforeDelimiter"
                ? eol + delimiter
                : command === "splitLinesAfterDelimiter"
                  ? delimiter + eol
                  : eol;
            return input.text.split(delimiter).join(separator);
          }
          case "alignCursor": {
            const column = editor.selection.active.character;
            return join(
              rows.map((row, index) => {
                const offset = Math.max(0, column - (index === 0 ? input.range.start.character : 0));
                return row.slice(0, offset) + row.slice(offset).trim();
              })
            );
          }
          case "alignCSV":
          case "compactCSV": {
            const parts: string[][] = rows.map((row) => split(row, { separator: delimiter, quotes: true }));
            const widths: number[] = [];
            if (command === "alignCSV")
              parts.forEach((row) =>
                row.forEach((value, column) => (widths[column] = Math.max(widths[column] || 0, value.length)))
              );
            return join(
              parts.map((row) =>
                row
                  .map((value, column) => (command === "compactCSV" ? value.trim() : value.padEnd(widths[column] + 1)))
                  .join(delimiter)
              )
            );
          }
          default:
            throw new Error("Unknown transformation: " + command);
        }
      });
    }
    if (["uniqueLinesNewDocument", "countUniqueLinesNewDocument", "copyToNewDocument"].includes(command)) {
      for (const output of outputs) await openResult(output);
    } else {
      await replaceInputs(editor, inputs, outputs, version);
    }
  } catch (error) {
    vscode.window.showErrorMessage("Unable to transform text: " + error.message);
  }
}
