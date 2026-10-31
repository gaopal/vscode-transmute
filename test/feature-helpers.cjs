const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { createRequire } = require('node:module')

const root = path.resolve(__dirname, '..')
const dependencyRequire = createRequire(path.join(process.env.TRANSFORMER_TEST_DEPENDENCIES || root, 'package.json'))
const ts = dependencyRequire('typescript')

function loadSource(file, overrides = {}, cache = new Map()) {
  const filename = path.resolve(root, file)
  if (cache.has(filename)) return cache.get(filename).exports
  const source = fs.readFileSync(filename, 'utf8')
  const result = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017 },
  })
  const module = { exports: {} }
  cache.set(filename, module)
  const localRequire = (name) => {
    if (Object.prototype.hasOwnProperty.call(overrides, name)) return overrides[name]
    if (name.startsWith('.')) return loadSource(path.resolve(path.dirname(filename), name + '.ts'), overrides, cache)
    return dependencyRequire(name)
  }
  vm.runInThisContext(`(function(require, module, exports) {\n${result.outputText}\n})`, { filename })(
    localRequire,
    module,
    module.exports
  )
  return module.exports
}

module.exports = { loadSource, dependencyRequire }
