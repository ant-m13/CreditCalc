import { readdir, readFile } from 'node:fs/promises'
import { createLinter } from 'actionlint'

const workflowDirectory = new URL('../.github/workflows/', import.meta.url)
const workflowNames = (await readdir(workflowDirectory))
  .filter(name => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort()
let errorCount = 0

for (const name of workflowNames) {
  const path = `.github/workflows/${name}`
  const source = await readFile(new URL(name, workflowDirectory), 'utf8')
  // The WASM wrapper keeps parser state between calls, so each file needs
  // a fresh linter instance to avoid a runtime trap on the next workflow.
  const lint = await createLinter()
  const results = lint(source, path)
  for (const result of results) {
    errorCount += 1
    console.error(`${result.file}:${result.line}:${result.column}: ${result.message} [${result.kind}]`)
  }
}

if (errorCount > 0) process.exit(1)
console.log(`GitHub Actions workflows verified: ${workflowNames.length}`)
