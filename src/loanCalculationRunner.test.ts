import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultConfig } from './loanDefaults'
import { LoanCalculationRunner, type LoanCalculationSnapshot } from './loanCalculationRunner'

class RuntimeFailingWorker {
  static instances: RuntimeFailingWorker[] = []

  messages: unknown[] = []
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  terminate = vi.fn()

  constructor() {
    RuntimeFailingWorker.instances.push(this)
  }

  postMessage(message: unknown) {
    this.messages.push(message)
  }
}

const snapshot = (revision: string): LoanCalculationSnapshot => ({
  revision,
  config: defaultConfig,
  repayments: [],
  repaymentRules: [],
  gracePeriods: [],
  selectedScenario: 'combined',
  displayDecimals: 2,
  loanId: 'runner-test'
})

beforeEach(() => {
  RuntimeFailingWorker.instances = []
  vi.useFakeTimers()
  vi.stubGlobal('Worker', RuntimeFailingWorker)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('LoanCalculationRunner', () => {
  it('switches to synchronous calculation after three Worker runtime errors', async () => {
    const runner = new LoanCalculationRunner()
    const onResult = vi.fn()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    for (let attempt = 0; attempt < 3; attempt += 1) {
      runner.calculate(snapshot(`r${attempt}`), onResult)
      expect(RuntimeFailingWorker.instances).toHaveLength(attempt + 1)

      RuntimeFailingWorker.instances[attempt].onerror?.(new Event('error'))
      await vi.runOnlyPendingTimersAsync()
      expect(onResult).toHaveBeenLastCalledWith(expect.objectContaining({
        revision: `r${attempt}`,
        result: expect.objectContaining({ errors: [] })
      }))
    }

    onResult.mockClear()
    runner.calculate(snapshot('r3'), onResult)

    expect(RuntimeFailingWorker.instances).toHaveLength(3)
    await vi.runOnlyPendingTimersAsync()
    expect(warn).toHaveBeenCalledWith('Loan calculation Worker failed 3 times; switching to synchronous calculation')
    expect(onResult).toHaveBeenCalledWith(expect.objectContaining({
      revision: 'r3',
      result: expect.objectContaining({ errors: [] })
    }))

    runner.dispose()
  })
})
