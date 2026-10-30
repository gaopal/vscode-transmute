# Refactor regression checks

Run `npm run test:tools` for the encoding, encryption, data format and command workflow checks. These use the real parsers, serializers, hash algorithms and AES implementation. They cover all 30 data format pairs on representable configurations and verify rejection of lossy structures. The editor itself is substituted in command tests; the suite does not launch a VS Code extension host

Run `npm run test:features` for spacing and curl conversion checks, or `npm run test:all` for both feature and regression suites. These commands require the project's TypeScript and Postman dependencies. The feature suite uses the real importer and generators for every available target, with controlled editor substitutes for command workflows

For an isolated dependency installation, set `TRANSFORMER_TEST_DEPENDENCIES` to the absolute folder containing that installation's `package.json` and `node_modules`. The test helper reads dependencies from that folder without changing production module resolution

Run `npm run test:refactor` with Node.js 24 or newer. This suite uses Node's experimental TypeScript transformation and VM modules without installing project dependencies. It checks behavior but does not perform TypeScript type checking

The suite exercises production modules with controlled VS Code and shared-library substitutes. CSV tests supply parsed fields and verify parser options, formatting, padding and delimiter handling. They do not validate the external `split-string` parser. Full extension integration requires the dependencies declared in `package.json`, including the sibling `vscode-extension-common` project

To compare against the current Git HEAD in PowerShell, run the following before committing changes

```powershell
New-Item -ItemType Directory -Force out/refactor-baseline/src | Out-Null
git show HEAD:src/Transforms.ts | Set-Content out/refactor-baseline/src/Transforms.ts -Encoding utf8
$env:REFACTOR_BASELINE = (Resolve-Path out/refactor-baseline).Path
npm run test:refactor
Remove-Item Env:REFACTOR_BASELINE
```

The optional benchmark checks that outputs match, warms up both versions, then records the median of five alternating runs in `out/refactor-benchmark.json`. It measures production transformation code with editor and parser substitutes, so its timings describe these workloads rather than end-to-end VS Code latency. There is no timing threshold because local execution conditions vary
