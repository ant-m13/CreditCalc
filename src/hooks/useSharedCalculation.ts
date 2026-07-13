import { useCallback, useEffect, useState } from 'react'
import type { ValidatedLoanData } from '../importExport'
import { decodeSharedCalculation, readSharedCalculationFromLocation } from '../shareCalculation'
import type { ImportStatus } from './useLoanImport'

interface UseSharedCalculationOptions {
  createLoanFromData: (data: ValidatedLoanData, source?: string) => boolean
  replaceActiveWithData: (data: ValidatedLoanData, source?: string) => boolean
  setImportStatus: (status: ImportStatus | null) => void
  onAccept?: () => void
}

const clearSharedHash = () => {
  const url = new URL(window.location.href)
  url.hash = ''
  window.history.replaceState(null, '', `${url.pathname}${url.search}`)
}

export function useSharedCalculation({ createLoanFromData, replaceActiveWithData, setImportStatus, onAccept }: UseSharedCalculationOptions) {
  const [sharedCalculation, setSharedCalculation] = useState<ValidatedLoanData | null>(null)

  useEffect(() => {
    const payload = readSharedCalculationFromLocation(window.location)
    if (!payload) return
    let cancelled = false
    decodeSharedCalculation(payload).then(data => {
      if (!cancelled) setSharedCalculation(data)
    }).catch(error => {
      if (!cancelled) {
        clearSharedHash()
        setImportStatus({ kind: 'error', text: error instanceof Error ? error.message : 'Ссылка повреждена. Проверьте ссылку или используйте JSON-файл' })
      }
    })
    return () => { cancelled = true }
  }, [setImportStatus])

  const createLoanFromSharedCalculation = useCallback(() => {
    if (!sharedCalculation) return
    if (createLoanFromData(sharedCalculation, 'ссылки')) {
      setSharedCalculation(null)
      clearSharedHash()
      onAccept?.()
    }
  }, [createLoanFromData, onAccept, sharedCalculation])

  const replaceActiveWithSharedCalculation = useCallback(() => {
    if (!sharedCalculation) return
    if (replaceActiveWithData(sharedCalculation, 'ссылки')) {
      setSharedCalculation(null)
      clearSharedHash()
      onAccept?.()
    }
  }, [onAccept, replaceActiveWithData, sharedCalculation])

  const declineSharedCalculation = useCallback(() => {
    setSharedCalculation(null)
    setImportStatus({ kind: 'error', text: 'Загрузка из ссылки отменена. Локальные данные сохранены' })
    clearSharedHash()
  }, [setImportStatus])

  return {
    sharedCalculation,
    createLoanFromSharedCalculation,
    replaceActiveWithSharedCalculation,
    declineSharedCalculation
  }
}
