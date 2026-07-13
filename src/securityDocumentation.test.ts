// @vitest-environment node
// @ts-expect-error -- Vitest выполняет этот тест в Node.js; production tsconfig намеренно не включает @types/node.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const policy = readFileSync(new URL('../SECURITY.md', import.meta.url), 'utf8')

describe('security documentation', () => {
  it('описывает shared-origin риск и выделенный custom domain', () => {
    expect(policy).toContain('https://ant-m13.github.io/CreditCalc/')
    expect(policy).toContain('isolated by origin (scheme, host and port), not by URL path')
    expect(policy).toContain('dedicated custom domain/origin')
  })

  it('не обещает anti-framing защиту через meta CSP', () => {
    expect(policy).toContain('meta CSP cannot enforce the `frame-ancestors`')
    expect(policy).toContain('X-Frame-Options: DENY')
    expect(policy).toContain('clickjacking remains a documented residual risk')
  })

  it('перечисляет storage keys и последствия очистки origin', () => {
    expect(policy).toContain('`ipoteka-calculator-v1`')
    expect(policy).toContain('`credit-calculator-onboarding-done`')
    expect(policy).toContain('`credit-calculator-seen-version`')
    expect(policy).toContain('may also remove data belonging to other projects')
  })

  it('не представляет PWA-кеш или persistent storage как backup', () => {
    expect(policy).toContain('user-provided financial values are not written to Cache Storage')
    expect(policy).toContain('it is not a backup')
    expect(policy).toContain('does not encrypt, duplicate or synchronize loan data')
  })
})
