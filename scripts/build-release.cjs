const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { createRequire } = require('node:module')

const root = path.resolve(__dirname, '..')
const commonRepository = 'https://github.com/d-akara/vscode-extension-common.git'
const commonCommit = 'e8dec053a8830a5efc2ada3cd8cd8735f6a3e9b3'

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', ...options })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${path.basename(command)} failed with exit code ${result.status}`)
}

function npm(args, options = {}) {
  const nodeDirectory = path.dirname(process.execPath)
  const cli = [
    process.env.npm_execpath,
    path.join(nodeDirectory, 'node_modules/npm/bin/npm-cli.js'),
    path.resolve(nodeDirectory, '../lib/node_modules/npm/bin/npm-cli.js'),
  ].find((candidate) => candidate && fs.existsSync(candidate))
  if (!cli) throw new Error('Cannot find npm; install Node.js with npm or run this script through npm')
  run(process.execPath, [cli, ...args], options)
}

function writeManifest(directory, manifest) {
  fs.mkdirSync(directory, { recursive: true })
  fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify(manifest, null, 2) + '\n')
}

function install(directory) {
  npm(
    [
      'install',
      '--registry=https://registry.npmjs.org',
      '--ignore-scripts',
      '--install-links',
      '--package-lock=false',
      '--no-audit',
      '--no-fund',
    ],
    { cwd: directory }
  )
  fs.rmSync(path.join(directory, 'node_modules/.package-lock.json'), { force: true })
}

async function build() {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  if (manifest.publisher !== 'gaopal') throw new Error('Expected Marketplace publisher gaopal')
  if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) throw new Error('Expected a stable major.minor.patch version')
  if (process.env.RELEASE_TAG && process.env.RELEASE_TAG !== `v${manifest.version}`)
    throw new Error(`Release tag ${process.env.RELEASE_TAG} must match v${manifest.version}`)
  if (Number(process.versions.node.split('.')[0]) < 24)
    throw new Error('Build and regression tests require Node.js 24 or newer; the publish job can use Node.js 22')

  const releaseRoot = path.join(root, 'out/release')
  fs.mkdirSync(releaseRoot, { recursive: true })
  const buildRoot = fs.mkdtempSync(path.join(releaseRoot, 'build-'))
  const commonSource = path.join(buildRoot, 'common-source')
  const tools = path.join(buildRoot, 'tools')
  const stage = path.join(buildRoot, 'extension')

  run('git', ['clone', '--no-checkout', commonRepository, commonSource])
  run('git', ['-C', commonSource, 'checkout', '--detach', commonCommit])
  writeManifest(tools, {
    name: 'transformer-release-tools',
    private: true,
    version: '1.0.0',
    dependencies: {
      typescript: '3.9.7',
      '@types/node': '14.0.27',
      '@types/vscode': '1.58.0',
      '@vscode/vsce': '4.1.0',
    },
  })
  install(tools)

  const packagedManifest = JSON.parse(JSON.stringify(manifest))
  delete packagedManifest.scripts
  delete packagedManifest.devDependencies
  packagedManifest.dependencies['vscode-extension-common'] = 'file:' + commonSource.replace(/\\/g, '/')
  writeManifest(stage, packagedManifest)
  for (const file of [
    'README.md',
    'CHANGELOG.md',
    'LICENSE',
    '.vscodeignore',
    'transformer-icon.png',
    'language-configuration.json',
    'macro.tmLanguage',
    'tsconfig.json',
  ])
    fs.copyFileSync(path.join(root, file), path.join(stage, file))
  for (const directory of ['src', 'readme-images'])
    fs.cpSync(path.join(root, directory), path.join(stage, directory), { recursive: true })
  install(stage)

  const toolRequire = createRequire(path.join(tools, 'package.json'))
  const ts = toolRequire('typescript')
  const compilerOptions = {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2017,
    typeRoots: [path.join(tools, 'node_modules/@types')],
    types: ['node', 'vscode'],
  }
  function compile(directory, declarations = false) {
    let config = {
      fileNames: ts.sys.readDirectory(path.join(directory, 'src'), ['.ts']),
      options: {
        ...compilerOptions,
        rootDir: declarations ? directory : path.join(directory, 'src'),
        outDir: path.join(directory, 'out'),
        declaration: declarations,
      },
    }
    if (!declarations) {
      const loaded = ts.readConfigFile(path.join(directory, 'tsconfig.json'), ts.sys.readFile)
      if (loaded.error) throw new Error(ts.flattenDiagnosticMessageText(loaded.error.messageText, '\n'))
      config = ts.parseJsonConfigFileContent(loaded.config, ts.sys, directory)
      if (config.errors.length)
        throw new Error(
          config.errors.map((error) => ts.flattenDiagnosticMessageText(error.messageText, '\n')).join('\n')
        )
      config.options.typeRoots = compilerOptions.typeRoots
    }
    const program = ts.createProgram(config.fileNames, config.options)
    const diagnostics = ts.getPreEmitDiagnostics(program)
    if (diagnostics.length)
      throw new Error(
        ts.formatDiagnostics(diagnostics, {
          getCanonicalFileName: (file) => file,
          getCurrentDirectory: () => root,
          getNewLine: () => '\n',
        })
      )
    const result = program.emit()
    if (result.emitSkipped || result.diagnostics.length) throw new Error('TypeScript compilation failed')
  }

  const commonPackage = path.join(stage, 'node_modules/vscode-extension-common')
  compile(commonPackage, true)
  const commonManifest = JSON.parse(fs.readFileSync(path.join(commonPackage, 'package.json'), 'utf8'))
  commonManifest.types = './out/src/EditorFunctions.d.ts'
  writeManifest(commonPackage, commonManifest)
  packagedManifest.dependencies['vscode-extension-common'] = commonManifest.version
  writeManifest(stage, packagedManifest)
  compile(stage)

  npm(['run', 'test:all'], {
    env: {
      ...process.env,
      TRANSFORMER_TEST_DEPENDENCIES: tools,
      NODE_PATH: path.join(stage, 'node_modules'),
      REFACTOR_BASELINE: '',
    },
  })

  const vsce = toolRequire('@vscode/vsce')
  const files = await vsce.listFiles({ cwd: stage, packageManager: vsce.PackageManager.Npm })
  for (const required of [
    'out/extension.js',
    'out/EditorScope.js',
    'out/ScopedCommands.js',
    'out/TransformMenu.js',
    'out/TextEncoding.js',
    'out/DataFormats.js',
    'out/CryptoTools.js',
    'out/CurlConverter.js',
    'node_modules/vscode-extension-common/out/src/EditorFunctions.js',
  ]) {
    if (!files.includes(required)) throw new Error('Missing packaged file: ' + required)
  }
  const filename = `transformer-${manifest.version}.vsix`
  const artifact = path.join(releaseRoot, filename)
  await vsce.createVSIX({ cwd: stage, packagePath: artifact, dependencies: true, useYarn: false })

  const vsceRequire = createRequire(toolRequire.resolve('@vscode/vsce/package.json'))
  const zip = vsceRequire('yauzl')
  const entries = await new Promise((resolve, reject) => {
    zip.open(artifact, { lazyEntries: true }, (error, archive) => {
      if (error) return reject(error)
      const manifests = {}
      archive.on('error', reject)
      archive.on('end', () => resolve(manifests))
      archive.on('entry', (entry) => {
        if (!['extension/package.json', 'extension.vsixmanifest'].includes(entry.fileName)) return archive.readEntry()
        archive.openReadStream(entry, (error, stream) => {
          if (error) {
            archive.close()
            return reject(error)
          }
          const chunks = []
          stream.on('error', reject)
          stream.on('data', (chunk) => chunks.push(chunk))
          stream.on('end', () => {
            manifests[entry.fileName] = Buffer.concat(chunks).toString('utf8')
            archive.readEntry()
          })
        })
      })
      archive.readEntry()
    })
  })
  const packageJson = JSON.parse(entries['extension/package.json'])
  const runtimeRequire = createRequire(path.join(stage, 'package.json'))
  const xml = runtimeRequire('fast-xml-parser')
  const vsixManifest = new xml.XMLParser({ ignoreAttributes: false }).parse(entries['extension.vsixmanifest'])
  const identity = vsixManifest.PackageManifest.Metadata.Identity
  if (
    packageJson.publisher !== manifest.publisher ||
    packageJson.version !== manifest.version ||
    packageJson.name !== manifest.name ||
    identity['@_Publisher'] !== manifest.publisher ||
    identity['@_Version'] !== manifest.version
  )
    throw new Error('Packaged extension identity does not match the project manifest')

  fs.writeFileSync(
    path.join(releaseRoot, 'build.json'),
    JSON.stringify(
      {
        publisher: manifest.publisher,
        name: manifest.name,
        version: manifest.version,
        commonRepository,
        commonCommit,
        artifact,
        bytes: fs.statSync(artifact).size,
      },
      null,
      2
    ) + '\n'
  )
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `vsix-name=${filename}\n`)
  console.log(`Verified ${manifest.publisher}.${manifest.name} ${manifest.version}: ${artifact}`)
}

build().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
