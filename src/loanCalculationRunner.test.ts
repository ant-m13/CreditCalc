import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { calculateLoanSynchronously, LoanCalculationRunner, type LoanCalculationSnapshot } from './loanCalculationRunner'
import { shortTestConfig } from './testFixtures'

const ciEnvironment = (globalThis as typeof globalThis & {
  process?: { env?: { CI?: string } }
}).process?.env?.CI
const isCi = ciEnvironment === 'true' || ciEnvironment === '1'
const itInCi = isCi ? it : it.skip
const REAL_WATCHDOG_TEST_TIMEOUT_MS = 20_000

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
  config: shortTestConfig,
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
  it('terminates stale work before posting the latest revision', () => {
    const runner = new LoanCalculationRunner()
    const onResult = vi.fn()

    runner.calculate(snapshot('stale'), onResult)
    const staleWorker = RuntimeFailingWorker.instances[0]
    runner.calculate(snapshot('latest'), onResult)

    expect(staleWorker.terminate).toHaveBeenCalledOnce()
    expect(staleWorker.onmessage).toBeNull()
    expect(RuntimeFailingWorker.instances[1].messages).toEqual([
      expect.objectContaining({ revision: 'latest' })
    ])
    runner.dispose()
  })

  it('accepts one structurally valid response for the active request and terminates the Worker', () => {
    const runner = new LoanCalculationRunner()
    const onResult = vi.fn()
    const current = snapshot('current')

    runner.calculate(current, onResult)
    const worker = RuntimeFailingWorker.instances[0]
    const request = worker.messages[0] as { requestId: number }
    worker.onmessage?.(new MessageEvent('message', { data: {
      requestId: request.requestId,
      kind: 'result',
      revision: current.revision,
      result: calculateLoanSynchronously(current).result
    } }))

    expect(onResult).toHaveBeenCalledOnce()
    expect(onResult).toHaveBeenCalledWith(expect.objectContaining({ revision: current.revision }))
    expect(worker.terminate).toHaveBeenCalledOnce()
    expect(worker.onmessage).toBeNull()
    expect(worker.onerror).toBeNull()
    runner.dispose()
  })

  it.each([
    { label: 'malformed', response: null },
    { label: 'foreign revision', response: { requestId: 1, kind: 'result', revision: 'foreign', result: {} } },
    { label: 'foreign request', response: { requestId: 999, kind: 'result', revision: 'protocol', result: {} } },
    { label: 'Worker error', response: { requestId: 1, kind: 'error', revision: 'protocol', error: 'Unknown kind' } },
    { label: 'invalid result', response: { requestId: 1, kind: 'result', revision: 'protocol', result: {} } }
  ])('falls back exactly once after a $label Worker response', async ({ response }) => {
    const runner = new LoanCalculationRunner()
    const onResult = vi.fn()
    const current = snapshot('protocol')

    runner.calculate(current, onResult)
    const worker = RuntimeFailingWorker.instances[0]
    const request = worker.messages[0] as { requestId: number }
    const data = response && typeof response === 'object' && 'requestId' in response && response.requestId === 1
      ? { ...response, requestId: request.requestId }
      : response
    worker.onmessage?.(new MessageEvent('message', { data }))
    await vi.runOnlyPendingTimersAsync()

    expect(onResult).toHaveBeenCalledOnce()
    expect(onResult).toHaveBeenCalledWith(expect.objectContaining({
      revision: current.revision,
      result: expect.objectContaining({ errors: [] })
    }))
    expect(worker.terminate).toHaveBeenCalledOnce()
    runner.dispose()
  })

  it('falls back when the Worker does not answer before the watchdog expires', async () => {
    const runner = new LoanCalculationRunner()
    const onResult = vi.fn()

    runner.calculate(snapshot('timeout'), onResult)
    const worker = RuntimeFailingWorker.instances[0]
    await vi.runAllTimersAsync()

    expect(onResult).toHaveBeenCalledOnce()
    expect(onResult).toHaveBeenCalledWith(expect.objectContaining({ revision: 'timeout' }))
    expect(worker.terminate).toHaveBeenCalledOnce()
    runner.dispose()
  })

  itInCi('falls back after the real watchdog timeout in CI', { timeout: REAL_WATCHDOG_TEST_TIMEOUT_MS }, async () => {
    vi.useRealTimers()
    const runner = new LoanCalculationRunner()
    const current = snapshot('real-timeout')

    try {
      const envelope = await new Promise<ReturnType<typeof calculateLoanSynchronously>>(resolve => {
        runner.calculate(current, resolve)
      })

      expect(envelope.revision).toBe(current.revision)
      expect(RuntimeFailingWorker.instances[0].terminate).toHaveBeenCalledOnce()
    } finally {
      runner.dispose()
    }
  })

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
