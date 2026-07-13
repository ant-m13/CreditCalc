import { afterEach, describe, expect, it, vi } from 'vitest'
import { defaultConfig } from './loanDefaults'
import { VALIDATED_LOAN_DATA_MARKER } from './importExport'
import { PortableDataValidationRunner, validatePortableJson, validatePortableShare } from './portableDataValidation'

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
  it('передаёт Worker исходный JSON-текст без parse в основном потоке', async () => {
    vi.stubGlobal('Worker', ControlledWorker)
    const text = JSON.stringify({ config: defaultConfig })
    const validation = validatePortableJson(text)
    const worker = ControlledWorker.instances[0]
    const request = worker.posted[0] as { requestId: number; input: { kind: string; value: string } }

    expect(request.input).toEqual({ kind: 'json', value: text })
    worker.onmessage?.({ data: { requestId: request.requestId, data: validatedData() } } as MessageEvent)
    await expect(validation).resolves.toMatchObject({ __validatedLoanData: VALIDATED_LOAN_DATA_MARKER })
  })

  it('передаёт Worker исходный payload shared-ссылки до распаковки', async () => {
    vi.stubGlobal('Worker', ControlledWorker)
    const payload = 'v1.original-compressed-payload'
    const validation = validatePortableShare(payload)
    const worker = ControlledWorker.instances[0]
    const request = worker.posted[0] as { requestId: number; input: { kind: string; value: string } }

    expect(request.input).toEqual({ kind: 'share', value: payload })
    worker.onmessage?.({ data: { requestId: request.requestId, data: validatedData() } } as MessageEvent)
    await expect(validation).resolves.toMatchObject({ __validatedLoanData: VALIDATED_LOAN_DATA_MARKER })
  })

  it('отменяет предыдущую Worker-задачу и принимает только последний результат', async () => {
    vi.stubGlobal('Worker', ControlledWorker)
    const runner = new PortableDataValidationRunner()
    const first = runner.validate({ kind: 'json', value: JSON.stringify({ config: defaultConfig }) }).then(() => null, error => error as Error)
    const firstWorker = ControlledWorker.instances[0]
    const second = runner.validate({ kind: 'json', value: JSON.stringify({ config: defaultConfig }) })
    const secondWorker = ControlledWorker.instances[1]

    expect(firstWorker.terminate).toHaveBeenCalledOnce()
    expect((await first)?.message).toContain('более новой задачей')

    const request = secondWorker.posted[0] as { requestId: number }
    const data = validatedData()
    secondWorker.onmessage?.({ data: { requestId: request.requestId, data } } as MessageEvent)

    await expect(second).resolves.toEqual(data)
    expect(secondWorker.terminate).toHaveBeenCalledOnce()
  })

  it('отменяет pending fallback, если конструктор Worker недоступен', async () => {
    vi.stubGlobal('Worker', class { constructor() { throw new Error('blocked') } })
    const runner = new PortableDataValidationRunner()
    const input = { kind: 'json' as const, value: JSON.stringify({ config: defaultConfig }) }
    const first = runner.validate(input).then(() => null, error => error as Error)
    const second = runner.validate(input)

    expect((await first)?.message).toContain('более новой задачей')
    await expect(second).resolves.toMatchObject({ __validatedLoanData: VALIDATED_LOAN_DATA_MARKER })
  })
})

const validatedData = () => ({
  __validatedLoanData: VALIDATED_LOAN_DATA_MARKER,
  config: defaultConfig,
  repayments: [],
  repaymentRules: [],
  gracePeriods: [],
  selectedScenario: 'combined',
  termUnit: 'months' as const,
  displayDecimals: 2 as const,
  theme: 'emerald' as const
})
