// @vitest-environment node
// @ts-expect-error -- Vitest выполняет этот тест в Node.js; production tsconfig намеренно не включает @types/node.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const workflowNames = ['pr-checks.yml', 'auto-release.yml', 'deploy-pages.yml', 'release-dist.yml']
const readWorkflow = (name: string) => readFileSync(new URL(`../.github/workflows/${name}`, import.meta.url), 'utf8')
const readRepositoryDocument = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

describe('release workflows', () => {
  it.each(workflowNames)('делает production audit блокирующим в %s', name => {
    const workflow = readWorkflow(name)

    expect(workflow).toContain('run: pnpm audit --prod')
    expect(workflow).not.toMatch(/continue-on-error:\s*true/)
  })

  it('не называет блокирующий audit non-blocking в release-документации', () => {
    const releaseDocumentation = `${readRepositoryDocument('README.md')}\n${readRepositoryDocument('docs/RELEASES.md')}`

    expect(releaseDocumentation).not.toContain('non-blocking audit')
    expect(releaseDocumentation).toContain('блокирующий audit production-зависимостей')
  })

  it('документирует реальную политику неизвестных валют', () => {
    const readme = readRepositoryDocument('README.md')

    expect(readme).toContain('legacy-код `RUR` мигрирует в `RUB`')
    expect(readme).toContain('другие явно неизвестные валюты отклоняются')
  })

  it('отделяет read-only проверку от публикации с повышенными правами', () => {
    const autoRelease = readWorkflow('auto-release.yml')
    const releaseDist = readWorkflow('release-dist.yml')
    const deployPages = readWorkflow('deploy-pages.yml')

    expect(autoRelease).toMatch(/\n {2}verify:\n {4}permissions:\n {6}contents: read/)
    expect(autoRelease).toMatch(/\n {2}publish:\n {4}needs: verify\n {4}permissions:\n {6}contents: write/)
    expect(releaseDist).toMatch(/\n {2}verify:\n {4}permissions:\n {6}contents: read/)
    expect(releaseDist).toMatch(/\n {2}publish:\n {4}needs: verify\n {4}permissions:\n {6}contents: write/)
    expect(deployPages).toMatch(/\n {2}build:\n {4}permissions:\n {6}contents: read/)
    expect(deployPages).toMatch(/\n {2}deploy:\n {4}needs: build\n {4}permissions:\n {6}pages: write\n {6}id-token: write/)
  })

  it('не сохраняет checkout credentials там, где workflow не выполняет push', () => {
    const expected = new Map([
      ['pr-checks.yml', [1, 1]],
      ['auto-release.yml', [2, 1]],
      ['deploy-pages.yml', [2, 2]],
      ['release-dist.yml', [1, 1]]
    ])

    for (const [name, [checkoutCount, disabledCredentialCount]] of expected) {
      const workflow = readWorkflow(name)
      expect(workflow.match(/uses: actions\/checkout@/g)).toHaveLength(checkoutCount)
      expect(workflow.match(/persist-credentials: false/g)).toHaveLength(disabledCredentialCount)
    }
  })

  it('отклоняет существующие version tags на неожиданной ревизии', () => {
    const autoRelease = readWorkflow('auto-release.yml')
    const releaseDist = readWorkflow('release-dist.yml')
    const deployPages = readWorkflow('deploy-pages.yml')

    expect(autoRelease).toContain('if [[ "$TAG_SHA" != "$GITHUB_SHA" ]]')
    expect(autoRelease).not.toContain('Checkout existing tag for repair runs')
    expect(releaseDist).toContain('if [[ "$RELEASE_TAG" != "$EXPECTED_TAG" ]]')
    expect(releaseDist).toContain('if [[ "$TAG_SHA" != "$HEAD_SHA" ]]')
    expect(deployPages).toContain('if [[ "$TAG_SHA" != "$HEAD_SHA" ]]')
    expect(deployPages).toContain('if [[ -n "$EXPECTED_SHA" && "$HEAD_SHA" != "$EXPECTED_SHA" ]]')
  })
})
