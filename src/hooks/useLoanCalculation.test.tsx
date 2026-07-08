// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultConfig } from '../loanDefaults'
import { buildLoanCalculation, type LoanCalculationResult } from '../loanCalculation'
import { useLoanCalculation, type LoanCalculationInput } from './useLoanCalculation'

interface WorkerRequest {
  revision: string
  snapshot: LoanCalculationInput
}

class DeferredWorker {
  static instances: DeferredWorker[] = []

  messages: WorkerRequest[] = []
  onmessage: ((event: MessageEvent<{ revision: string; result: LoanCalculationResult }>) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  terminate = vi.fn()

  constructor() {
    DeferredWorker.instances.push(this)
  }

  postMessage(message: WorkerRequest) {
    this.messages.push(message)
  }

  resolve(index = this.messages.length - 1) {
    const message = this.messages[index]
    if (!message) throw new Error('Worker request not found')
    this.onmessage?.(new MessageEvent('message', {
      data: {
        revision: message.revision,
        result: buildLoanCalculation(message.snapshot)
      }
    }))
  }
}

class ConstructorThrowingWorker {
  constructor() {
    throw new Error('Module worker is blocked')
  }
}

class PostMessageThrowingWorker extends DeferredWorker {
  postMessage() {
    throw new Error('postMessage is blocked')
  }
}

const loanInput = (patch: Partial<LoanCalculationInput> = {}): LoanCalculationInput => ({
  config: defaultConfig,
  repayments: [],
  repaymentRules: [],
  gracePeriods: [],
  selectedScenario: 'combined',
  displayDecimals: 2,
  loanId: 'loan-test',
  ...patch
})

type HookResult = ReturnType<typeof useLoanCalculation>
let latest: HookResult | null = null

function Probe(props: LoanCalculationInput) {
  latest = useLoanCalculation(props)
  return <div data-testid="snapshot-currency">{latest.calculationSnapshot.config.currency}</div>
}

const current = () => {
  if (!latest) throw new Error('Hook did not render')
  return latest
}

beforeEach(() => {
  latest = null
  DeferredWorker.instances = []
  vi.stubGlobal('Worker', DeferredWorker)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('useLoanCalculation', () => {
  it('keeps worker result and snapshot consistent while a new revision is pending', async () => {
    const initial = loanInput({ config: { ...defaultConfig, currency: 'RUB' } })
    const { rerender } = render(<Probe {...initial}/>)
    const worker = DeferredWorker.instances[0]

    await waitFor(() => expect(worker.messages).toHaveLength(1))
    await act(async () => worker.resolve(0))
    await waitFor(() => expect(current().isStale).toBe(false))
    expect(current().calculationSnapshot.config.currency).toBe('RUB')

    rerender(<Probe {...loanInput({ config: { ...defaultConfig, currency: 'USD' } })}/>)

    await waitFor(() => expect(worker.messages).toHaveLength(2))
    expect(current().isStale).toBe(true)
    expect(current().calculationSnapshot.config.currency).toBe('RUB')
    expect(screen.getByTestId('snapshot-currency').textContent).toBe('RUB')

    await act(async () => worker.resolve(1))
    await waitFor(() => expect(current().isStale).toBe(false))
    expect(current().calculationSnapshot.config.currency).toBe('USD')
  })

  it('falls back to sync calculation when module worker construction fails', async () => {
    vi.stubGlobal('Worker', ConstructorThrowingWorker)

    render(<Probe {...loanInput({ config: { ...defaultConfig, currency: 'USD' } })}/>)

    await waitFor(() => expect(current().isStale).toBe(false))
    expect(current().calculationSnapshot.config.currency).toBe('USD')
    expect(current().selected).not.toBeNull()
    expect(screen.getByTestId('snapshot-currency').textContent).toBe('USD')
  })

  it('falls back to sync calculation when worker postMessage fails', async () => {
    vi.stubGlobal('Worker', PostMessageThrowingWorker)

    render(<Probe {...loanInput({ config: { ...defaultConfig, currency: 'EUR' } })}/>)

    await waitFor(() => expect(current().isStale).toBe(false))
    expect(current().calculationSnapshot.config.currency).toBe('EUR')
    expect(current().selected).not.toBeNull()
    expect(PostMessageThrowingWorker.instances[0].terminate).toHaveBeenCalledTimes(1)
  })

  it('terminates and resets the worker after runtime errors', async () => {
    const { rerender } = render(<Probe {...loanInput({ config: { ...defaultConfig, currency: 'RUB' } })}/>)
    const failedWorker = DeferredWorker.instances[0]

    await waitFor(() => expect(failedWorker.messages).toHaveLength(1))
    await act(async () => failedWorker.onerror?.(new Event('error')))
    await waitFor(() => expect(current().isStale).toBe(false))
    expect(current().calculationSnapshot.config.currency).toBe('RUB')
    expect(failedWorker.terminate).toHaveBeenCalledTimes(1)

    rerender(<Probe {...loanInput({ config: { ...defaultConfig, currency: 'USD' } })}/>)

    await waitFor(() => expect(DeferredWorker.instances).toHaveLength(2))
    await waitFor(() => expect(DeferredWorker.instances[1].messages).toHaveLength(1))
    expect(DeferredWorker.instances[1]).not.toBe(failedWorker)
  })

  it('uses sync calculation after repeated worker runtime errors', async () => {
    const { rerender } = render(<Probe {...loanInput({ config: { ...defaultConfig, currency: 'RUB' } })}/>)

    await waitFor(() => expect(DeferredWorker.instances[0].messages).toHaveLength(1))
    await act(async () => DeferredWorker.instances[0].onerror?.(new Event('error')))
    rerender(<Probe {...loanInput({ config: { ...defaultConfig, currency: 'USD' } })}/>)

    await waitFor(() => expect(DeferredWorker.instances[1].messages).toHaveLength(1))
    await act(async () => DeferredWorker.instances[1].onerror?.(new Event('error')))
    rerender(<Probe {...loanInput({ config: { ...defaultConfig, currency: 'EUR' } })}/>)

    await waitFor(() => expect(DeferredWorker.instances[2].messages).toHaveLength(1))
    await act(async () => DeferredWorker.instances[2].onerror?.(new Event('error')))
    rerender(<Probe {...loanInput({ config: { ...defaultConfig, currency: 'CNY' } })}/>)

    await waitFor(() => expect(current().isStale).toBe(false))
    expect(DeferredWorker.instances).toHaveLength(3)
    expect(current().calculationSnapshot.config.currency).toBe('CNY')
    expect(current().selected).not.toBeNull()
  })
})
