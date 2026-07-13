import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultConfig } from './loanDefaults'
import { GoalPlannerRunner, type GoalPlannerSnapshot, type GoalPlannerWorkerResponse } from './goalPlannerRunner'

class FakeWorker {
  static instances: FakeWorker[] = []
  static throwOnConstruction = false
  static throwOnPost = false

  messages: unknown[] = []
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  terminate = vi.fn()

  constructor() {
    if (FakeWorker.throwOnConstruction) throw new Error('construction failed')
    FakeWorker.instances.push(this)
  }

  postMessage(message: unknown) {
    if (FakeWorker.throwOnPost) throw new Error('post failed')
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
  FakeWorker.throwOnConstruction = false
  FakeWorker.throwOnPost = false
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
    expect(worker.onmessage).toBeNull()
    expect(worker.onerror).toBeNull()
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

  it('завершает Worker и возвращает расчётную ошибку', () => {
    const runner = new GoalPlannerRunner()
    const onError = vi.fn()
    runner.calculate(snapshot('error'), vi.fn(), onError)
    const worker = FakeWorker.instances[0]
    const request = worker.messages[0] as { requestId: number }

    worker.onmessage?.(new MessageEvent('message', { data: { requestId: request.requestId, kind: 'error', revision: 'error', error: 'Некорректная цель' } }))

    expect(onError).toHaveBeenCalledOnce()
    expect(onError).toHaveBeenCalledWith('Некорректная цель')
    expect(worker.terminate).toHaveBeenCalledOnce()
  })

  it.each([
    { label: 'повреждённый', response: null, message: 'повреждённый ответ' },
    { label: 'чужой', response: { requestId: 999, kind: 'plan', revision: 'protocol', result: {} }, message: 'другого запроса' },
    { label: 'неожиданный', response: { requestId: 1, kind: 'preview', revision: 'protocol', result: {} }, message: 'неожиданный ответ' }
  ])('не оставляет интерфейс в ожидании при ответе $label', ({ response, message }) => {
    const runner = new GoalPlannerRunner()
    const onResult = vi.fn()
    const onError = vi.fn()
    runner.calculate(snapshot('protocol'), onResult, onError)
    const worker = FakeWorker.instances[0]
    const request = worker.messages[0] as { requestId: number }
    const data = response && typeof response === 'object' && 'requestId' in response && response.requestId === 1
      ? { ...response, requestId: request.requestId }
      : response

    worker.onmessage?.(new MessageEvent('message', { data }))

    expect(onResult).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledWith(expect.stringContaining(message))
    expect(worker.terminate).toHaveBeenCalledOnce()
  })

  it('обрабатывает ошибку выполнения Worker только один раз', () => {
    const runner = new GoalPlannerRunner()
    const onError = vi.fn()
    runner.calculate(snapshot('runtime'), vi.fn(), onError)
    const worker = FakeWorker.instances[0]
    const handler = worker.onerror!
    const event = new Event('error', { cancelable: true })

    handler(event)
    handler(event)

    expect(event.defaultPrevented).toBe(true)
    expect(onError).toHaveBeenCalledOnce()
    expect(worker.terminate).toHaveBeenCalledOnce()
  })

  it('сообщает об ошибках создания Worker и передачи запроса', () => {
    const runner = new GoalPlannerRunner()
    const onError = vi.fn()
    FakeWorker.throwOnConstruction = true
    runner.calculate(snapshot('constructor'), vi.fn(), onError)
    expect(onError).toHaveBeenLastCalledWith(expect.stringContaining('запустить Worker'))

    FakeWorker.throwOnConstruction = false
    FakeWorker.throwOnPost = true
    runner.calculate(snapshot('post'), vi.fn(), onError)
    expect(onError).toHaveBeenLastCalledWith(expect.stringContaining('передать данные'))
    expect(FakeWorker.instances[0].terminate).toHaveBeenCalledOnce()
  })
})
