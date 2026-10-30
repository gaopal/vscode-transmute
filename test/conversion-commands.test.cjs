const assert = require('node:assert/strict')
const { test } = require('node:test')
const { loadSource } = require('./feature-helpers.cjs')
const { editorHarness } = require('./editor-helpers.cjs')

test('encoding applies all selections in one edit, and any invalid selection aborts the operation', async () => {
    const harness = editorHarness('中文|hi', [[0, 2], [3, 5]])
    harness.vscode.window.showQuickPick = async operations => operations.find(operation => operation.id === 'base64:encode')
    await loadSource('src/ConversionCommands.ts', { vscode: harness.vscode }).encodingTools(harness.editor)
    assert.equal(harness.read(), '5Lit5paH|aGk=')
    assert.equal(harness.editCount(), 1)
    const invalid = editorHarness('aGk=|invalid!', [[0, 4], [5, 13]])
    invalid.vscode.window.showQuickPick = async operations => operations.find(operation => operation.id === 'base64:decode')
    await loadSource('src/ConversionCommands.ts', { vscode: invalid.vscode }).encodingTools(invalid.editor)
    assert.equal(invalid.read(), 'aGk=|invalid!')
    assert.equal(invalid.editCount(), 0)
    assert.equal(invalid.errors.length, 1)
})

test('encryption prompts for a password and opens an envelope without changing plaintext', async () => {
    const harness = editorHarness('秘密')
    harness.vscode.window.showQuickPick = async operations => operations.find(operation => operation.id === 'aes:encrypt')
    harness.vscode.window.showInputBox = async options => {
        assert.equal(options.password, true)
        return 'test-password'
    }
    await loadSource('src/ConversionCommands.ts', { vscode: harness.vscode }).encodingTools(harness.editor)
    assert.equal(harness.errors.length, 0)
    assert.equal(harness.read(), '秘密')
    assert.equal(harness.opened.length, 1)
    assert.equal(JSON.parse(harness.opened[0].content).algorithm, 'AES-256-GCM')
    assert.ok(!harness.opened[0].content.includes('test-password'))
})

test('cancelled menus and password prompts have no side effects', async () => {
    for (const passwordPrompt of [false, true]) {
        const harness = editorHarness('original')
        harness.vscode.window.showQuickPick = async operations => passwordPrompt ? operations.find(operation => operation.id === 'aes:encrypt') : undefined
        harness.vscode.window.showInputBox = async () => undefined
        const commands = loadSource('src/ConversionCommands.ts', { vscode: harness.vscode })
        await commands.encodingTools(harness.editor)
        assert.equal(harness.read(), 'original')
        assert.equal(harness.opened.length, 0)
        assert.equal(harness.errors.length, 0)
    }
})

test('an edit while the encoding menu is open cannot be overwritten by stale selections', async () => {
    const harness = editorHarness('original')
    harness.vscode.window.showQuickPick = async operations => {
        harness.setText('new user content')
        return operations.find(operation => operation.id === 'base64:encode')
    }
    await loadSource('src/ConversionCommands.ts', { vscode: harness.vscode }).encodingTools(harness.editor)
    assert.equal(harness.read(), 'new user content')
    assert.equal(harness.editCount(), 0)
    assert.match(harness.errors[0], /changed/i)
})

test('data format conversion prioritizes the document language and opens output without changing source', async () => {
    const harness = editorHarness('{"name":"demo"}')
    harness.editor.document.languageId = 'json'
    let menus = 0
    harness.vscode.window.showQuickPick = async formats => {
        if (menus++ === 0) { assert.equal(formats[0].id, 'json'); return formats[0] }
        return formats.find(format => format.id === 'yaml')
    }
    harness.vscode.languages.getLanguages = async () => ['yaml', 'plaintext']
    await loadSource('src/ConversionCommands.ts', { vscode: harness.vscode }).convertDataFormat(harness.editor)
    assert.equal(harness.errors.length, 0)
    assert.equal(harness.opened[0].language, 'yaml')
    assert.match(harness.opened[0].content, /name: demo/)
    assert.equal(harness.read(), '{"name":"demo"}')
})

test('cancelled or unrepresentable data conversions open no document', async () => {
    for (const cancel of [false, true]) {
        const harness = editorHarness('{"value":null}')
        let menus = 0
        harness.vscode.window.showQuickPick = async formats => {
            if (menus++ === 0) return formats.find(format => format.id === 'json')
            return cancel ? undefined : formats.find(format => format.id === 'toml')
        }
        await loadSource('src/ConversionCommands.ts', { vscode: harness.vscode }).convertDataFormat(harness.editor)
        assert.equal(harness.opened.length, 0)
        assert.equal(harness.errors.length, cancel ? 0 : 1)
        assert.equal(harness.read(), '{"value":null}')
    }
})
