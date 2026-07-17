// @vitest-environment node
// @ts-expect-error -- Vitest выполняет этот тест в Node.js; основной tsconfig намеренно не включает @types/node.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const auditedWorkflowNames = ['pr-checks.yml', 'auto-release.yml', 'release-dist.yml']
const pwaWorkflowNames = ['pr-checks.yml', 'auto-release.yml', 'deploy-pages.yml', 'release-dist.yml']
const readWorkflow = (name: string) => readFileSync(new URL(`../.github/workflows/${name}`, import.meta.url), 'utf8')
const readRepositoryDocument = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

describe('release workflows', () => {
  it.each(auditedWorkflowNames)('делает production audit блокирующим в %s', name => {
    const workflow = readWorkflow(name)

    expect(workflow).toContain('run: pnpm audit --prod')
    expect(workflow).not.toMatch(/continue-on-error:\s*true/)
  })

  it.each(pwaWorkflowNames)('проверяет готовый PWA-артефакт в %s', name => {
    expect(readWorkflow(name)).toContain('run: pnpm test:pwa')
  })

  it('тестирует GitHub Pages в реальном repository scope', () => {
    const autoRelease = readWorkflow('auto-release.yml')
    const deployPages = readWorkflow('deploy-pages.yml')

    expect(autoRelease).toContain('E2E_BASE_PATH: /${{ github.event.repository.name }}/')
    expect(deployPages).toContain('E2E_BASE_PATH: /${{ github.event.repository.name }}/')
  })

  it('проверяет семантику всех workflow до merge', () => {
    const pullRequestChecks = readWorkflow('pr-checks.yml')
    const packageJson = readRepositoryDocument('package.json')

    expect(pullRequestChecks).toContain('run: pnpm lint:workflows')
    expect(packageJson).toContain('"lint:workflows": "node scripts/lint-workflows.mjs"')
  })

  it('не дублирует unit-тесты и typecheck в PR workflow', () => {
    const pullRequestChecks = readWorkflow('pr-checks.yml')

    expect(pullRequestChecks).toContain('run: pnpm test:coverage')
    expect(pullRequestChecks).not.toMatch(/run: pnpm test\s*$/m)
    expect(pullRequestChecks).not.toContain('run: pnpm typecheck')
    expect(pullRequestChecks).toContain('run: pnpm build')
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
    expect(autoRelease).toMatch(/\n {2}deploy-pages:\n {4}needs:\n {6}- verify\n {6}- publish\n {4}permissions:\n {6}pages: write\n {6}id-token: write/)
  })

  it('собирает подписанный Android APK с read-only token и публикует отдельным job', () => {
    const androidRelease = readWorkflow('android-release.yml')
    const autoRelease = readWorkflow('auto-release.yml')

    expect(androidRelease).toContain('workflow_call:')
    expect(androidRelease).toContain('workflow_dispatch:')
    expect(androidRelease).toMatch(/\n {2}verify-and-build:\n {4}permissions:\n {6}contents: read/)
    expect(androidRelease).toMatch(/\n {2}publish:\n {4}needs: verify-and-build\n {4}permissions:\n {6}contents: write/)
    expect(androidRelease).toContain('ANDROID_KEYSTORE_BASE64: ${{ secrets.ANDROID_KEYSTORE_BASE64 }}')
    expect(androidRelease).toContain('./gradlew --no-daemon clean assembleRelease')
    expect(androidRelease).toContain('if: inputs.run_source_checks')
    expect(androidRelease.match(/ANDROID_KEYSTORE_PATH: \$\{\{ runner\.temp \}\}/g)).toHaveLength(2)
    expect(autoRelease).toMatch(/\n {2}android:\n {4}needs:\n {6}- verify\n {6}- publish/)
    expect(autoRelease).toContain('uses: ./.github/workflows/android-release.yml')
    expect(autoRelease).toContain('tag: ${{ needs.verify.outputs.tag }}')
    expect(autoRelease).toContain('run_source_checks: false')
    expect(autoRelease).toContain('secrets: inherit')
  })

  it('оставляет один автоматический release-маршрут и ручные recovery workflow', () => {
    const autoRelease = readWorkflow('auto-release.yml')
    const releaseDist = readWorkflow('release-dist.yml')
    const deployPages = readWorkflow('deploy-pages.yml')

    expect(autoRelease).toContain('uses: ./.github/workflows/android-release.yml')
    expect(autoRelease).toContain('uses: actions/upload-pages-artifact@')
    expect(autoRelease).toContain('uses: actions/deploy-pages@')
    expect(releaseDist).toContain('workflow_dispatch:')
    expect(releaseDist).not.toMatch(/\n {2}push:/)
    expect(deployPages).toContain('workflow_dispatch:')
    expect(deployPages).not.toContain('workflow_run:')
    expect(deployPages).not.toMatch(/\n {2}push:/)
  })

  it('не сохраняет checkout credentials там, где workflow не выполняет push', () => {
    const expected = new Map([
      ['pr-checks.yml', [1, 1]],
      ['auto-release.yml', [2, 1]],
      ['deploy-pages.yml', [1, 1]],
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
  })
})
