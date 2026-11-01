const vscode = require('vscode')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const reportDirectory = path.resolve(__dirname, '../../../artifacts')
const reportFile = path.join(reportDirectory, 'installed-smoke.json')
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitFor(condition, message) {
  const deadline = Date.now() + 10000
  while (!condition() && Date.now() < deadline) await delay(50)
  assert.ok(condition(), message)
}

async function run(context) {
  fs.mkdirSync(reportDirectory, { recursive: true })
  const report = {
    startedAt: new Date().toISOString(),
    vscodeVersion: vscode.version,
    profileStoragePath: context.globalStorageUri.fsPath,
    extensionHostPid: process.pid,
    results: [],
  }
  const persist = () => fs.writeFileSync(reportFile, JSON.stringify(report, null, 2))
  async function check(name, callback) {
    const start = Date.now()
    try {
      await callback()
      report.results.push({ name, status: 'passed', elapsedMs: Date.now() - start })
    } catch (error) {
      report.results.push({
        name,
        status: 'failed',
        error: error.stack || String(error),
        elapsedMs: Date.now() - start,
      })
      try {
        await vscode.commands.executeCommand('workbench.action.closeQuickOpen')
      } catch {}
    }
    persist()
  }
  let extension
  await check('Packaged extension activates as version 1.13.1', async () => {
    extension = vscode.extensions.getExtension('gaopal.vscode-transmute')
    assert.ok(extension, 'Packaged extension is not installed')
    assert.equal(extension.packageJSON.version, '1.13.1')
    await extension.activate()
    assert.ok(extension.isActive)
    report.extensionPath = extension.extensionPath
  })
  if (extension?.isActive) {
    const fromPackage = (name) => require(path.join(extension.extensionPath, 'out', name))
    const commands = await vscode.commands.getCommands(true)
    await check('Windows profile is isolated from the daily VS Code user data', async () => {
      assert.ok(context.globalStorageUri.fsPath.includes('vscode-test'), 'Unexpected user data directory')
      assert.equal(
        vscode.workspace.getConfiguration('localTransformerSmoke').get('profileMarker'),
        'Windows-6d6f8e04',
        'The Windows profile settings are not active'
      )
    })
    await check('Every contributed command is registered', async () => {
      const names = extension.packageJSON.contributes.commands.map((item) => item.command)
      for (const name of names) assert.ok(commands.includes(name), 'Missing command: ' + name)
      report.registeredCommandCount = names.length
    })
    async function open(content, language = 'plaintext') {
      const document = await vscode.workspace.openTextDocument({ content, language })
      const editor = await vscode.window.showTextDocument(document, { preview: false })
      editor.selection = new vscode.Selection(0, 0, 0, 0)
      return editor
    }
    async function choose(command, indices, cancelPassword = false) {
      for (const id of [
        'workbench.action.quickOpenSelectNext',
        'workbench.action.acceptSelectedQuickOpenItem',
        'workbench.action.closeQuickOpen',
      ]) {
        assert.ok(commands.includes(id), 'Quick input automation unavailable: ' + id)
      }
      const operation = vscode.commands.executeCommand(command)
      for (const index of indices) {
        await delay(500)
        for (let step = 0; step < index; step++)
          await vscode.commands.executeCommand('workbench.action.quickOpenSelectNext')
        await vscode.commands.executeCommand(
          index < 0 ? 'workbench.action.closeQuickOpen' : 'workbench.action.acceptSelectedQuickOpenItem'
        )
      }
      if (cancelPassword) {
        await delay(500)
        await vscode.commands.executeCommand('workbench.action.closeQuickOpen')
      }
      let timeout
      try {
        await Promise.race([
          operation,
          new Promise((_, reject) => {
            timeout = setTimeout(() => reject(new Error('Command did not finish after quick input actions')), 10000)
          }),
        ])
      } finally {
        clearTimeout(timeout)
      }
    }
    await check('Document spacing edits every line and undoes in one step', async () => {
      const original = '使用VSCode处理100行文本\n下一行A'
      const editor = await open(original)
      await vscode.commands.executeCommand('dakara-transformer.addChineseEnglishSpacing')
      assert.equal(editor.document.getText(), '使用 VSCode 处理 100 行文本\n下一行 A')
      await vscode.commands.executeCommand('undo')
      await waitFor(() => editor.document.getText() === original, 'Undo did not restore the document')
    })
    await check('The installed palette exposes only Transform: Open Menu...', async () => {
      const manifest = extension.packageJSON
      const hidden = new Set(
        manifest.contributes.menus.commandPalette.filter((item) => item.when === 'false').map((item) => item.command)
      )
      assert.deepEqual(
        manifest.contributes.commands
          .filter((item) => item.category === 'Transform' && !hidden.has(item.command))
          .map((item) => item.command),
        ['dakara-transformer.openMenu']
      )
    })
    await check('Grouped Transform menu sorts the entire document with no selection', async () => {
      const editor = await open('item10\nitem2\nitem1\n')
      await choose('dakara-transformer.openMenu', [0, 0, 0])
      assert.equal(editor.document.getText(), 'item1\nitem2\nitem10\n')
      await vscode.commands.executeCommand('undo')
      assert.equal(editor.document.getText(), 'item10\nitem2\nitem1\n')
    })
    await check('Cancelling the grouped menu leaves the document unchanged', async () => {
      const editor = await open('b\na')
      await choose('dakara-transformer.openMenu', [0, -1])
      assert.equal(editor.document.getText(), 'b\na')
    })
    await check('Grouped spacing ignores empty cursors next to real selections', async () => {
      const editor = await open('中文A|中文B')
      editor.selections = [new vscode.Selection(0, 0, 0, 3), new vscode.Selection(0, 4, 0, 4)]
      await choose('dakara-transformer.openMenu', [0, 10])
      assert.equal(editor.document.getText(), '中文 A|中文B')
    })
    await check('Hidden sort command preserves text outside multiple partial selections', async () => {
      const editor = await open('PREFIX b\na SUFFIX | z\ny END')
      editor.selections = [
        [7, 10],
        [20, 23],
      ].map(([start, end]) => new vscode.Selection(editor.document.positionAt(start), editor.document.positionAt(end)))
      await vscode.commands.executeCommand('dakara-transformer.sortLines')
      assert.equal(editor.document.getText(), 'PREFIX a\nb SUFFIX | y\nz END')
      await vscode.commands.executeCommand('undo')
      assert.equal(editor.document.getText(), 'PREFIX b\na SUFFIX | z\ny END')
    })
    await check('Multiple empty cursors transform the entire document once', async () => {
      const editor = await open('a\nb')
      editor.selections = [new vscode.Selection(0, 0, 0, 0), new vscode.Selection(1, 0, 1, 0)]
      await choose('dakara-transformer.encodingTools', [0])
      assert.equal(editor.document.getText(), 'YQpi')
    })
    await check('Whole-document spacing edits every line in the real editor', async () => {
      const editor = await open('中文A\n数字2')
      await vscode.commands.executeCommand('dakara-transformer.addChineseEnglishSpacingInDocument')
      assert.equal(editor.document.getText(), '中文 A\n数字 2')
    })
    await check('Encoding menu converts Chinese to UTF-8 Base64 in the real editor', async () => {
      const editor = await open('中文')
      await choose('dakara-transformer.encodingTools', [0])
      assert.equal(editor.document.getText(), '5Lit5paH')
    })
    await check('Cancelling the real encoding menu preserves the source', async () => {
      const editor = await open('cancel me')
      await choose('dakara-transformer.encodingTools', [-1])
      assert.equal(editor.document.getText(), 'cancel me')
    })
    await check('JSON-to-YAML menus produce a separate real document', async () => {
      fromPackage('DataFormats').getDataFormats()
      const editor = await open('{"app":{"name":"demo"}}', 'json')
      await choose('dakara-transformer.convertDataFormat', [0, 0])
      const result = vscode.window.activeTextEditor.document
      assert.notEqual(result.uri.toString(), editor.document.uri.toString())
      assert.match(result.getText(), /name: demo/)
      assert.equal(editor.document.getText(), '{"app":{"name":"demo"}}')
    })
    await check('cURL menu generates Python Requests code in a new real document', async () => {
      const converter = fromPackage('CurlConverter')
      const targets = converter.getCodeTargets()
      const index = targets.findIndex((target) => target.language === 'python' && target.variant === 'Requests')
      assert.ok(index >= 0)
      const editor = await open('curl https://example.test/items')
      await choose('dakara-transformer.convertCurlToCode', [index])
      const result = vscode.window.activeTextEditor.document
      assert.notEqual(result.uri.toString(), editor.document.uri.toString())
      assert.match(result.getText(), /requests/)
      assert.ok(result.getText().includes('example.test'))
      assert.equal(editor.document.getText(), 'curl https://example.test/items')
    })
    await check('Cancelling the real AES password prompt preserves the source', async () => {
      const operations = fromPackage('TextEncoding').getTextOperations()
      const index = operations.findIndex((operation) => operation.id === 'aes:encrypt')
      const editor = await open('secret test text')
      await choose('dakara-transformer.encodingTools', [index], true)
      assert.equal(editor.document.getText(), 'secret test text')
    })
    await check('Packaged AES round-trip and authentication run in the VS Code extension host', async () => {
      const crypto = fromPackage('CryptoTools')
      const envelope = await crypto.encryptText('秘密 😀', 'local-smoke-test')
      assert.equal(await crypto.decryptText(envelope, 'local-smoke-test'), '秘密 😀')
      await assert.rejects(crypto.decryptText(envelope, 'wrong-password'))
    })
    await check('All 30 packaged data conversion paths run in the VS Code extension host', async () => {
      const converter = fromPackage('DataFormats')
      const fixtures = {
        json: '{"app":{"name":"demo"}}',
        yaml: 'app:\n  name: demo\n',
        xml: '<app><name>demo</name></app>',
        properties: 'app.name=demo',
        toml: '[app]\nname="demo"',
        ini: '[app]\nname=demo',
      }
      let count = 0
      for (const source of Object.keys(fixtures))
        for (const target of Object.keys(fixtures)) {
          if (source === target) continue
          const output = converter.convertData(fixtures[source], source, target)
          assert.deepEqual(JSON.parse(JSON.stringify(converter.parseData(output, target))), { app: { name: 'demo' } })
          count++
        }
      assert.equal(count, 30)
    })
    await check('All 33 packaged Postman generators run in the VS Code extension host', async () => {
      const converter = fromPackage('CurlConverter')
      const targets = converter.getCodeTargets()
      assert.equal(targets.length, 33)
      for (const target of targets) {
        const request = await converter.parseCurl('curl https://example.test/check')
        const output = await converter.generateCode(request, target)
        assert.ok(output.includes('example.test'), target.label)
      }
    })
  }
  report.completedAt = new Date().toISOString()
  report.passed = report.results.filter((result) => result.status === 'passed').length
  report.failed = report.results.length - report.passed
  persist()
  const markdown = [
    '# Transformer 本地安装测试',
    '',
    `VS Code ${report.vscodeVersion} · Windows profile · Transformer 1.13.1`,
    '',
    `通过 ${report.passed} 项，失败 ${report.failed} 项`,
    '',
    ...report.results.map((result) => `- ${result.status === 'passed' ? '通过' : '失败'}：${result.name}`),
    '',
    '此窗口使用独立的用户数据和扩展目录，正常 VS Code 窗口中的原版插件保持不变',
    '',
    '可在命令面板运行 Transform: Open Menu...，继续手动测试分类菜单和统一作用范围',
    '',
  ].join('\n')
  const markdownFile = path.join(reportDirectory, 'installed-smoke.md')
  fs.writeFileSync(markdownFile, markdown)
  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(markdownFile), { preview: false })
}

exports.activate = (context) => {
  if (!fs.existsSync(reportFile)) {
    setTimeout(
      () =>
        run(context).catch((error) => {
          fs.mkdirSync(reportDirectory, { recursive: true })
          fs.writeFileSync(reportFile, JSON.stringify({ fatalError: error.stack || String(error) }, null, 2))
        }),
      1000
    )
  }
}
