import { useCallback } from 'react'
import type { LoanBackupData } from '../importExport'
import type { PaymentScheduleItem } from '../loanEngine'
import { buildShareUrl, createLoanSnapshot, decodeSharedCalculation, encodeSharedCalculation, looksLikeSharedCalculationUrl, normalizeSharedCalculationPayload } from '../shareCalculation'
import { loanToBackupData, type LoanProfile } from '../store'
import type { ImportStatus } from './useLoanImport'

interface UseLoanExportOptions {
  loans: LoanProfile[]
  activeLoanId: string
  calculatedSchedule: PaymentScheduleItem[] | null
  calculatedExportsReady: boolean
  setImportStatus: (status: ImportStatus | null) => void
}

const copyText = async (text: string) => {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.setAttribute('readonly', '')
    textarea.style.position = 'fixed'
    textarea.style.left = '-9999px'
    document.body.appendChild(textarea)
    textarea.select()
    const copied = document.execCommand('copy')
    textarea.remove()
    if (!copied) throw new Error('Не удалось скопировать ссылку')
  }
}

const escapeHtml = (value: unknown) =>
  String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!))

export function useLoanExport({ loans, activeLoanId, calculatedSchedule, calculatedExportsReady, setImportStatus }: UseLoanExportOptions) {
  const activeLoan = useCallback(() => loans.find(item => item.id === activeLoanId) ?? loans[0], [loans, activeLoanId])
  const print = useCallback(() => window.print(), [])

  const download = useCallback((kind: 'csv' | 'json' | 'xls') => {
    const loan = activeLoan()
    if (!loan) return

    let body: string
    let type: string
    let ext: string = kind

    if (kind === 'json') {
      body = JSON.stringify({ ...createLoanSnapshot(loanToBackupData(loan)), exportedAt: new Date().toISOString() }, null, 2)
      type = 'application/json'
    } else {
      if (!calculatedExportsReady) {
        setImportStatus({ kind: 'error', text: 'Дождитесь окончания пересчёта, чтобы экспортировать актуальный график' })
        return
      }
      const schedule = calculatedSchedule
      if (!schedule) {
        setImportStatus({ kind: 'error', text: 'Нет готового графика для экспорта' })
        return
      }

      const showFees = schedule.some(row => Math.abs(row.feePaid ?? row.fee) > 0.004)
      const showDeferred = schedule.some(row => Math.abs(row.deferredInterestOpening ?? 0) > 0.004 || Math.abs(row.deferredInterestClosing ?? 0) > 0.004)
      const head = showFees
        ? ['№ п/п', 'Дата', 'По кредиту', 'По процентам', 'Комиссия', 'Итого', 'Остаток задолженности']
        : ['№ п/п', 'Дата', 'По кредиту', 'По процентам', 'Итого', 'Остаток задолженности']
      if (showDeferred) head.push('Отложенные проценты', 'Общая задолженность')
      const table = [
        head,
        ...schedule.map(row => {
          const cells = showFees
            ? [row.number, row.date, row.principalPaid ?? row.principal, row.interestPaid ?? row.interest, row.feePaid ?? row.fee, row.cashFlowTotal ?? row.payment + row.earlyPayment + row.fee, row.closingBalance]
            : [row.number, row.date, row.principalPaid ?? row.principal, row.interestPaid ?? row.interest, row.cashFlowTotal ?? row.payment + row.earlyPayment + row.fee, row.closingBalance]
          if (showDeferred) cells.push(row.deferredInterestClosing ?? 0, row.closingBalance + (row.deferredInterestClosing ?? 0))
          return cells
        })
      ]
      body = kind === 'csv'
        ? '\ufeff' + table.map(row => row.join(';')).join('\n')
        : `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>${escapeHtml(loan.name)}</title></head><body><table>${table.map(row => `<tr>${row.map(cell => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('')}</table></body></html>`
      type = kind === 'csv' ? 'text/csv;charset=utf-8' : 'text/html;charset=utf-8'
      ext = kind === 'csv' ? 'csv' : 'html'
    }

    const safeName = loan.name.toLowerCase().replace(/[^a-zа-яё0-9]+/gi, '-').replace(/^-|-$/g, '') || 'credit'
    const anchor = document.createElement('a')
    anchor.href = URL.createObjectURL(new Blob([body], { type }))
    anchor.download = `credit-${safeName}.${ext}`
    anchor.click()
    URL.revokeObjectURL(anchor.href)
  }, [activeLoan, calculatedExportsReady, calculatedSchedule, setImportStatus])

  const copyShareLink = useCallback(async () => {
    try {
      const loan = activeLoan()
      if (!loan) return
      const snapshot = createLoanSnapshot(loanToBackupData(loan))
      const url = await buildShareUrl(snapshot, window.location.href)
      await copyText(url)
      setImportStatus({ kind: 'success', text: `Ссылка на кредит «${loan.name}» скопирована` })
    } catch (error) {
      setImportStatus({ kind: 'error', text: error instanceof Error ? error.message : 'Не удалось сформировать ссылку на расчёт' })
    }
  }, [activeLoan, setImportStatus])

  const createParameterCode = useCallback(async () => {
    const loan = activeLoan()
    if (!loan) throw new Error('Не выбран кредит')
    return encodeSharedCalculation(createLoanSnapshot(loanToBackupData(loan)))
  }, [activeLoan])

  const decodeParameterCode = useCallback((code: string): Promise<LoanBackupData> =>
    decodeSharedCalculation(normalizeSharedCalculationPayload(code)), [])

  return {
    download,
    print,
    copyShareLink,
    createParameterCode,
    decodeParameterCode,
    looksLikeParameterLink: looksLikeSharedCalculationUrl
  }
}
