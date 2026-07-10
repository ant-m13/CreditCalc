// @vitest-environment node
// @ts-expect-error -- Vitest выполняет этот тест в Node.js; production tsconfig намеренно не включает @types/node.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const workflowNames = ['pr-checks.yml', 'auto-release.yml', 'deploy-pages.yml', 'release-dist.yml']
const readWorkflow = (name: string) => readFileSync(new URL(`../.github/workflows/${name}`, import.meta.url), 'utf8')

describe('release workflows', () => {
  it.each(workflowNames)('делает production audit блокирующим в %s', name => {
    const workflow = readWorkflow(name)

    expect(workflow).toContain('run: pnpm audit --prod')
    expect(workflow).not.toMatch(/continue-on-error:\s*true/)
  })
})
