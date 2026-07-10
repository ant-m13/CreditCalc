import { parseLoanBackupObject, type LoanBackupData } from './importExport'

export const MAX_PORTABLE_JSON_BYTES = 2 * 1024 * 1024

type PortableValidationRequest = { requestId: number; raw: unknown }
type PortableValidationResponse = { requestId: number; data?: LoanBackupData; error?: string }

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

export const parsePortableJsonEnvelope = (text: string) => {
  if (new TextEncoder().encode(text).byteLength > MAX_PORTABLE_JSON_BYTES) {
    throw new Error('JSON-файл слишком большой. Максимальный размер — 2 МБ')
  }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('Файл не является корректным JSON')
  }
  if (!isObject(raw) || !isObject(raw.config)) throw new Error('В файле отсутствуют параметры кредита')
  return raw
}

export class PortableDataValidationRunner {
  private worker: Worker | null = null
  private rejectPending: ((reason: Error) => void) | null = null
  private requestId = 0

  validate(raw: unknown): Promise<LoanBackupData> {
    this.disposePending()
    const requestId = ++this.requestId
    if (typeof Worker === 'undefined') {
      return new Promise((resolve, reject) => {
        setTimeout(() => {
          if (requestId !== this.requestId) return reject(new Error('Проверка импорта заменена более новой задачей'))
          try { resolve(parseLoanBackupObject(raw)) } catch (error) { reject(error) }
        }, 0)
      })
    }

    return new Promise((resolve, reject) => {
      let worker: Worker
      try {
        worker = new Worker(new URL('./portableDataValidation.worker.ts', import.meta.url), { type: 'module' })
      } catch {
        setTimeout(() => {
          try { resolve(parseLoanBackupObject(raw)) } catch (fallbackError) { reject(fallbackError) }
        }, 0)
        return
      }
      this.worker = worker
      this.rejectPending = reject
      worker.onmessage = (event: MessageEvent<PortableValidationResponse>) => {
        if (event.data.requestId !== requestId || requestId !== this.requestId) return
        this.finishWorker(worker)
        if (event.data.data) resolve(event.data.data)
        else reject(new Error(event.data.error ?? 'Не удалось проверить импортируемый кредит'))
      }
      worker.onerror = () => {
        if (requestId !== this.requestId) return
        this.finishWorker(worker)
        reject(new Error('Не удалось проверить импортируемый кредит в фоновом потоке'))
      }
      worker.postMessage({ requestId, raw } satisfies PortableValidationRequest)
    })
  }

  private finishWorker(worker: Worker) {
    worker.terminate()
    if (this.worker === worker) this.worker = null
    this.rejectPending = null
  }

  private disposePending() {
    if (!this.worker && !this.rejectPending) return
    this.worker?.terminate()
    this.worker = null
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
  portableDataValidationRunner.validate(parsePortableJsonEnvelope(text))
