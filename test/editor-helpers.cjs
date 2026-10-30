function editorHarness(text, spans = []) {
    class Position {
        constructor(line, character) { Object.assign(this, { line, character }) }
        compareTo(other) { return this.line - other.line || this.character - other.character }
    }
    class Range {
        constructor(a, b, c, d) {
            this.start = typeof a === 'number' ? new Position(a, b) : a
            this.end = typeof a === 'number' ? new Position(c, d) : b
        }
        union(other) {
            return new Range(this.start.compareTo(other.start) < 0 ? this.start : other.start,
                this.end.compareTo(other.end) > 0 ? this.end : other.end)
        }
    }
    const offsetAt = position => text.split('\n').slice(0, position.line).reduce((n, line) => n + line.length + 1, 0) + position.character
    const document = {
        version: 1, languageId: 'plaintext', fileName: 'sample.txt',
        getText: range => range ? text.slice(offsetAt(range.start), offsetAt(range.end)) : text,
        get lineCount() { return text.split('\n').length },
        lineAt: line => ({ text: text.split('\n')[line], range: new Range(line, 0, line, text.split('\n')[line].length) })
    }
    const selections = spans.map(([start, end]) => Object.assign(new Range(0, start, 0, end), {
        isEmpty: start === end, active: new Position(0, end)
    }))
    if (!selections.length) selections.push(Object.assign(new Range(0, 0, 0, 0), { isEmpty: true, active: new Position(0, 0) }))
    let editCount = 0
    const editor = {
        document, selections, selection: selections[0],
        async edit(callback) {
            editCount++
            const replacements = []
            callback({ replace: (range, replacement) => replacements.push({ start: offsetAt(range.start), end: offsetAt(range.end), replacement }) })
            replacements.sort((a, b) => b.start - a.start)
            for (const change of replacements) text = text.slice(0, change.start) + change.replacement + text.slice(change.end)
            document.version++
            return true
        }
    }
    const opened = [], shown = [], errors = []
    const vscode = {
        Range,
        window: {
            showQuickPick: async targets => targets.find(target => target.language === 'python' && target.variant === 'Requests'),
            showTextDocument: async document => { shown.push(document) },
            showErrorMessage: message => { errors.push(message) }
        },
        languages: { getLanguages: async () => ['python', 'plaintext'] },
        workspace: { openTextDocument: async options => { opened.push(options); return options } }
    }
    return { editor, vscode, opened, shown, errors, read: () => text, editCount: () => editCount,
        setText(value) { text = value; document.version++ } }
}


module.exports = { editorHarness }
