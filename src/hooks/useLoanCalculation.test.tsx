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
})
