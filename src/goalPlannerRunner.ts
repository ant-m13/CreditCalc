import {
  buildGoalPlanPreview,
  buildGoalPlans,
  type GoalPlannerInput,
  type GoalPlannerResult,
  type GoalPlanOperations,
  type GoalPlanPreview
} from './goalPlanner'

export interface GoalPlannerSnapshot extends GoalPlannerInput {
  revision: string
  loanId?: string
}

export type GoalPlannerEnvelope = {
  revision: string
  snapshot: GoalPlannerSnapshot
  result: GoalPlannerResult
}

export type GoalPlanPreviewEnvelope = {
  revision: string
  snapshot: GoalPlannerSnapshot
  result: GoalPlanPreview
}

type PlanRequest = {
  requestId: number
  kind: 'plan'
  snapshot: GoalPlannerSnapshot
}

type PreviewRequest = {
  requestId: number
  kind: 'preview'
  snapshot: GoalPlannerSnapshot
  operations: GoalPlanOperations
}

export type GoalPlannerWorkerRequest = PlanRequest | PreviewRequest
type GoalPlannerWorkerRequestWithoutId = Omit<PlanRequest, 'requestId'> | Omit<PreviewRequest, 'requestId'>

export type GoalPlannerWorkerResponse =
  | { requestId: number; kind: 'plan'; revision: string; result: GoalPlannerResult }
  | { requestId: number; kind: 'preview'; revision: string; result: GoalPlanPreview }
  | { requestId: number; kind: 'error'; revision: string; error: string }

export const canUseGoalPlannerWorker = () => typeof Worker !== 'undefined'

const isWorkerResponseEnvelope = (value: unknown): value is GoalPlannerWorkerResponse => {
  if (!value || typeof value !== 'object') return false
  const response = value as Record<string, unknown>
  if (!Number.isSafeInteger(response.requestId) || typeof response.revision !== 'string') return false
  if (response.kind === 'error') return typeof response.error === 'string'
  return (response.kind === 'plan' || response.kind === 'preview') && Object.hasOwn(response, 'result')
}

export class GoalPlannerRunner {
  private worker: Worker | null = null
  private activeRequestId: number | null = null
  private requestId = 0

  private cancelWorker() {
    this.activeRequestId = null
    if (!this.worker) return
    this.worker.onmessage = null
    this.worker.onerror = null
    this.worker.terminate()
    this.worker = null
  }

  private run<T>(
    request: GoalPlannerWorkerRequestWithoutId,
    expectedKind: 'plan' | 'preview',
    onResult: (result: T) => void,
    onError: (message: string) => void
  ) {
    // Занятый Worker заменяется, чтобы новый запрос не ждал в очереди за устаревшим тяжёлым расчётом.
    if (this.activeRequestId !== null) this.cancelWorker()
    if (!canUseGoalPlannerWorker()) {
      onError('Планировщик недоступен: браузер не поддерживает Web Worker')
      return
    }

    const requestId = ++this.requestId
    let worker = this.worker
    if (!worker) {
      try {
        worker = new Worker(new URL('./goalPlanner.worker.ts', import.meta.url), { type: 'module' })
        this.worker = worker
      } catch {
        onError('Не удалось запустить Worker планировщика')
        return
      }
    }
    this.activeRequestId = requestId

    let settled = false
    const settle = (keepWorker: boolean) => {
      if (settled || this.worker !== worker || this.activeRequestId !== requestId) return false
      settled = true
      worker.onmessage = null
      worker.onerror = null
      this.activeRequestId = null
      if (!keepWorker) {
        worker.terminate()
        this.worker = null
      }
      return true
    }
    const fail = (message: string, keepWorker = false) => {
      if (settle(keepWorker)) onError(message)
    }

    worker.onmessage = (event: MessageEvent<unknown>) => {
      const response = event.data
      if (!isWorkerResponseEnvelope(response)) {
        fail('Worker планировщика вернул повреждённый ответ')
        return
      }
      if (response.requestId !== requestId || response.revision !== request.snapshot.revision) {
        fail('Worker планировщика вернул ответ для другого запроса')
        return
      }
      if (response.kind === 'error') {
        fail(response.error || 'Worker планировщика не смог выполнить расчёт', true)
        return
      }
      if (response.kind !== expectedKind) {
        fail('Worker планировщика вернул неожиданный ответ')
        return
      }
      if (settle(true)) onResult(response.result as T)
    }
    worker.onerror = event => {
      event.preventDefault()
      fail('Worker планировщика завершился с ошибкой')
    }

    try {
      worker.postMessage({ ...request, requestId } as GoalPlannerWorkerRequest)
    } catch {
      fail('Не удалось передать данные в Worker планировщика')
    }
  }

  calculate(snapshot: GoalPlannerSnapshot, onResult: (envelope: GoalPlannerEnvelope) => void, onError: (message: string) => void) {
    this.run<GoalPlannerResult>(
      { kind: 'plan', snapshot },
      'plan',
      result => onResult({ revision: snapshot.revision, snapshot, result }),
      onError
    )
  }

  preview(snapshot: GoalPlannerSnapshot, operations: GoalPlanOperations, onResult: (envelope: GoalPlanPreviewEnvelope) => void, onError: (message: string) => void) {
    this.run<GoalPlanPreview>(
      { kind: 'preview', snapshot, operations },
      'preview',
      result => onResult({ revision: snapshot.revision, snapshot, result }),
      onError
    )
  }

  cancel() {
    this.cancelWorker()
  }

  dispose() {
    this.cancelWorker()
  }
}

export const calculateGoalPlansSynchronously = (snapshot: GoalPlannerSnapshot) => buildGoalPlans(snapshot)
export const previewGoalPlanSynchronously = (snapshot: GoalPlannerSnapshot, operations: GoalPlanOperations) => buildGoalPlanPreview(snapshot, operations)
