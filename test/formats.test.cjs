const assert = require('node:assert/strict')
const { test } = require('node:test')
const { loadSource } = require('./feature-helpers.cjs')

const fixtures = {
    json: '{"app":{"name":"demo","mode":"local"}}',
    yaml: 'app:\n  name: demo\n  mode: local\n',
    xml: '<app><name>demo</name><mode>local</mode></app>',
    properties: 'app.name=demo\napp.mode=local\n',
    toml: '[app]\nname="demo"\nmode="local"\n',
    ini: '[app]\nname=demo\nmode=local\n'
}

test('all 30 source-target combinations preserve representable configuration data', () => {
    const { convertData, parseData } = loadSource('src/DataFormats.ts')
    const expected = { app: { name: 'demo', mode: 'local' } }
    let count = 0
    for (const [source, text] of Object.entries(fixtures)) {
        for (const target of Object.keys(fixtures)) {
            if (target === source) continue
            const output = convertData(text, source, target)
            assert.deepEqual(JSON.parse(JSON.stringify(parseData(output, target))), expected, `${source} -> ${target}`)
            count++
        }
    }
    assert.equal(count, 30)
})

test('JSON YAML and TOML preserve supported numeric, boolean and array types', () => {
    const { convertData, parseData } = loadSource('src/DataFormats.ts')
    const value = { app: { count: 42, enabled: false, items: [1, 2], message: '中文 😀' } }
    for (const target of ['yaml', 'toml']) {
        const output = convertData(JSON.stringify(value), 'json', target)
        assert.deepEqual(JSON.parse(JSON.stringify(parseData(output, target))), value)
        assert.deepEqual(JSON.parse(convertData(output, target, 'json')), value)
    }
})

test('XML retains attributes and repeated elements, and adds a documented root when needed', () => {
    const { convertData } = loadSource('src/DataFormats.ts')
    const xml = '<root id="a"><item>x</item><item>y</item></root>'
    const json = convertData(xml, 'xml', 'json')
    assert.deepEqual(JSON.parse(json), { root: { '@_id': 'a', item: ['x', 'y'] } })
    assert.deepEqual(JSON.parse(convertData(convertData(json, 'json', 'xml'), 'xml', 'json')), JSON.parse(json))
    const wrapped = convertData('{"name":"demo","mode":"local"}', 'json', 'xml')
    assert.deepEqual(JSON.parse(convertData(wrapped, 'xml', 'json')), { root: { name: 'demo', mode: 'local' } })
})

test('INI and Properties keep boolean-looking and numeric-looking values as strings', () => {
    const { convertData } = loadSource('src/DataFormats.ts')
    for (const source of ['ini', 'properties']) {
        assert.deepEqual(JSON.parse(convertData('enabled=true\ncount=42\nempty=\n', source, 'json')), {
            enabled: 'true', count: '42', empty: ''
        })
    }
})

test('quoted INI keys containing equals signs preserve the full key', () => {
    const { convertData } = loadSource('src/DataFormats.ts')
    const value = { 'a=b': 'value' }
    assert.deepEqual(JSON.parse(convertData('"a=b"=value', 'ini', 'json')), value)
    assert.deepEqual(JSON.parse(convertData(convertData(JSON.stringify(value), 'json', 'ini'), 'ini', 'json')), value)
})

test('unsupported types and lossy target mappings fail with an explanation', () => {
    const { convertData } = loadSource('src/DataFormats.ts')
    for (const [text, target] of [
        ['{"app":null}', 'toml'], ['{"app":42}', 'xml'], ['{"app":true}', 'properties'],
        ['{"app":["one"]}', 'xml'], ['{"app":{}}', 'properties'], ['{"a.b":"value"}', 'properties']
    ]) assert.throws(() => convertData(text, 'json', target), /preserve|represent|unsupported|path|key|type|null/i)
})

test('malformed inputs, duplicate paths, cyclic aliases and unsafe XML are rejected', () => {
    const { parseData } = loadSource('src/DataFormats.ts')
    for (const [text, source] of [
        ['{', 'json'], ['a: 1\na: 2', 'yaml'], ['a: &a [*a]', 'yaml'],
        ['<root>', 'xml'], ['<!DOCTYPE root [<!ENTITY x "x">]><root>&x;</root>', 'xml'],
        ['<root>a<child>b</child>c</root>', 'xml'],
        ['<root><a>1</a><b>2</b><a>3</a></root>', 'xml'],
        ['<root>&unknown;</root>', 'xml'], ['<root>\u0000</root>', 'xml'],
        ['<root><__proto__>x</__proto__></root>', 'xml'],
        ['!!set {a: null}', 'yaml'], ['!!binary SGk=', 'yaml'],
        ['a=x\na.b=y', 'properties'], ['a=x\n[a]\nb=y', 'ini'],
        ['"unclosed=key=value', 'ini'],
        ['{"__proto__":{"polluted":true}}', 'json']
    ]) assert.throws(() => parseData(text, source), undefined, `${source}: ${text}`)
    assert.equal({}.polluted, undefined)
})
