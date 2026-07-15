import { parseLoanBackup, parseLoanBackupObject, type ValidatedLoanData } from './importExport'
import { decodeSharedPayload } from './sharedPayloadCodec'
import { SHARED_CALCULATION_VERSION } from './protocolVersions'

export type PortableValidationInput =
  | { kind: 'json'; value: string }
  | { kind: 'share'; value: string }

export async function validatePortableInput(input: PortableValidationInput): Promise<ValidatedLoanData> {
  if (input.kind === 'json') return parseLoanBackup(input.value)
  const raw = await decodeSharedPayload(input.value)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Ссылка повреждена. Проверьте ссылку или используйте JSON-файл')
  const version = (raw as { version?: unknown }).version
  if (version !== undefined && version !== SHARED_CALCULATION_VERSION) throw new Error('Версия ссылки не поддерживается')
  return parseLoanBackupObject(raw)
}
