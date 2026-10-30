const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { stripTypeScriptTypes } = require('node:module')
const { test } = require('node:test')

const root = path.resolve(__dirname, '..')

async function load(file, dependencies, baseline = false) {
    const source = baseline
        ? fs.readFileSync(path.join(process.env.REFACTOR_BASELINE, file), 'utf8')
        : fs.readFileSync(path.join(root, file), 'utf8')
    const context = vm.createContext({ require: name => dependencies[name], Buffer })
    const module = new vm.SourceTextModule(stripTypeScriptTypes(source, { mode: 'transform' }), { context })
    await module.link(name => {
        const dependency = dependencies[name]
        assert.ok(dependency, `Unexpected import: ${name}`)
        return new vm.SyntheticModule(Object.keys(dependency), function () {
            for (const key of Object.keys(dependency)) this.setExport(key, dependency[key])
        }, { context })
    })
    await module.evaluate()
    return module.namespace
}

async function transforms(texts, options = {}, baseline = false) {
    const lines = texts.map((text, lineNumber) => ({ text, lineNumber }))
    const output = {}
    const range = { start: { line: 0 }, end: { line: lines.length }, isSingleLine: true }
    const editor = {
        document: { fileName: 'sample.txt', lineCount: lines.length },
        options: { tabSize: 4 }
    }
    const common = {
        Lines: {
            linesFromRange: () => lines,
            linesFromRanges: () => lines,
            textFromLines: (_, selected) => {
                output.selected = Array.from(selected, line => line.lineNumber)
                return selected.map(line => line.text).join(options.eol || '\n')
            },
            textOfLineSelectionOrWordAtCursor: () => '',
            filterLines: () => lines.filter(line => !options.matches || options.matches.includes(line.lineNumber)),
            collectLines: (_, start, end) => lines.slice(start, end + 1)
        },
        Region: {
            expandRangeToBlockIfEmpty: (_, selected) => selected,
            makeRangeDocument: () => range,
            makeRangeFromFoldingRegionRelativeLevel: () => range
        },
        Modify: {
            replace: (_, __, text) => { output.text = text },
            replaceLinesWithText: (_, __, result) => { output.rows = Array.from(result) }
        },
        View: {
            QuickPickActionType: { INPUT: 1 },
            makeOption: option => ({ ...option, value: options[option.label] ?? option.value }),
            promptOptions: (_, callback) => callback(null, options.action || 0),
            promptForFilterExpression: async () => () => true,
            makeFilterFunction: () => () => true,
            createGutterDecorator: (index, text) => ({ index, text }),
            openShowDocument: (_, text) => {
                output.text = text
                return Promise.resolve({ setDecorations: (_, decorations) => { output.decorations = decorations.length } })
            }
        }
    }
    const api = await load('src/Transforms.ts', {
        path,
        vscode: {
            window: {
                createTextEditorDecorationType: () => ({}),
                showInputBox: async () => options.delimiter || ','
            },
            DecorationRangeBehavior: { ClosedClosed: 0 }
        },
        'vscode-extension-common': common,
        './macros/MacroBuilder': {},
        md5: {},
        // Supply tokenized fixtures so these tests isolate formatting from the external parser
        'split-string': (text, configuration) => {
            assert.equal(configuration.separator, options.delimiter || ',')
            assert.equal(configuration.quotes, true)
            return options.parts ? options.parts[text].slice() : text.split(configuration.separator)
        }
    }, baseline)
    return { api, editor, range, output }
}

test('deduplication keeps first key order and the last source line for each key', async () => {
    for (const eol of ['\n', '\r\n']) {
        const { api, editor, range, output } = await transforms(['b', '', 'a', 'b', ''], { eol })
        api.uniqueLines(editor, [range])
        assert.equal(output.text, ['b', '', 'a'].join(eol))
        assert.deepEqual(output.selected, [3, 4, 2])
        api.uniqueLinesToNewDocument(editor, [range])
        assert.equal(output.text, ['b', '', 'a'].join(eol))
        api.countUniqueLinesToNewDocument(editor, [range])
        assert.equal(output.text, '2 : b\n2 : \n1 : a\n')
    }
})

test('CSV preserves padding, delimiters, quoted fields, and first-row column count', async () => {
    const options = {
        delimiter: ';',
        parts: { first: ['"a;b"', ' x '], second: ['c', 'y', 'ignored'] }
    }
    const { api, editor, range, output } = await transforms(['first', 'second'], options)
    await api.alignCSV(editor, [range])
    assert.deepEqual(output.rows, ['"a;b" ; x  ', 'c     ;y   '])
    await api.compactCSV(editor, [range])
    assert.deepEqual(output.rows, ['"a;b";x', 'c;y'])
})

test('CSV retains errors for missing columns and empty input', async () => {
    for (const rows of [[], ['a,b', 'c']]) {
        const { api, editor, range } = await transforms(rows)
        await assert.rejects(api.alignCSV(editor, [range]), { name: 'TypeError' })
        await assert.rejects(api.compactCSV(editor, [range]), { name: 'TypeError' })
    }
})

test('context filtering sorts and deduplicates overlapping context, retaining matched lines', async () => {
    const { api, editor, range, output } = await transforms(['zero', 'one', 'two', 'three', 'four'], {
        matches: [1, 3], 'Surrounding Lines': '1 zero|two|four', 'Parent Levels': '0 two'
    })
    api.filterLinesWithContextToNewDocument(editor, range)
    await Promise.resolve()
    assert.equal(output.text, 'zero\none\ntwo\nthree\nfour')
    assert.equal(output.decorations, 5)
})

test('filtering without matches replaces the target with empty text', async () => {
    const { api, editor, range, output } = await transforms(['a'], { matches: [] })
    await api.filterLines(editor, range)
    assert.equal(output.text, '')
})

test('context filtering without matches opens an empty document with no decorations', async () => {
    for (const options of [{}, { 'Surrounding Lines': '1' }, { 'Parent Levels': '0' }]) {
        const { api, editor, range, output } = await transforms(['a'], { matches: [], ...options })
        api.filterLinesWithContextToNewDocument(editor, range)
        await Promise.resolve()
        assert.equal(output.text, '')
        assert.equal(output.decorations, 0)
    }
})

test('context filtering retains the large-document input guard', async () => {
    const guarded = await transforms(['a'], { action: 1 })
    guarded.range.end.line = 10001
    guarded.api.filterLinesWithContextToNewDocument(guarded.editor, guarded.range)
    assert.equal(guarded.output.text, undefined)
})

async function registrations() {
    const calls = []
    const callbacks = new Map()
    const editor = { selection: {}, selections: [{}] }
    const subscriptions = []
    const registerCommand = (name, callback) => {
        callbacks.set(name, callback)
        return { name }
    }
    const functions = new Proxy({}, { get: (_, name) => (...args) => { calls.push([name, ...args]) } })
    // Synthetic modules need explicit export names
    const source = fs.readFileSync(path.join(root, 'src/extension.ts'), 'utf8')
    const names = [...source.matchAll(/transforms\.(\w+)/g)].map(match => match[1])
    const textCommandNames = [...source.matchAll(/textCommands\.(\w+)/g)].map(match => match[1])
    const conversionNames = [...source.matchAll(/conversionCommands\.(\w+)/g)].map(match => match[1])
    const api = await load('src/extension.ts', {
        vscode: { commands: { registerCommand, getCommands: async () => ['a', 'b'] }, window: { activeTextEditor: editor } },
        './Transforms': Object.fromEntries(names.map(name => [name, functions[name]])),
        './TextCommands': Object.fromEntries(textCommandNames.map(name => [name, functions[name]])),
        './ConversionCommands': Object.fromEntries(conversionNames.map(name => [name, functions[name]])),
        'vscode-extension-common': {
            Modify: { reverseLines: functions.reverseLines },
            View: { openShowDocument: functions.openShowDocument },
            Application: { registerCommand: (context, name, callback) => context.subscriptions.push(registerCommand(name, callback)) }
        }
    })
    api.activate({ subscriptions })
    for (const [name, callback] of callbacks) {
        if (name === 'dakara-internal.command') callback(() => calls.push(['internal']))
        else await callback()
    }
    await Promise.resolve()
    return JSON.parse(JSON.stringify({ names: [...callbacks.keys()], subscriptions, calls }))
}

test('command refactor preserves every command, subscription, and dispatched argument', async () => {
    const actual = await registrations()
    const mappings = [
        ['sortLines', 'sortLines', 'selections'], ['sortSelections', 'sortSelections', 'selections'],
        ['reverseLines', 'reverseLines', 'selections'], ['reverseSelections', 'reverseSelections', 'selections'],
        ['uniqueLines', 'uniqueLines', 'selections'], ['uniqueLinesNewDocument', 'uniqueLinesToNewDocument', 'selections'],
        ['countUniqueLinesNewDocument', 'countUniqueLinesToNewDocument', 'selections'], ['sortByLineLength', 'sortLinesByLength', 'selections'],
        ['trimLines', 'trimLines', 'selections'], ['trimSelections', 'trimSelections', 'selections'],
        ['randomLines', 'randomizeLines', 'selection'], ['randomSelections', 'randomizeSelections', 'selections'],
        ['filter', 'filterLines', 'selection'], ['filterAsNewDocument', 'filterLinesWithContextToNewDocument', 'selection'],
        ['internal', 'internal'],
        ['alignCursor', 'alignToCursor', 'selections'], ['alignCSV', 'alignCSV', 'selections'], ['compactCSV', 'compactCSV', 'selections'],
        ['commands', 'openShowDocument'], ['copyToNewDocument', 'copyToNewDocument', 'editor'], ['selectLines', 'selectLines', 'editor'],
        ['selectHighlights', 'selectHighlights'], ['linesAsJSON', 'linesAsJSON', 'editor'], ['selectionAsJSON', 'selectionAsJSON', 'editor'],
        ['JsonAsText', 'jsonStringAsText', 'editor'], ['escapes', 'escapes', 'editor'], ['joinLines', 'joinLines', 'editor'],
        ['splitLines', 'splitLines', 'editor'], ['splitLinesBeforeDelimiter', 'splitLinesBeforeDelimiter', 'editor'],
        ['splitLinesAfterDelimiter', 'splitLinesAfterDelimiter', 'editor'], ['rotateForwardSelections', 'rotateForwardSelections', 'editor'],
        ['rotateBackwardSelections', 'rotateBackwardSelections', 'editor'], ['normalizeDiacriticalMarks', 'normalizeDiacriticalMarks', 'editor'],
        ['addChineseEnglishSpacing', 'addChineseEnglishSpacing', 'editor'],
        ['addChineseEnglishSpacingInDocument', 'addChineseEnglishSpacingInDocument', 'editor'],
        ['convertCurlToCode', 'convertCurlToCode', 'editor'],
        ['encodingTools', 'encodingTools', 'editor'], ['convertDataFormat', 'convertDataFormat', 'editor']
    ]
    const names = mappings.map(([name]) => name === 'internal' ? 'dakara-internal.command' : `dakara-transformer.${name}`)
    assert.deepEqual(actual.names, names)
    assert.deepEqual(actual.subscriptions, names.map(name => ({ name })))
    const editor = { selection: {}, selections: [{}] }
    const expectedCalls = mappings.map(([name, fn, argument]) => {
        if (name === 'commands') return [fn, 'untitled:commands.txt', 'a\nb']
        if (!argument) return [fn]
        return argument === 'editor' ? [fn, editor] : [fn, editor, editor[argument]]
    })
    assert.deepEqual(actual.calls, expectedCalls)
})

test('macro completions preserve filtering, order, labels and fresh result objects', async () => {
    let provider
    const api = await load('src/macros/MacroExpression.ts', {
        vscode: {
            commands: { getCommands: async () => ['cursorLeft', 'selectAll', 'cursorSelect', 'type'] },
            languages: { registerCompletionItemProvider: (_, value) => { provider = value } },
            Range: class {}, Position: class {},
            CompletionItemKind: { Variable: 1 },
            CompletionItem: class { constructor(label, kind) { this.label = label; this.kind = kind } }
        },
        './ExtendedCommands': { getCommands: () => [{ name: 'cursorForwardUntil' }] }
    })
    await Promise.resolve()
    const complete = prefix => provider.provideCompletionItems({ getText: () => prefix }, { line: 0, character: 1 })
    for (const [prefix, expected] of Object.entries({ c: ['c cursorLeft', 'c cursorSelect'], s: ['s selectAll', 's cursorSelect'], v: ['v cursorLeft', 'v selectAll', 'v cursorSelect', 'v type'], x: ['x cursorForwardUntil'] })) {
        assert.deepEqual(Array.from(complete(prefix), item => item.label), expected)
        assert.notEqual(complete(prefix)[0], complete(prefix)[0])
    }
    assert.equal(complete('?'), undefined)
    assert.equal(api.parseScript('t "hello"').commands[0].parameters[0].text, 'hello')
})

async function macroRepository() {
    let disk = { macros: [{ name: 'example', content: 'v cursorLeft' }] }
    const writes = []
    const api = await load('src/macros/MacroRepository.ts', {
        vscode: { workspace: { workspaceFolders: [{ uri: { fsPath: '/workspace' } }] } },
        fs: {
            readFile: (_, __, callback) => callback(null, JSON.stringify(disk)),
            writeFile: (filename, text, callback) => writes.push({
                filename, text,
                complete(error = null) {
                    if (!error) disk = JSON.parse(text)
                    callback(error)
                }
            })
        }
    })
    await api.getMacroNames()
    return { api, writes, readDisk: () => disk }
}

for (const command of ['saveMacro', 'deleteMacro']) {
    test(`${command} completes after a successful write`, async () => {
        const { api, writes, readDisk } = await macroRepository()
        let settled = false
        const operation = api[command]('example', 'v cursorRight').then(() => { settled = true })
        await Promise.resolve()
        assert.equal(settled, false)
        assert.equal(writes[0].filename, '/workspace/.vscode/macros.json')
        writes[0].complete()
        await Promise.race([operation, new Promise(resolve => setImmediate(resolve))])
        assert.equal(settled, true, 'Successful file writes must complete the operation')
        assert.deepEqual(readDisk().macros, command === 'saveMacro' ? [{ name: 'example', content: 'v cursorRight' }] : [])
    })

    test(`${command} propagates file write errors`, async () => {
        const { api, writes } = await macroRepository()
        const operation = api[command]('example', 'v cursorRight')
        const error = new Error('permission denied')
        writes[0].complete(error)
        await assert.rejects(operation, value => value === error)
    })
}

async function macroBuilder(create = false) {
    const repository = await macroRepository()
    const providers = new Map()
    const errors = []
    let scriptDocument, watcher
    const makeEditor = document => ({
        document, viewColumn: 1, selections: [],
        selection: { isEmpty: true, anchor: { line: 0, character: 0 } },
        setDecorations() {}
    })
    const vscode = {
        window: {
            activeTextEditor: makeEditor({ getText: () => '' }),
            showInputBox: async () => 'new macro',
            showWarningMessage: async () => 'Delete',
            showErrorMessage: message => { errors.push(message) }
        },
        languages: { registerCodeLensProvider: (selector, provider) => providers.set(selector.language, provider) },
        EventEmitter: class { event = () => {}; fire() {} }
    }
    const View = {
        createCursorDecoratorType: () => ({}),
        createCursorDecorator: () => ({}),
        makeOption: option => option,
        promptOptions: async () => ({ label: 'example' }),
        makeCodeLens: (label, _, __, run) => ({ label, run }),
        setFocusOnEditorColumn() {},
        openShowDocument: async (name, text) => {
            const document = { text, getText() { return this.text } }
            if (name.endsWith('.macro')) scriptDocument = document
            return makeEditor(document)
        },
        visibleTextEditorFromDocument: document => makeEditor(document),
        watchDocument: (_, callback) => { watcher = callback; return { dispose() {} } }
    }
    const common = { View, Region: {}, Lines: {}, Modify: {}, Application: {} }
    const api = await load('src/macros/MacroBuilder.ts', {
        path, vscode,
        'vscode-extension-common': common,
        './MacroRepository': Object.fromEntries(Object.entries(repository.api)),
        './MacroExpression': {}, './ExtendedCommands': {}, '../Transforms': { linesAsJSON() {} }
    })
    if (create) await api.createMacro()
    else await api.editMacro()
    await new Promise(resolve => setImmediate(resolve))
    const edit = async text => {
        scriptDocument.text = text
        await watcher({ eventType: 'change' })
    }
    await edit('v cursorRight')
    return {
        ...repository, api, errors, edit,
        saveLens: () => providers.get('macro').provideCodeLenses(scriptDocument)?.[0]
    }
}

for (const create of [false, true]) {
    for (const fail of [false, true]) {
        test(`${create ? 'new' : 'existing'} macro stays unsaved until a ${fail ? 'failed' : 'successful'} write finishes`, async () => {
            const harness = await macroBuilder(create)
            const operation = harness.saveLens().run()
            await new Promise(resolve => setImmediate(resolve))
            assert.ok(harness.saveLens(), 'Starting a file write must not mark the script as saved')
            harness.writes[0].complete(fail ? new Error('permission denied') : null)
            await operation
            if (fail) {
                assert.ok(harness.saveLens(), 'Failed writes must keep the save action available')
                assert.match(harness.errors[0], /permission denied/)
                if (create) assert.equal(harness.saveLens().label, 'Save Script: ')
            } else {
                assert.equal(harness.saveLens(), undefined)
                assert.equal(harness.errors.length, 0)
            }
        })
    }
}

test('edits made during a macro write remain unsaved after that write succeeds', async () => {
    const harness = await macroBuilder()
    const operation = harness.saveLens().run()
    await harness.edit('v cursorUp')
    harness.writes[0].complete()
    await operation
    assert.ok(harness.saveLens())
    assert.equal(harness.readDisk().macros[0].content, 'v cursorRight')
})

for (const fail of [false, true]) {
    test(`macro deletion waits for the write and ${fail ? 'reports failure' : 'completes on success'}`, async () => {
        const harness = await macroBuilder()
        let settled = false
        const operation = harness.api.deleteMacro().then(() => { settled = true })
        await new Promise(resolve => setImmediate(resolve))
        assert.equal(settled, false)
        harness.writes[0].complete(fail ? new Error('permission denied') : null)
        await Promise.race([operation, new Promise(resolve => setImmediate(resolve))])
        assert.equal(settled, true)
        if (fail) assert.match(harness.errors[0], /permission denied/)
        else assert.equal(harness.errors.length, 0)
    })
}

if (process.env.REFACTOR_BASELINE) {
    test('benchmark production transforms against the supplied baseline with identical outputs', async () => {
        const { performance } = require('node:perf_hooks')
        const scenarios = [
            {
                name: 'context: 5000 matched lines, 3 surrounding lines',
                texts: Array.from({ length: 5000 }, (_, index) => `line ${index}`),
                options: { 'Surrounding Lines': '3' },
                command: 'filterLinesWithContextToNewDocument'
            },
            ...['alignCSV', 'compactCSV'].map(command => ({
                name: `${command}: 100 rows x 1000 columns`,
                texts: Array.from({ length: 100 }, (_, row) => Array.from({ length: 1000 }, (_, column) => ` ${row}-${column} `).join(',')),
                options: {}, command
            }))
        ]
        const results = []
        for (const scenario of scenarios) {
            const old = await transforms(scenario.texts, scenario.options, true)
            const current = await transforms(scenario.texts, scenario.options)
            const invoke = harness => scenario.command === 'filterLinesWithContextToNewDocument'
                ? harness.api[scenario.command](harness.editor, harness.range)
                : harness.api[scenario.command](harness.editor, [harness.range])
            await invoke(old)
            await invoke(current)
            assert.deepEqual(current.output, old.output)
            const timings = { before: [], after: [] }
            for (let iteration = 0; iteration < 5; iteration++) {
                for (const [name, harness] of iteration % 2 ? [['after', current], ['before', old]] : [['before', old], ['after', current]]) {
                    const start = performance.now()
                    await invoke(harness)
                    timings[name].push(performance.now() - start)
                }
            }
            const median = values => values.sort((a, b) => a - b)[2]
            results.push({ scenario: scenario.name, beforeMs: median(timings.before), afterMs: median(timings.after) })
        }
        fs.writeFileSync(path.join(root, 'out/refactor-benchmark.json'), JSON.stringify(results, null, 2))
        console.table(results)
    })
}
