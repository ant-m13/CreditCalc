import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultConfig } from './loanDefaults'
import { GoalPlannerRunner, type GoalPlannerSnapshot, type GoalPlannerWorkerResponse } from './goalPlannerRunner'

class FakeWorker {
  static instances: FakeWorker[] = []

  messages: unknown[] = []
  onmessage: ((event: MessageEvent<GoalPlannerWorkerResponse>) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  terminate = vi.fn()

  constructor() {
    FakeWorker.instances.push(this)
  }

  postMessage(message: unknown) {
    this.messages.push(message)
  }
}

const snapshot = (revision: string): GoalPlannerSnapshot => ({
  revision,
  loanId: 'loan-1',
  config: defaultConfig,
  repayments: [],
  repaymentRules: [],
  gracePeriods: [],
  selectedScenario: 'combined',
  goal: { type: 'monthsEarlier', months: 12 },
  planStartDate: defaultConfig.firstPaymentDate,
  oneTimeDate: defaultConfig.issueDate,
  availableNow: 0
})

beforeEach(() => {
  FakeWorker.instances = []
  vi.stubGlobal('Worker', FakeWorker)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('GoalPlannerRunner', () => {
  it('завершает устаревший Worker до запуска новой ревизии', () => {
    const runner = new GoalPlannerRunner()
    const onResult = vi.fn()
    const onError = vi.fn()

    runner.calculate(snapshot('old'), onResult, onError)
    const oldWorker = FakeWorker.instances[0]
    runner.calculate(snapshot('new'), onResult, onError)

    expect(oldWorker.terminate).toHaveBeenCalledOnce()
    expect(oldWorker.onmessage).toBeNull()
    expect(FakeWorker.instances[1].messages).toEqual([expect.objectContaining({ kind: 'plan', snapshot: expect.objectContaining({ revision: 'new' }) })])
    runner.dispose()
  })

  it('принимает только ответ активного запроса и завершает Worker', () => {
    const runner = new GoalPlannerRunner()
    const onResult = vi.fn()
    const onError = vi.fn()
    const current = snapshot('current')

    runner.calculate(current, onResult, onError)
    const worker = FakeWorker.instances[0]
    const request = worker.messages[0] as { requestId: number }
    const response = { requestId: request.requestId, kind: 'plan', revision: 'current', result: { status: 'planned', current: {}, variants: [] } } as unknown as GoalPlannerWorkerResponse
    worker.onmessage?.(new MessageEvent('message', { data: response }))

    expect(onResult).toHaveBeenCalledWith(expect.objectContaining({ revision: 'current', snapshot: current }))
    expect(onError).not.toHaveBeenCalled()
    expect(worker.terminate).toHaveBeenCalledOnce()
  })

  it('не выполняет тяжёлый синхронный fallback без Worker', () => {
    vi.unstubAllGlobals()
    const runner = new GoalPlannerRunner()
    const onResult = vi.fn()
    const onError = vi.fn()

    runner.calculate(snapshot('unsupported'), onResult, onError)

    expect(onResult).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('Web Worker'))
  })

  it('отправляет отдельный запрос предпросмотра', () => {
    const runner = new GoalPlannerRunner()
    runner.preview(snapshot('preview'), { repayments: [], repaymentRules: [] }, vi.fn(), vi.fn())

    expect(FakeWorker.instances[0].messages).toEqual([expect.objectContaining({ kind: 'preview', operations: { repayments: [], repaymentRules: [] } })])
    runner.dispose()
  })
})
