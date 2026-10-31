const assert = require('node:assert/strict')
const { test } = require('node:test')
const { loadSource } = require('./feature-helpers.cjs')

test('UTF-8 encodings round-trip Chinese, emoji, whitespace and empty text', async () => {
  const { transformText } = loadSource('src/TextEncoding.ts')
  for (const text of ['中文 😀 + & <> " \\ \r\n', '', '\ufeffBOM']) {
    for (const name of [
      'base64',
      'base64url',
      'hex',
      'uri',
      'component',
      'form',
      'html',
      'xml',
      'unicode',
      'json',
      'bytes',
    ]) {
      assert.equal(await transformText(await transformText(text, name + ':encode'), name + ':decode'), text, name)
    }
  }
})

test('byte arrays and Base64 interoperate without requiring bytes to be valid UTF-8', async () => {
  const { transformText } = loadSource('src/TextEncoding.ts')
  assert.equal(await transformText('[0,255,128,65]', 'bytes:hex'), '00ff8041')
  assert.equal(await transformText('00ff8041', 'hex:bytes'), '[0,255,128,65]')
  assert.equal(await transformText('AP+AQQ==', 'base64:bytes'), '[0,255,128,65]')
  assert.equal(await transformText('[0,255,128,65]', 'bytes:base64'), 'AP+AQQ==')
  for (const [text, operation] of [
    ['[256]', 'bytes:decode'],
    ['[1.5]', 'bytes:hex'],
    ['["1"]', 'bytes:base64'],
    ['abc', 'hex:decode'],
    ['not valid!', 'base64:decode'],
    ['/w==', 'base64:decode'],
    ['\\uZZZZ', 'unicode:decode'],
    ['{}', 'json:decode'],
  ]) {
    await assert.rejects(transformText(text, operation))
  }
})

test('hashes and keyed hashes match independent standard vectors', async () => {
  const { transformText } = loadSource('src/TextEncoding.ts')
  assert.equal(await transformText('abc', 'hash:md5:hex'), '900150983cd24fb0d6963f7d28e17f72')
  assert.equal(await transformText('abc', 'hash:sha1:hex'), 'a9993e364706816aba3e25717850c26c9cd0d89d')
  assert.equal(
    await transformText('abc', 'hash:sha256:hex'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
  )
  assert.equal(await transformText('abc', 'hash:sha256:base64'), 'ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=')
  assert.equal(
    await transformText('Hi There', 'hmac:sha256:hex', '\x0b'.repeat(20)),
    'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7'
  )
  assert.equal(
    await transformText('abc', 'hash:sha512:hex'),
    'ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f'
  )
  assert.equal(
    await transformText('Hi There', 'hmac:sha512:hex', '\x0b'.repeat(20)),
    '87aa7cdea5ef619d4ff0b4241a1d6cb02379f4e2ce4ec2787ad0b30545e17cdedaa833b7d6b8a702038b274eaea3f4e4be9d914eeb61f1702e696c203a126854'
  )
})

test('Crockford integers support aliases and reject unsafe numbers', async () => {
  const { transformText } = loadSource('src/TextEncoding.ts')
  assert.equal(await transformText('123456789', 'crockford:encode'), '3NQK8N')
  assert.equal(await transformText('3nq-k8n', 'crockford:decode'), '123456789')
  assert.equal(await transformText('o1l', 'crockford:decode'), '33')
  await assert.rejects(transformText('9007199254740992', 'crockford:encode'))
})

test('AES encrypts Unicode with fresh randomness and decrypts only authentic ciphertext', async () => {
  const { encryptText, decryptText } = loadSource('src/CryptoTools.ts')
  const text = '秘密 😀\r\nsecond line'
  const first = await encryptText(text, 'test password')
  assert.equal(await decryptText(first, 'test password'), text)
  assert.notEqual(first, await encryptText(text, 'test password'))
  assert.equal(await decryptText(await encryptText('', 'password'), 'password'), '')
  await assert.rejects(decryptText(first, 'wrong password'))
  const tampered = JSON.parse(first)
  tampered.ciphertext = Buffer.from('changed').toString('base64')
  await assert.rejects(decryptText(JSON.stringify(tampered), 'test password'))
  tampered.version = 999
  await assert.rejects(decryptText(JSON.stringify(tampered), 'test password'))
  await assert.rejects(encryptText('text', ''))
})
