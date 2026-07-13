import type { ValidatedLoanData } from './importExport'
import { assertPortableJsonSize } from './portabilityLimits'
import { assertSharedPayloadEnvelope } from './sharedPayloadCodec'
import { validatePortableInput, type PortableValidationInput } from './portableDataValidationCore'

export { MAX_PORTABLE_JSON_BYTES } from './portabilityLimits'

type PortableValidationRequest = { requestId: number; input: PortableValidationInput }
type PortableValidationResponse = { requestId: number; data?: ValidatedLoanData; error?: string }

export class PortableDataValidationRunner {
  private worker: Worker | null = null
  private rejectPending: ((reason: Error) => void) | null = null
  private fallbackTimer: ReturnType<typeof setTimeout> | null = null
  private requestId = 0

  validate(input: PortableValidationInput): Promise<ValidatedLoanData> {
    this.disposePending()
    const requestId = ++this.requestId
    return new Promise((resolve, reject) => {
      this.rejectPending = reject
      const scheduleFallback = () => {
        this.fallbackTimer = setTimeout(() => {
          this.fallbackTimer = null
          void validatePortableInput(input).then(data => {
            if (requestId !== this.requestId) return
            this.rejectPending = null
            resolve(data)
          }, error => {
            if (requestId !== this.requestId) return
            this.rejectPending = null
            reject(error)
          })
        }, 0)
      }
      if (typeof Worker === 'undefined') {
        scheduleFallback()
        return
      }
      let worker: Worker
      try {
        worker = new Worker(new URL('./portableDataValidation.worker.ts', import.meta.url), { type: 'module' })
      } catch {
        scheduleFallback()
        return
      }
      this.worker = worker
      worker.onmessage = (event: MessageEvent<PortableValidationResponse>) => {
        if (event.data.requestId !== requestId || requestId !== this.requestId) return
        this.finishWorker(worker)
        if (event.data.data) resolve(event.data.data)
        else reject(new Error(event.data.error ?? 'Не удалось проверить импортируемый кредит'))
      }
      worker.onerror = () => {
        if (requestId !== this.requestId) return
        this.finishWorker(worker)
        this.rejectPending = reject
        scheduleFallback()
      }
      try {
        worker.postMessage({ requestId, input } satisfies PortableValidationRequest)
      } catch {
        this.finishWorker(worker)
        this.rejectPending = reject
        scheduleFallback()
      }
    })
  }

  private finishWorker(worker: Worker) {
    worker.terminate()
    if (this.worker === worker) this.worker = null
    this.rejectPending = null
  }

  private disposePending() {
    if (!this.worker && !this.rejectPending && this.fallbackTimer === null) return
    this.worker?.terminate()
    this.worker = null
    if (this.fallbackTimer !== null) clearTimeout(this.fallbackTimer)
    this.fallbackTimer = null
    this.rejectPending?.(new Error('Проверка импорта заменена более новой задачей'))
    this.rejectPending = null
  }

  dispose() {
    this.requestId += 1
    this.disposePending()
  }
}

const portableDataValidationRunner = new PortableDataValidationRunner()

export const validatePortableJson = (text: string) =>
  (assertPortableJsonSize(text), portableDataValidationRunner.validate({ kind: 'json', value: text }))

export const validatePortableShare = (payload: string) =>
  (assertSharedPayloadEnvelope(payload), portableDataValidationRunner.validate({ kind: 'share', value: payload }))
