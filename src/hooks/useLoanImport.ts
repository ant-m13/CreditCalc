import { useCallback, useState } from 'react'
import type { LoanBackupData } from '../importExport'

export type ImportStatus = { kind: 'success' | 'error'; text: string }

interface UseLoanImportOptions {
  addLoanFromData: (data: LoanBackupData) => void
  replaceData: (data: LoanBackupData) => void
  resetRows: () => void
}

const successMessage = (message: string, data: LoanBackupData) =>
  data.importWarnings?.length ? `${message}. Предупреждение: ${data.importWarnings.join(' · ')}` : message

export function useLoanImport({ addLoanFromData, replaceData, resetRows }: UseLoanImportOptions) {
  const [importStatus, setImportStatus] = useState<ImportStatus | null>(null)

  const createLoanFromData = useCallback((data: LoanBackupData, source = 'данных') => {
    try {
      addLoanFromData(data)
      resetRows()
      setImportStatus({ kind: 'success', text: successMessage(`Создан новый кредит из ${source}`, data) })
      return true
    } catch (error) {
      setImportStatus({ kind: 'error', text: error instanceof Error ? error.message : 'Не удалось создать кредит' })
      return false
    }
  }, [addLoanFromData, resetRows])

  const replaceActiveWithData = useCallback((data: LoanBackupData, source = 'данных') => {
    try {
      replaceData(data)
      resetRows()
      setImportStatus({ kind: 'success', text: successMessage(`Текущий кредит заменён данными из ${source}`, data) })
      return true
    } catch (error) {
      setImportStatus({ kind: 'error', text: error instanceof Error ? error.message : 'Не удалось заменить текущий кредит' })
      return false
    }
  }, [replaceData, resetRows])

  return {
    importStatus,
    setImportStatus,
    createLoanFromData,
    replaceActiveWithData
  }
}
