import { useCallback } from 'react'
import type { ValidatedLoanData } from '../importExport'
import type { PaymentScheduleItem } from '../loanEngine'
import type { LoanCalculationSnapshot } from '../loanCalculationRunner'
import { buildShareUrl, createLoanSnapshot, decodeSharedCalculation, encodeSharedCalculation, looksLikeSharedCalculationUrl, normalizeSharedCalculationPayload } from '../shareCalculation'
import { loanToBackupData, type LoanProfile } from '../store'
import type { ImportStatus } from './useLoanImport'
import { assertPortableJsonSize } from '../portabilityLimits'
import { downloadBlob } from '../download'

interface UseLoanExportOptions {
  loans: LoanProfile[]
  activeLoanId: string
  calculatedSchedule: PaymentScheduleItem[] | null
  calculatedExportsReady: boolean
  calculationErrors: string[]
  readyCalculationSnapshot: LoanCalculationSnapshot | null
  setImportStatus: (status: ImportStatus | null) => void
}

const STALE_EXPORT_MESSAGE = 'Дождитесь окончания пересчёта, чтобы экспортировать актуальный график'

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

const hasText = (value: unknown) => typeof value === 'string' && value.trim().length > 0

const exportRequiredFields = (loan: LoanProfile) => [
  { label: 'дату выдачи', value: loan.config.issueDate },
  { label: 'дату первого платежа', value: loan.config.firstPaymentDate },
  { label: 'тип платежа', value: loan.config.paymentType },
  { label: 'периодичность', value: loan.config.frequency },
  { label: 'валюту', value: loan.config.currency },
  { label: 'округление', value: loan.config.rounding },
  { label: 'метод начисления процентов', value: loan.config.interest?.method },
  { label: 'базу года', value: loan.config.interest?.dayCountBasis },
  { label: 'начало процентного периода', value: loan.config.interest?.periodStart },
  { label: 'момент остатка для процентов', value: loan.config.interest?.balanceMoment }
]

export const createSnapshotFromReadyCalculation = (loan: LoanProfile, calculatedExportsReady: boolean, calculationErrors: string[], readyCalculationSnapshot: LoanCalculationSnapshot | null) => {
  const missing = exportRequiredFields(loan).filter(field => !hasText(field.value)).map(field => field.label)
  if (missing.length > 0) throw new Error(`Заполните обязательные поля перед экспортом: ${missing.join(', ')}`)
  if (!calculatedExportsReady) throw new Error(STALE_EXPORT_MESSAGE)
  if (calculationErrors.length > 0) throw new Error(calculationErrors.join(' · '))
  const ready = readyCalculationSnapshot
  if (!ready || !ready.revision || ready.loanId !== loan.id || ready.config !== loan.config || ready.repayments !== loan.repayments || ready.repaymentRules !== loan.repaymentRules || ready.gracePeriods !== loan.gracePeriods || ready.selectedScenario !== loan.selectedScenario || ready.displayDecimals !== loan.displayDecimals) {
    throw new Error(STALE_EXPORT_MESSAGE)
  }
  return createLoanSnapshot({
    ...loanToBackupData(loan),
    config: ready.config,
    repayments: ready.repayments,
    repaymentRules: ready.repaymentRules,
    gracePeriods: ready.gracePeriods,
    selectedScenario: ready.selectedScenario,
    displayDecimals: ready.displayDecimals
  })
}

export function useLoanExport({ loans, activeLoanId, calculatedSchedule, calculatedExportsReady, calculationErrors, readyCalculationSnapshot, setImportStatus }: UseLoanExportOptions) {
  const activeLoan = useCallback(() => loans.find(item => item.id === activeLoanId) ?? loans[0], [loans, activeLoanId])
  const print = useCallback(() => window.print(), [])
  const downloadRecovery = useCallback(() => {
    const loan = activeLoan()
    if (!loan) return
    try {
      const body = JSON.stringify({
        version: 1,
        recoveryOnly: true,
        exportedAt: new Date().toISOString(),
        calculationErrors,
        ...loanToBackupData(loan)
      }, (_key, value) => typeof value === 'number' && !Number.isFinite(value) ? String(value) : value, 2)
      assertPortableJsonSize(body)
      const safeName = loan.name.toLowerCase().replace(/[^a-zа-яё0-9]+/gi, '-').replace(/^-|-$/g, '') || 'credit'
      downloadBlob(new Blob([body], { type: 'application/json' }), `credit-${safeName}.recovery.json`)
      setImportStatus({ kind: 'success', text: 'Raw recovery backup исходных параметров сохранён; файл не является подтверждённым расчётом' })
    } catch (error) {
      setImportStatus({ kind: 'error', text: error instanceof Error ? error.message : 'Не удалось сохранить raw recovery backup' })
    }
  }, [activeLoan, calculationErrors, setImportStatus])

  const download = useCallback((kind: 'csv' | 'json' | 'xls') => {
    const loan = activeLoan()
    if (!loan) return

    let body: string
    let type: string
    let ext: string = kind

    if (kind === 'json') {
      let snapshot: ReturnType<typeof createLoanSnapshot>
      try {
        snapshot = createSnapshotFromReadyCalculation(loan, calculatedExportsReady, calculationErrors, readyCalculationSnapshot)
      } catch (error) {
        setImportStatus({ kind: 'error', text: error instanceof Error ? error.message : 'Не удалось проверить расчёт перед экспортом' })
        return
      }
      body = JSON.stringify({ ...snapshot, exportedAt: new Date().toISOString() }, null, 2)
      try {
        assertPortableJsonSize(body)
      } catch (error) {
        setImportStatus({ kind: 'error', text: error instanceof Error ? error.message : 'JSON-файл слишком большой' })
        return
      }
      type = 'application/json'
    } else {
      if (!calculatedExportsReady) {
        setImportStatus({ kind: 'error', text: STALE_EXPORT_MESSAGE })
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
    downloadBlob(new Blob([body], { type }), `credit-${safeName}.${ext}`)
  }, [activeLoan, calculatedExportsReady, calculatedSchedule, calculationErrors, readyCalculationSnapshot, setImportStatus])

  const copyShareLink = useCallback(async () => {
    try {
      const loan = activeLoan()
      if (!loan) return
      const snapshot = createSnapshotFromReadyCalculation(loan, calculatedExportsReady, calculationErrors, readyCalculationSnapshot)
      const url = await buildShareUrl(snapshot, window.location.href)
      await copyText(url)
      setImportStatus({ kind: 'success', text: `Ссылка на кредит «${loan.name}» скопирована. Ссылка содержит параметры кредита, досрочные платежи и льготные периоды. Не отправляйте её тем, кому не доверяете.` })
    } catch (error) {
      setImportStatus({ kind: 'error', text: error instanceof Error ? error.message : 'Не удалось сформировать ссылку на расчёт' })
    }
  }, [activeLoan, calculatedExportsReady, calculationErrors, readyCalculationSnapshot, setImportStatus])

  const createParameterCode = useCallback(async () => {
    const loan = activeLoan()
    if (!loan) throw new Error('Не выбран кредит')
    return encodeSharedCalculation(createSnapshotFromReadyCalculation(loan, calculatedExportsReady, calculationErrors, readyCalculationSnapshot))
  }, [activeLoan, calculatedExportsReady, calculationErrors, readyCalculationSnapshot])

  const decodeParameterCode = useCallback((code: string): Promise<ValidatedLoanData> =>
    decodeSharedCalculation(normalizeSharedCalculationPayload(code)), [])

  return {
    download,
    downloadRecovery,
    print,
    copyShareLink,
    createParameterCode,
    decodeParameterCode,
    looksLikeParameterLink: looksLikeSharedCalculationUrl
  }
}
