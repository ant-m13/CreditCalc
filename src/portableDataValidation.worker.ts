import { parseLoanBackupObject } from './importExport'

interface PortableValidationRequest {
  requestId: number
  raw: unknown
}

self.onmessage = (event: MessageEvent<PortableValidationRequest>) => {
  const { requestId, raw } = event.data
  try {
    self.postMessage({ requestId, data: parseLoanBackupObject(raw) })
  } catch (error) {
    self.postMessage({
      requestId,
      error: error instanceof Error ? error.message : 'Не удалось проверить импортируемый кредит'
    })
  }
}
