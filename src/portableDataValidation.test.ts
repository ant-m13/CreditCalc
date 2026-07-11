import { afterEach, describe, expect, it, vi } from 'vitest'
import { defaultConfig } from './loanDefaults'
import { parsePortableJsonEnvelope, PortableDataValidationRunner } from './portableDataValidation'

class ControlledWorker {
  static instances: ControlledWorker[] = []
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  terminate = vi.fn()
  posted: unknown[] = []

  constructor() { ControlledWorker.instances.push(this) }
  postMessage(message: unknown) { this.posted.push(message) }
}

afterEach(() => {
  ControlledWorker.instances = []
  vi.unstubAllGlobals()
})

describe('portable data validation', () => {
  it('оставляет в основном потоке только дешёвую проверку JSON-контейнера', () => {
    const raw = parsePortableJsonEnvelope(JSON.stringify({ config: defaultConfig }))
    expect(raw).toMatchObject({ config: { principal: defaultConfig.principal } })
    expect(() => parsePortableJsonEnvelope('{')).toThrow('корректным JSON')
    expect(() => parsePortableJsonEnvelope(JSON.stringify({ config: null }))).toThrow('параметры кредита')
  })

  it('отменяет предыдущую Worker-задачу и принимает только последний результат', async () => {
    vi.stubGlobal('Worker', ControlledWorker)
    const runner = new PortableDataValidationRunner()
    const first = runner.validate({ config: defaultConfig }).then(() => null, error => error as Error)
    const firstWorker = ControlledWorker.instances[0]
    const second = runner.validate({ config: defaultConfig })
    const secondWorker = ControlledWorker.instances[1]

    expect(firstWorker.terminate).toHaveBeenCalledOnce()
    expect((await first)?.message).toContain('более новой задачей')

    const request = secondWorker.posted[0] as { requestId: number }
    const data = { config: defaultConfig, repayments: [], repaymentRules: [], gracePeriods: [], selectedScenario: 'combined', termUnit: 'months', displayDecimals: 2, theme: 'emerald' }
    secondWorker.onmessage?.({ data: { requestId: request.requestId, data } } as MessageEvent)

    await expect(second).resolves.toEqual(data)
    expect(secondWorker.terminate).toHaveBeenCalledOnce()
  })
})
