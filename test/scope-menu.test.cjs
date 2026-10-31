const assert = require('node:assert/strict')
const { test } = require('node:test')
const { loadSource } = require('./feature-helpers.cjs')
const { editorHarness } = require('./editor-helpers.cjs')

test('no selection processes the entire document once, even with multiple empty cursors', async () => {
  const h = editorHarness('中文A\n第二行2', [
    [0, 0],
    [2, 2],
  ])
  await loadSource('src/TextCommands.ts', { vscode: h.vscode }).addChineseEnglishSpacing(h.editor)
  assert.equal(h.read(), '中文 A\n第二行 2')
  assert.equal(h.editCount(), 1)
})

test('empty cursors cannot expand a real selection to the current line', async () => {
  const h = editorHarness('中文A|中文B', [
    [0, 3],
    [4, 4],
  ])
  await loadSource('src/TextCommands.ts', { vscode: h.vscode }).addChineseEnglishSpacing(h.editor)
  assert.equal(h.read(), '中文 A|中文B')
})

test('the command palette exposes exactly one Transform entry', () => {
  const manifest = require('../package.json')
  const hidden = new Set(
    manifest.contributes.menus.commandPalette.filter((item) => item.when === 'false').map((item) => item.command)
  )
  const visible = manifest.contributes.commands.filter(
    (item) => item.category === 'Transform' && !hidden.has(item.command)
  )
  assert.deepEqual(
    visible.map((item) => item.command),
    ['dakara-transformer.openMenu']
  )
})

function scoped(h) {
  return loadSource('src/ScopedCommands.ts', {
    vscode: h.vscode,
    'vscode-extension-common': {
      View: {
        makeFilterFunction: (value) => {
          if (value.startsWith(' ')) return (text) => text.includes(value.slice(1))
          const regex = new RegExp(value, 'i')
          return (text) => regex.test(text)
        },
      },
    },
  })
}

test('line transformations preserve unselected prefixes and suffixes in every selection', async () => {
  const h = editorHarness('PREFIX b\na SUFFIX | z\ny END', [
    [7, 10],
    [20, 23],
    [0, 0],
  ])
  await scoped(h).run(h.editor, 'sortLines')
  assert.equal(h.read(), 'PREFIX a\nb SUFFIX | y\nz END')
  assert.equal(h.editCount(), 1)
})

test('whole-document line sorting preserves CRLF and the final newline', async () => {
  const h = editorHarness('item10\r\nitem2\r\nitem1\r\n')
  await scoped(h).run(h.editor, 'sortLines')
  assert.equal(h.errors.length, 0)
  assert.equal(h.read(), 'item1\r\nitem2\r\nitem10\r\n')
})

test('unique and trim process each input independently and do not touch empty cursors', async () => {
  const h = editorHarness('a\na|b\nb| x ', [
    [0, 3],
    [4, 7],
    [8, 8],
  ])
  await scoped(h).run(h.editor, 'uniqueLines')
  assert.equal(h.errors.length, 0)
  assert.equal(h.read(), 'a|b| x ')
  const trim = editorHarness(' a | b | x ', [
    [0, 3],
    [4, 7],
    [10, 10],
  ])
  await scoped(trim).run(trim.editor, 'trimLines')
  assert.equal(trim.read(), 'a|b| x ')
})

test('filtering may remove all selected text and cancellation leaves the document intact', async () => {
  const h = editorHarness('keep|abc|keep', [[5, 8]])
  h.vscode.window.showInputBox = async () => '^missing$'
  await scoped(h).run(h.editor, 'filter')
  assert.equal(h.read(), 'keep||keep')
  h.vscode.window.showInputBox = async () => undefined
  await scoped(h).run(h.editor, 'joinLines')
  assert.equal(h.editCount(), 1)
})

test('all conversions finish before editing, and changes during a prompt cannot be overwritten', async () => {
  const h = editorHarness('"valid"|123', [
    [0, 7],
    [8, 11],
  ])
  await scoped(h).run(h.editor, 'JsonAsText')
  assert.equal(h.editCount(), 0)
  assert.match(h.errors[0], /JSON string/)
  const stale = editorHarness('a\nb')
  stale.vscode.window.showInputBox = async () => {
    stale.setText('user edit')
    return ','
  }
  await scoped(stale).run(stale.editor, 'joinLines')
  assert.equal(stale.read(), 'user edit')
  assert.equal(stale.editCount(), 0)
  assert.match(stale.errors[0], /changed/)
})

test('reordering fragments requires multiple nonempty selections', async () => {
  const h = editorHarness('b|a', [
    [0, 1],
    [2, 3],
    [1, 1],
  ])
  await scoped(h).run(h.editor, 'reverseSelections')
  assert.equal(h.read(), 'a|b')
  const whole = editorHarness('b|a')
  await scoped(whole).run(whole.editor, 'reverseSelections')
  assert.equal(whole.read(), 'b|a')
  assert.match(whole.errors[0], /at least two/)
})

test('menus consolidate modes and dispatch to the original editor, while cancellation does nothing', async () => {
  const h = editorHarness('b\na')
  const calls = []
  h.vscode.commands = { executeCommand: async (...args) => calls.push(args) }
  const path = ['Text / Lines', 'Sort...', 'Natural order']
  h.vscode.window.showQuickPick = async (items, options) => {
    assert.match(options.placeHolder, /Entire document/)
    const item = items.find((item) => item.label === path.shift())
    assert.ok(item)
    return item
  }
  const menu = loadSource('src/TransformMenu.ts', { vscode: h.vscode })
  await menu.openMenu(h.editor)
  assert.deepEqual(calls, [['dakara-transformer.sortLines', h.editor]])
  h.vscode.window.showQuickPick = async () => undefined
  await menu.openMenu(h.editor)
  assert.equal(calls.length, 1)
})

test('every contributed command stays registered and legacy commands use the unified scope dispatcher', async () => {
  const h = editorHarness('b\na')
  const handlers = new Map(),
    disposed = [],
    calls = []
  h.vscode.commands = {
    registerCommand: (name, callback) => {
      assert.ok(!handlers.has(name))
      handlers.set(name, callback)
      const disposable = { name }
      disposed.push(disposable)
      return disposable
    },
  }
  h.vscode.window.activeTextEditor = h.editor
  const context = { subscriptions: [] }
  loadSource('src/extension.ts', {
    vscode: h.vscode,
    './Transforms': {},
    './TextCommands': {
      addChineseEnglishSpacing() {},
      addChineseEnglishSpacingInDocument() {},
      convertCurlToCode() {},
    },
    './ConversionCommands': { encodingTools() {}, convertDataFormat() {} },
    './ScopedCommands': { run: (...args) => calls.push(args) },
    './TransformMenu': { openMenu() {} },
  }).activate(context)
  const manifest = require('../package.json')
  assert.deepEqual([...handlers.keys()].sort(), manifest.contributes.commands.map((item) => item.command).sort())
  assert.deepEqual(context.subscriptions, disposed)
  await handlers.get('dakara-transformer.sortLines')()
  assert.deepEqual(calls, [[h.editor, 'sortLines']])
  let called = false
  handlers.get('dakara-internal.command')(() => {
    called = true
  })
  assert.ok(called)
})

test('CSV preserves quoted delimiters and uneven columns, and cancelled delimiters cannot edit', async () => {
  const h = editorHarness(' a , "b,c" , d\n x , y\n')
  h.vscode.window.showInputBox = async () => ','
  await scoped(h).run(h.editor, 'compactCSV')
  assert.equal(h.read(), 'a,"b,c",d\nx,y\n')
  h.vscode.window.showInputBox = async () => undefined
  await scoped(h).run(h.editor, 'alignCSV')
  assert.equal(h.editCount(), 1)
})

test('overlapping input ranges are rejected without editing or opening output', async () => {
  const h = editorHarness('abcde', [
    [0, 3],
    [2, 5],
  ])
  await scoped(h).run(h.editor, 'reverseLines')
  assert.match(h.errors[0], /Overlapping/)
  assert.equal(h.editCount(), 0)
  assert.equal(h.opened.length, 0)
})

test('encoding empty cursors use one whole-document input and ignore cursors beside selected text', async () => {
  for (const [text, spans, expected] of [
    [
      'a\nb',
      [
        [0, 0],
        [2, 2],
      ],
      'YQpi',
    ],
    [
      'a|b',
      [
        [0, 1],
        [2, 2],
      ],
      'YQ==|b',
    ],
  ]) {
    const h = editorHarness(text, spans)
    h.vscode.window.showQuickPick = async (operations) => operations.find((item) => item.id === 'base64:encode')
    await loadSource('src/ConversionCommands.ts', { vscode: h.vscode }).encodingTools(h.editor)
    assert.equal(h.read(), expected)
    assert.equal(h.editCount(), 1)
  }
})

test('multiple data inputs all validate before any output is opened', async () => {
  for (const second of ['{"b":"two"}', 'invalid']) {
    const first = '{"a":"one"}',
      text = first + '|' + second
    const h = editorHarness(text, [
      [0, first.length],
      [first.length + 1, text.length],
      [0, 0],
    ])
    let count = 0
    h.vscode.window.showQuickPick = async (formats) => formats.find((item) => item.id === (count++ ? 'yaml' : 'json'))
    await loadSource('src/ConversionCommands.ts', { vscode: h.vscode }).convertDataFormat(h.editor)
    assert.equal(h.opened.length, second === 'invalid' ? 0 : 2)
    assert.equal(h.errors.length, second === 'invalid' ? 1 : 0)
    assert.equal(h.read(), text)
  }
})

test('filter context preserves source line numbers and cannot include text outside either selection', async () => {
  const h = editorHarness('outside\nPREFIX hit\nkeep SUFFIX\noutside\nhit\nlast\noutside', [
    [15, 23],
    [39, 47],
  ])
  const doc = h.editor.document
  h.editor.options = { tabSize: 4 }
  h.vscode.window.createTextEditorDecorationType = () => ({})
  h.vscode.DecorationRangeBehavior = { ClosedClosed: 1 }
  const seen = [],
    gutters = []
  const view = {
    makeOption: (option) => option,
    QuickPickActionType: { INPUT: 1 },
    promptOptions(options, callback) {
      options[0].value = 'hit'
      options[1].value = '10'
      callback({}, 0)
    },
    makeFilterFunction: () => (text) => text.includes('hit'),
    openShowDocument: async (_, text) => {
      seen.push(text)
      return { setDecorations() {} }
    },
    createGutterDecorator: (_, text) => {
      gutters.push(text)
      return text
    },
  }
  const common = {
    View: view,
    Lines: {
      collectLines: (_, start, end) =>
        Array.from({ length: Math.min(end + 1, doc.lineCount) - start }, (_, i) => ({
          lineNumber: start + i,
          text: doc.lineAt(start + i).text,
        })),
    },
  }
  const api = loadSource('src/Transforms.ts', {
    vscode: h.vscode,
    'vscode-extension-common': common,
    './macros/MacroBuilder': {},
    md5: () => '',
  })
  api.filterLinesWithContextToNewDocument(h.editor, h.editor.selection, h.editor.selections)
  await Promise.resolve()
  assert.deepEqual(seen, ['hit\nkeep\nhit\nlast'])
  assert.deepEqual(gutters, [': 2', ': 3', ': 5', ': 6'])
  assert.equal(h.editCount(), 0)
})
