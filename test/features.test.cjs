const assert = require('node:assert/strict')
const { test } = require('node:test')
const { loadSource, dependencyRequire } = require('./feature-helpers.cjs')
const { editorHarness } = require('./editor-helpers.cjs')

test('Chinese spacing changes only Chinese-letter and Chinese-digit boundaries and is idempotent', () => {
  const { addChineseEnglishSpacing } = loadSource('src/ChineseSpacing.ts')
  for (const [input, expected] of [
    ['使用VSCode处理100行文本', '使用 VSCode 处理 100 行文本'],
    ['中文English123测试', '中文 English123 测试'],
    ['English中文123数字', 'English 中文 123 数字'],
    ['已经 spaced 100 行', '已经 spaced 100 行'],
    ['中文，标点。English!123', '中文，标点。English!123'],
    ['\t中文ABC\r\n下一行2\n', '\t中文 ABC\r\n下一行 2\n'],
    ['𠀀A𠀁1', '𠀀 A 𠀁 1'],
    ['', ''],
    ['English123', 'English123'],
  ]) {
    assert.equal(addChineseEnglishSpacing(input), expected)
    assert.equal(addChineseEnglishSpacing(expected), expected)
  }
})

const requestCommand = `curl 'https://example.test/api?q=hello&tag=one&tag=two' \\
  -X POST \\
  -H 'Content-Type: application/json' \\
  -H 'Authorization: Bearer sample-token' \\
  --data-raw '{"message":"中文 hello","number":123}'`

test('curl parsing retains method, query, headers, JSON and multiline input', async () => {
  const { parseCurl } = loadSource('src/CurlConverter.ts')
  const request = await parseCurl(requestCommand)
  assert.equal(request.method, 'POST')
  assert.equal(request.url.toString(), 'https://example.test/api?q=hello&tag=one&tag=two')
  assert.equal(request.headers.get('Authorization'), 'Bearer sample-token')
  assert.equal(request.headers.get('Content-Type'), 'application/json')
  assert.deepEqual(JSON.parse(request.body.raw), { message: '中文 hello', number: 123 })
})

test('curl parsing retains form fields and basic authentication', async () => {
  const { parseCurl } = loadSource('src/CurlConverter.ts')
  const request = await parseCurl(
    "curl https://example.test/form -u demo:password --data-urlencode 'name=hello world' --data-urlencode 'name=second'"
  )
  assert.equal(request.method, 'POST')
  assert.equal(request.body.mode, 'urlencoded')
  assert.deepEqual(
    request.body.urlencoded.toJSON().map(({ key, value }) => ({ key, value })),
    [
      { key: 'name', value: 'hello world' },
      { key: 'name', value: 'second' },
    ]
  )
  assert.equal(request.auth.type, 'basic')
  assert.equal(request.auth.basic.get('username'), 'demo')
  assert.equal(request.auth.basic.get('password'), 'password')
})

test('invalid curl input produces an error rather than an empty request', async () => {
  const { parseCurl } = loadSource('src/CurlConverter.ts')
  for (const input of ['', 'echo hello', 'curl', 'curl --data']) {
    await assert.rejects(parseCurl(input), /curl|URL|argument|parameter|option/i)
  }
})

test('target menu includes every installed Postman generator except curl, with VS Code language IDs', () => {
  const { getCodeTargets } = loadSource('src/CurlConverter.ts')
  const expected = dependencyRequire('postman-code-generators')
    .getLanguageList()
    .filter((language) => language.key !== 'curl')
    .flatMap((language) => language.variants.map((variant) => `${language.key}:${variant.key}`))
  const targets = getCodeTargets()
  assert.deepEqual(
    targets.map((target) => `${target.language}:${target.variant}`),
    expected
  )
  assert.equal(targets.find((target) => target.language === 'go').languageId, 'go')
  assert.equal(targets.find((target) => target.language === 'c').languageId, 'c')
  assert.equal(targets.find((target) => target.language === 'http').languageId, 'plaintext')
  assert.equal(targets.find((target) => target.language === 'shell').languageId, 'shellscript')
})

test('every language and library generates nonempty code for GET, JSON and form requests', async () => {
  const { parseCurl, getCodeTargets, generateCode } = loadSource('src/CurlConverter.ts')
  const commands = [
    'curl https://example.test/items?page=1',
    requestCommand,
    "curl https://example.test/form -u demo:password --data-urlencode 'name=hello world'",
  ]
  let count = 0
  for (const target of getCodeTargets()) {
    for (const command of commands) {
      const code = await generateCode(await parseCurl(command), target)
      assert.ok(code.trim().length, `${target.label}: empty output`)
      assert.ok(code.includes('example.test'), `${target.label}: missing request URL`)
      count++
    }
  }
  console.log(`Verified ${count} real Postman conversions`)
})

test('spacing supports multiple selections and deduplicates empty-cursor document scope', async () => {
  const multiple = editorHarness('中文A / 中文B', [
    [0, 3],
    [6, 9],
  ])
  await loadSource('src/TextCommands.ts', { vscode: multiple.vscode }).addChineseEnglishSpacing(multiple.editor)
  assert.equal(multiple.read(), '中文 A / 中文 B')
  assert.equal(multiple.editCount(), 1)
  const overlapping = editorHarness('中文A中文B', [
    [0, 0],
    [3, 3],
  ])
  const commands = loadSource('src/TextCommands.ts', { vscode: overlapping.vscode })
  await commands.addChineseEnglishSpacing(overlapping.editor)
  assert.equal(overlapping.read(), '中文 A 中文 B')
  assert.equal(overlapping.editCount(), 1)
  await commands.addChineseEnglishSpacing(overlapping.editor)
  assert.equal(overlapping.editCount(), 1, 'Already spaced text should not add an undo step')
})

test('whole-document spacing preserves newlines and transforms all lines', async () => {
  const harness = editorHarness('中文A\n下一行2')
  await loadSource('src/TextCommands.ts', { vscode: harness.vscode }).addChineseEnglishSpacingInDocument(harness.editor)
  assert.equal(harness.read(), '中文 A\n下一行 2')
  assert.equal(harness.editCount(), 1)
})

test('curl command reads the selection, opens highlighted code and preserves source', async () => {
  const command = 'curl https://example.test/items'
  const original = command + '\nnot part of the curl command'
  const harness = editorHarness(original, [[0, command.length]])
  await loadSource('src/TextCommands.ts', { vscode: harness.vscode }).convertCurlToCode(harness.editor)
  assert.equal(harness.errors.length, 0)
  assert.equal(harness.opened.length, 1)
  assert.equal(harness.opened[0].language, 'python')
  assert.match(harness.opened[0].content, /requests/)
  assert.ok(harness.opened[0].content.includes('example.test'))
  assert.equal(harness.shown.length, 1)
  assert.equal(harness.read(), original)
})

test('cancelled and invalid curl conversions do not open documents or change source', async () => {
  const cancelled = editorHarness('curl https://example.test')
  cancelled.vscode.window.showQuickPick = async () => undefined
  await loadSource('src/TextCommands.ts', { vscode: cancelled.vscode }).convertCurlToCode(cancelled.editor)
  assert.equal(cancelled.opened.length, 0)
  assert.equal(cancelled.errors.length, 0)
  const invalid = editorHarness('echo hello')
  await loadSource('src/TextCommands.ts', { vscode: invalid.vscode }).convertCurlToCode(invalid.editor)
  assert.equal(invalid.opened.length, 0)
  assert.match(invalid.errors[0], /curl/)
  assert.equal(invalid.read(), 'echo hello')
})

test('curl output falls back to plain text when target syntax support is unavailable', async () => {
  const harness = editorHarness('curl https://example.test')
  harness.vscode.languages.getLanguages = async () => ['plaintext']
  await loadSource('src/TextCommands.ts', { vscode: harness.vscode }).convertCurlToCode(harness.editor)
  assert.equal(harness.opened[0].language, 'plaintext')
  assert.equal(harness.errors.length, 0)
})

test('spacing commands do not load Postman dependencies, and commands tolerate no active editor', async () => {
  const harness = editorHarness('中文A')
  const overrides = { vscode: harness.vscode }
  Object.defineProperty(overrides, './CurlConverter', {
    get() {
      throw new Error('Postman must stay unloaded')
    },
  })
  const commands = loadSource('src/TextCommands.ts', overrides)
  await commands.addChineseEnglishSpacing(harness.editor)
  assert.equal(harness.read(), '中文 A')
  await commands.addChineseEnglishSpacing(undefined)
  await commands.addChineseEnglishSpacingInDocument(undefined)
  await commands.convertCurlToCode(undefined)
  assert.equal(harness.errors.length, 0)
})

test('generator failures and empty snippets are reported rather than opening empty output', async () => {
  const target = { language: 'python', variant: 'Requests' }
  for (const [error, snippet, expected] of [
    ['unsupported request', null, /unsupported request/],
    [null, '', /no code/],
  ]) {
    const converter = loadSource('src/CurlConverter.ts', {
      'postman-code-generators': { convert: (_, __, ___, ____, callback) => callback(error, snippet) },
    })
    await assert.rejects(converter.generateCode({}, target), expected)
  }
})

test('legacy feature commands remain declared for activation and keybinding compatibility', () => {
  const manifest = require('../package.json')
  for (const name of [
    'addChineseEnglishSpacing',
    'addChineseEnglishSpacingInDocument',
    'convertCurlToCode',
    'encodingTools',
    'convertDataFormat',
  ]) {
    const command = `dakara-transformer.${name}`
    assert.ok(manifest.activationEvents.includes('onCommand:' + command))
    assert.equal(manifest.contributes.commands.find((item) => item.command === command).category, 'Transform')
  }
})
