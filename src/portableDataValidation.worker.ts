import { validatePortableInput, type PortableValidationInput } from './portableDataValidationCore'

interface PortableValidationRequest {
  requestId: number
  input: PortableValidationInput
}

self.onmessage = async (event: MessageEvent<PortableValidationRequest>) => {
  const { requestId, input } = event.data
  try {
    self.postMessage({ requestId, data: await validatePortableInput(input) })
  } catch (error) {
    self.postMessage({
      requestId,
      error: error instanceof Error ? error.message : 'Не удалось проверить импортируемый кредит'
    })
  }
}
