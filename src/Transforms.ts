"use strict";
import * as path from "path";
import * as vscode from "vscode";
import { Lines, Modify, Region, View } from "vscode-extension-common";
import * as MacroBuilder from "./macros/MacroBuilder";
import * as md5 from "md5";
const split = require("split-string");

const gutterDecorationType = vscode.window.createTextEditorDecorationType({
  rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
});

let transformInstance = 0;
function originName(textEditor: vscode.TextEditor) {
  const filename = textEditor.document.fileName;
  transformInstance++;
  return "transform-" + transformInstance + "-" + path.basename(filename);
}

function linesFromRangesExpandBlockIfEmpty(textEditor: vscode.TextEditor, ranges: Array<vscode.Range>) {
  if (ranges.length === 1) {
    ranges[0] = Region.expandRangeToBlockIfEmpty(textEditor, ranges[0]);
  }
  return Lines.linesFromRanges(textEditor.document, ranges);
}

export function sortLines(textEditor: vscode.TextEditor, ranges: Array<vscode.Range>) {
  if (ranges.length === 1 && !ranges[0].isSingleLine) Modify.sortLinesWithinRange(textEditor, ranges[0]);
  else {
    ranges = Region.makeVerticalRangesWithinBlock(textEditor, ranges);
    textEditor.selections = Region.makeSelectionsFromRanges(ranges);
    Modify.sortLinesByColumn(textEditor, ranges);
  }
}

export function sortSelections(textEditor: vscode.TextEditor, ranges: Array<vscode.Range>) {
  Modify.sortRanges(textEditor, ranges);
}

export function randomizeLines(textEditor: vscode.TextEditor, range: vscode.Range) {
  const lines = Lines.linesFromRange(textEditor.document, range);
  const randomLines = lines.slice(0, lines.length);
  const randomizedLines = randomize(randomLines);
  Modify.replaceLines(textEditor, lines, randomizedLines);
}

export function randomizeSelections(textEditor: vscode.TextEditor, ranges: Array<vscode.Range>) {
  const randomizedRanges = randomize([...ranges]);
  Modify.replaceRanges(textEditor, ranges, randomizedRanges);
}

function randomize<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

export function reverseSelections(textEditor: vscode.TextEditor, ranges: Array<vscode.Range>) {
  const orderedRanges = Region.makeOrderedRangesByStartPosition(ranges);
  const reversedRanges = [...orderedRanges].reverse();
  Modify.replaceRanges(textEditor, orderedRanges, reversedRanges);
}

export function sortLinesByLength(textEditor: vscode.TextEditor, ranges: Array<vscode.Range>) {
  const linesToSort = linesFromRangesExpandBlockIfEmpty(textEditor, ranges);
  Modify.sortLinesByLength(textEditor, linesToSort);
}

export function trimLines(textEditor: vscode.TextEditor, ranges: Array<vscode.Range>) {
  let trimmedResult = "";
  const trimLinesB = Lines.linesFromRange(textEditor.document, ranges[0]);
  for (const line of trimLinesB) {
    trimmedResult += line.text.trim() + Lines.lineEndChars(textEditor);
  }
  Modify.replace(textEditor, ranges[0], trimmedResult);
}

export function trimSelections(textEditor: vscode.TextEditor, ranges: Array<vscode.Range>) {
  const trimmedResult = [];
  for (const range of ranges) {
    trimmedResult.push(textEditor.document.getText(range).trim());
  }
  Modify.replaceRangesWithText(textEditor, ranges, trimmedResult);
}

export function uniqueLines(textEditor: vscode.TextEditor, ranges: Array<vscode.Range>) {
  if (ranges.length === 1) {
    const rangeBlock = Region.expandRangeToBlockIfEmpty(textEditor, ranges[0]);
    const lines = Lines.linesFromRange(textEditor.document, rangeBlock);
    const linesArray = uniqueLinesByText(lines);
    Modify.replace(textEditor, rangeBlock, Lines.textFromLines(textEditor.document, linesArray));
  }
}

export function uniqueLinesToNewDocument(textEditor: vscode.TextEditor, ranges: Array<vscode.Range>) {
  const lines = linesFromRangesExpandBlockIfEmpty(textEditor, ranges);
  const linesArray = uniqueLinesByText(lines);
  View.openShowDocument(originName(textEditor), Lines.textFromLines(textEditor.document, linesArray));
}

function uniqueLinesByText(lines: vscode.TextLine[]) {
  const uniqueMap = new Map<string, vscode.TextLine>();
  lines.forEach((line) => {
    uniqueMap.set(line.text, line);
  });

  return Array.from(uniqueMap.values());
}
export function countUniqueLinesToNewDocument(textEditor: vscode.TextEditor, ranges: Array<vscode.Range>) {
  const lines = linesFromRangesExpandBlockIfEmpty(textEditor, ranges);
  const countMap = new Map<string, number>();
  lines.forEach((line) => {
    countMap.set(line.text, (countMap.get(line.text) || 0) + 1);
  });

  let displayText = "";
  for (const [text, count] of countMap) {
    displayText += count + " : " + text + "\n";
  }
  View.openShowDocument(originName(textEditor), displayText);
}

export function filterLines(textEditor: vscode.TextEditor, selection: vscode.Selection) {
  const selectedText = Lines.textOfLineSelectionOrWordAtCursor(textEditor.document, selection);
  // If we have multiple lines selected, use that as source to filter, else the entire document
  const range = selection.isSingleLine ? Region.makeRangeDocument(textEditor.document) : selection;

  let filteredLines = [];
  return View.promptForFilterExpression(selectedText).then((fnFilter) => {
    filteredLines = Lines.filterLines(textEditor.document, range, fnFilter);
    const content = filteredLines.map((line) => line.text).join("\n");
    Modify.replace(textEditor, range, content);
  });
}

export function filterLinesToNewDocument(textEditor: vscode.TextEditor, selection: vscode.Selection) {
  const selectedText = Lines.textOfLineSelectionOrWordAtCursor(textEditor.document, selection);
  // If we have multiple lines selected, use that as source to filter, else the entire document
  const range = selection.isSingleLine ? Region.makeRangeDocument(textEditor.document) : selection;

  const editorName = originName(textEditor);

  return View.promptForFilterExpression(selectedText).then((fnFilter) => {
    const filteredLines = Lines.filterLines(textEditor.document, range, fnFilter);
    return openShowDocumentWithLines(editorName, filteredLines);
  });
}

type FilterContextOptions = {
  sectionByLevel?: number;
  sectionByLevelRegex?: RegExp;
  surroundingLines?: number;
  surroundingRegex?: RegExp;
};

function parseNumberAndRegex(value: string) {
  if (!value) return { number: NaN, regex: null };
  const parts = value.split(" ", 2);
  if (parts.length === 1) return { number: +value, regex: null };
  return { number: +parts[0], regex: new RegExp(parts[1], "i") };
}

function isFilterContextOptionSet(options: FilterContextOptions) {
  return !isNaN(options.sectionByLevel) || !isNaN(options.surroundingLines);
}

export function filterLinesWithContextToNewDocument(
  textEditor: vscode.TextEditor,
  selection: vscode.Selection,
  scopes?: vscode.Range[]
) {
  const selectedText = scopes ? "" : Lines.textOfLineSelectionOrWordAtCursor(textEditor.document, selection);
  const range = scopes ? scopes[0] : selection.isSingleLine ? Region.makeRangeDocument(textEditor.document) : selection;
  const version = textEditor.document.version;
  const scopedLines =
    scopes &&
    scopes.map((scope) => {
      const rows: vscode.TextLine[] = [];
      for (let index = scope.start.line; index <= scope.end.line; index++) {
        if (index === scope.end.line && scope.end.character === 0 && index !== scope.start.line) break;
        const line = textEditor.document.lineAt(index);
        const start = index === scope.start.line ? scope.start.character : 0;
        const end = index === scope.end.line ? scope.end.character : line.text.length;
        rows.push({ ...line, lineNumber: index, text: line.text.slice(start, end) });
      }
      return rows;
    });

  const editorName = originName(textEditor);

  const regexOption = View.makeOption({
    label: "Filter",
    description: "specify filter to select lines",
    value: selectedText,
    input: { prompt: "Enter regex or [space] + literal", placeHolder: "abc.*" },
  });
  const surroundOption = View.makeOption({
    label: "Surrounding Lines",
    description: "add nearby lines",
    input: { prompt: "[# lines] [optional regex]", placeHolder: "2 abc.*" },
  });
  const levelsOption = View.makeOption({
    label: "Parent Levels",
    description: "add lines by relative section level",
    input: { prompt: "[# parent levels] [optional regex]", placeHolder: "2 abc.*" },
  });
  View.promptOptions([regexOption, surroundOption, levelsOption], (item, action) => {
    try {
      if (scopes && textEditor.document.version !== version)
        throw new Error("The document changed; run this command again");
      if (View.QuickPickActionType.INPUT == action) {
        // don't process realtime input changes on large documents
        if (
          scopes
            ? scopes.reduce((count, scope) => count + scope.end.line - scope.start.line, 0) > 10000
            : range.end.line - range.start.line > 10000
        )
          return;
      }
      const surrounding = parseNumberAndRegex(surroundOption.value);
      const levels = parseNumberAndRegex(levelsOption.value);
      const contextOptions: FilterContextOptions = {
        surroundingLines: surrounding.number,
        surroundingRegex: surrounding.regex,
        sectionByLevel: levels.number,
        sectionByLevelRegex: levels.regex,
      };

      const fnFilter = View.makeFilterFunction(regexOption.value);
      if (scopedLines) {
        const filtered = scopedLines.reduce((all, rows) => {
          const matches = rows.filter((line) => fnFilter(line.text));
          const numbers = new Set(matches.map((line) => line.lineNumber));
          if (isFilterContextOptionSet(contextOptions)) {
            for (const match of matches) {
              for (const line of addContextLines(textEditor, match, contextOptions)) numbers.add(line.lineNumber);
            }
          }
          return all.concat(rows.filter((line) => numbers.has(line.lineNumber)));
        }, [] as vscode.TextLine[]);
        openShowDocumentWithLines(editorName, filtered).then(undefined, (error) =>
          vscode.window.showErrorMessage("Unable to filter text: " + error.message)
        );
        return;
      }
      let filteredLines = Lines.filterLines(textEditor.document, range, fnFilter);
      if (isFilterContextOptionSet(contextOptions)) {
        const contextLines = filteredLines
          .map((line) => addContextLines(textEditor, line, contextOptions))
          .reduce((allLines, lines) => {
            for (const line of lines) allLines.push(line);
            return allLines;
          }, [] as vscode.TextLine[]);
        const linesByNumber = new Map<number, vscode.TextLine>();
        for (const line of contextLines) {
          if (!linesByNumber.has(line.lineNumber)) linesByNumber.set(line.lineNumber, line);
        }
        filteredLines = Array.from(linesByNumber.values()).sort((l1, l2) => l1.lineNumber - l2.lineNumber);
      }

      openShowDocumentWithLines(editorName, filteredLines);
    } catch (error) {
      vscode.window.showErrorMessage("Unable to filter text: " + error.message);
    }
  });
}

function addContextLines(textEditor: vscode.TextEditor, line: vscode.TextLine, options: FilterContextOptions) {
  const tabSize = +textEditor.options.tabSize;
  let addedContextLines: vscode.TextLine[] = [];

  if (!isNaN(options.sectionByLevel)) {
    const range = Region.makeRangeFromFoldingRegionRelativeLevel(
      textEditor.document,
      line.lineNumber,
      options.sectionByLevel,
      tabSize
    );
    let lines = Lines.linesFromRange(textEditor.document, range);
    if (options.sectionByLevelRegex) lines = lines.filter((line) => options.sectionByLevelRegex.test(line.text));
    addedContextLines = addedContextLines.concat(lines);
  }

  if (options.surroundingLines) {
    let lines = Lines.collectLines(
      textEditor.document,
      Math.max(0, line.lineNumber - options.surroundingLines),
      Math.min(textEditor.document.lineCount, line.lineNumber + options.surroundingLines)
    );
    if (options.surroundingRegex) lines = lines.filter((line) => options.surroundingRegex.test(line.text));
    addedContextLines = addedContextLines.concat(lines);
  }

  // include the original filtered line
  addedContextLines.push(line);
  return addedContextLines;
}

function openShowDocumentWithLines(editorName: string, filteredLines: vscode.TextLine[]) {
  const content = filteredLines.map((line) => line.text).join("\n");
  return View.openShowDocument(editorName, content).then((editor) => {
    if (filteredLines.length < 1000) {
      const decorations = filteredLines.map((line, index) =>
        View.createGutterDecorator(index, ": " + (line.lineNumber + 1), "50px")
      );
      editor.setDecorations(gutterDecorationType, decorations);
    } else {
      editor.setDecorations(gutterDecorationType, []);
    }
    return editor;
  });
}

export function macroCreate() {
  return MacroBuilder.createMacro();
}

export function macroDelete() {
  return MacroBuilder.deleteMacro();
}
export function macroEdit() {
  return MacroBuilder.editMacro();
}

export function macroRun() {
  return MacroBuilder.runMacro();
}

export function macroRepeatLast() {
  MacroBuilder.runCurrentMacro();
}

export function alignToCursor(textEditor: vscode.TextEditor, ranges: Array<vscode.Range>) {
  ranges = Region.makeVerticalRangesWithinBlock(textEditor, ranges);
  textEditor.selections = Region.makeSelectionsFromRanges(ranges);
  const lineInfos = Lines.makeLineInfos(textEditor, ranges);
  textEditor.edit(function (editBuilder) {
    lineInfos.forEach((line) => {
      const lineLeftOfCursor = line.line.text.substring(0, line.range.start.character);
      const trimmedRight = line.line.text.substring(line.range.start.character).trim();

      editBuilder.replace(
        Region.expandRangeFullLineWidth(textEditor.document, line.range),
        lineLeftOfCursor + trimmedRight
      );
    });
  });
}

export async function alignCSV(textEditor: vscode.TextEditor, ranges: Array<vscode.Range>) {
  const userInput = await vscode.window.showInputBox({ prompt: "Specify Delimiter", value: "," });
  const delimeter = JSON.parse('"' + userInput + '"');
  const lines = linesFromRangesExpandBlockIfEmpty(textEditor, ranges);
  const linesParts = lines.map((line) => split(line.text, { separator: delimeter, quotes: true }));
  const linePartCount = linesParts[0].length;
  const widths: number[] = [];
  for (let columnIndex = 0; columnIndex < linePartCount; columnIndex++) {
    widths.push(maxLength(linesParts, columnIndex));
  }
  const newLineTexts = linePartCount
    ? linesParts.map((parts) => {
        const columns: string[] = [];
        for (let columnIndex = 0; columnIndex < linePartCount; columnIndex++) {
          columns.push(padRight(parts[columnIndex], widths[columnIndex]));
        }
        return columns.join(delimeter);
      })
    : [];
  Modify.replaceLinesWithText(textEditor, lines, newLineTexts);
}

function padRight(text: string, count: number) {
  const padAmount = count - text.length;
  return text + " ".repeat(padAmount + 1);
}

function maxLength(texts: string[][], partIndex: number) {
  let max = texts[0][partIndex].length;
  for (let index = 1; index < texts.length; index++) {
    const length = texts[index][partIndex].length;
    if (length > max) max = length;
  }
  return max;
}

export async function compactCSV(textEditor: vscode.TextEditor, ranges: Array<vscode.Range>) {
  const userInput = await vscode.window.showInputBox({ prompt: "Specify Delimiter", value: "," });

  const delimeter = JSON.parse('"' + userInput + '"');
  const lines = linesFromRangesExpandBlockIfEmpty(textEditor, ranges);
  const linesParts = lines.map((line) => split(line.text, { separator: delimeter, quotes: true }));
  const linePartCount = linesParts[0].length;
  const newLineTexts = linePartCount
    ? linesParts.map((parts) => {
        const columns: string[] = [];
        for (let columnIndex = 0; columnIndex < linePartCount; columnIndex++) {
          columns.push(parts[columnIndex].trim());
        }
        return columns.join(delimeter);
      })
    : [];
  Modify.replaceLinesWithText(textEditor, lines, newLineTexts);
}

export function copyToNewDocument(textEditor: vscode.TextEditor) {
  Region.selectionsOrMatchesAsSelectionsOrDocument(textEditor).then((selections) => {
    const textFromSelections = Region.textsFromRanges(textEditor.document, selections);
    View.openShowDocument(originName(textEditor), textFromSelections.join("\n"));
  });
}

export function selectLines(textEditor: vscode.TextEditor) {
  Region.matchesAsSelectionsOrSelections(textEditor).then((selections) => {
    textEditor.selections = selections.map((selection) => {
      const range = Region.expandRangeFullLineWidth(textEditor.document, selection);
      return new vscode.Selection(range.start, range.end);
    });
  });
}

export async function selectHighlights() {
  await vscode.commands.executeCommand("editor.action.selectHighlights");
}

export function linesAsJSON(textEditor: vscode.TextEditor) {
  const lines = Lines.linesFromRange(textEditor.document, textEditor.selection);
  const jsonLines = lines.map((line) => JSON.stringify(line.text) + ",");
  Modify.replaceLinesWithText(textEditor, lines, jsonLines);
}

export function selectionAsJSON(textEditor: vscode.TextEditor) {
  const expandedSelections = Region.expandRangesToLineIfEmpty(textEditor.document, textEditor.selections);
  Modify.replaceUsingTransform(textEditor, expandedSelections, (text) => JSON.stringify(text));
}

export function jsonStringAsText(textEditor: vscode.TextEditor) {
  const expandedSelections = Region.expandRangesToLineIfEmpty(textEditor.document, textEditor.selections);
  Modify.replaceUsingTransform(textEditor, expandedSelections, (text) => JSON.parse(text));
}

export async function joinLines(textEditor: vscode.TextEditor) {
  const userInput = await vscode.window.showInputBox({ prompt: "Specify Delimiter", value: "" });
  const splitChar = Lines.lineEndChars(textEditor);
  Modify.replaceUsingTransform(textEditor, textEditor.selections, (text) => text.split(splitChar).join(userInput));
}

export async function splitLines(textEditor: vscode.TextEditor) {
  const userInput = await vscode.window.showInputBox({ prompt: "Specify Delimiter", value: "" });
  const splitChar = Lines.lineEndChars(textEditor);
  const expandedSelections = Region.expandRangesToLineIfEmpty(textEditor.document, textEditor.selections);
  Modify.replaceUsingTransform(textEditor, expandedSelections, (text) => text.split(userInput).join(splitChar));
}

export async function splitLinesBeforeDelimiter(textEditor: vscode.TextEditor) {
  const userInput = await vscode.window.showInputBox({ prompt: "Specify Delimiter", value: "" });
  const splitChar = Lines.lineEndChars(textEditor) + userInput;
  const expandedSelections = Region.expandRangesToLineIfEmpty(textEditor.document, textEditor.selections);
  Modify.replaceUsingTransform(textEditor, expandedSelections, (text) => text.split(userInput).join(splitChar));
}

export async function splitLinesAfterDelimiter(textEditor: vscode.TextEditor) {
  const userInput = await vscode.window.showInputBox({ prompt: "Specify Delimiter", value: "" });
  const splitChar = userInput + Lines.lineEndChars(textEditor);
  const expandedSelections = Region.expandRangesToLineIfEmpty(textEditor.document, textEditor.selections);
  Modify.replaceUsingTransform(textEditor, expandedSelections, (text) => text.split(userInput).join(splitChar));
}

export async function rotateForwardSelections(textEditor: vscode.TextEditor) {
  const ranges = textEditor.selections;
  const orderedRanges = Region.makeOrderedRangesByStartPosition(ranges);
  const shiftedRanges = [...orderedRanges];
  shiftedRanges.unshift(shiftedRanges.pop());
  Modify.replaceRanges(textEditor, orderedRanges, shiftedRanges);
}

export async function rotateBackwardSelections(textEditor: vscode.TextEditor) {
  const ranges = textEditor.selections;
  const orderedRanges = Region.makeOrderedRangesByStartPosition(ranges);
  const shiftedRanges = [...orderedRanges];
  shiftedRanges.push(shiftedRanges.shift());
  Modify.replaceRanges(textEditor, orderedRanges, shiftedRanges);
}

export async function normalizeDiacriticalMarks(textEditor: vscode.TextEditor) {
  const ranges = textEditor.selections;
  const orderedRanges = Region.makeOrderedRangesByStartPosition(ranges);

  const normalizedText = [];
  for (const range of orderedRanges) {
    const text = normalizeDiacritical(textEditor.document.getText(range));
    normalizedText.push(text);
  }
  Modify.replaceRangesWithText(textEditor, orderedRanges, normalizedText);
}

function normalizeDiacritical(text: string) {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function escapes(textEditor: vscode.TextEditor) {
  const selections = Region.expandRangesToLineIfEmpty(textEditor.document, textEditor.selections);

  const encodeBase64 = View.makeOption({ label: "Encode Base64", description: "encode as base64" });
  const decodeBase64 = View.makeOption({ label: "Decode Base64", description: "decode from base64" });
  const encodeUrlSegment = View.makeOption({
    label: "Encode URL Segment",
    description: "encode using encodeURIComponent()",
  });
  const decodeUrlSegment = View.makeOption({
    label: "Decode URL Segment",
    description: "decode using decodeURIComponent()",
  });
  const encodeFormUrl = View.makeOption({
    label: "Encode x-www-form-urlencoded,",
    description: `form url encoding with spaces as '+'`,
  });
  const decodeFormUrl = View.makeOption({
    label: "Decode x-www-form-urlencoded,",
    description: `form url decoding with spaces as '+'`,
  });
  const encodeMD5 = View.makeOption({ label: "Hash MD5", description: "calculate MD5 Hash" });

  View.promptOptions(
    [encodeBase64, decodeBase64, encodeUrlSegment, decodeUrlSegment, encodeFormUrl, decodeFormUrl, encodeMD5],
    (item) => {
      if (encodeBase64 === item) {
        Modify.replaceUsingTransform(textEditor, selections, (text) => Buffer.from(text, "binary").toString("base64"));
      } else if (decodeBase64 === item) {
        Modify.replaceUsingTransform(textEditor, selections, (text) => Buffer.from(text, "base64").toString("binary"));
      } else if (encodeMD5 === item) {
        Modify.replaceUsingTransform(textEditor, selections, (text) => md5(text));
      } else if (encodeUrlSegment === item) {
        Modify.replaceUsingTransform(textEditor, selections, (text) => encodeURIComponent(text));
      } else if (decodeUrlSegment === item) {
        Modify.replaceUsingTransform(textEditor, selections, (text) => decodeURIComponent(text));
      } else if (encodeFormUrl === item) {
        Modify.replaceUsingTransform(textEditor, selections, (text) => encodeURIComponent(text).replace(/%20/g, "+"));
      } else if (decodeFormUrl === item) {
        Modify.replaceUsingTransform(textEditor, selections, (text) => decodeURIComponent(text.replace(/\+/g, "%20")));
      }
    }
  );
}
