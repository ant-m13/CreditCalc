// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PaymentScheduleItem } from '../loanEngine'
import { defaultConfig } from '../loanDefaults'
import type { LoanProfile } from '../store'
import type { ImportStatus } from './useLoanImport'
import type { RepaymentRule } from '../repaymentRules'

const candidateValidationMock = vi.hoisted(() => vi.fn(() => {
  throw new Error('sync candidate validation should not run')
}))
const sharedCalculationMock = vi.hoisted(() => ({
  buildShareUrl: vi.fn(async () => 'https://example.test/#calc=v1.test-code'),
  encodeSharedCalculation: vi.fn(async () => 'v1.test-code')
}))

vi.mock('../loanCandidate', () => ({
  assertLoanCandidateValid: candidateValidationMock
}))
vi.mock('../shareCalculation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../shareCalculation')>()
  return {
    ...actual,
    buildShareUrl: sharedCalculationMock.buildShareUrl,
    encodeSharedCalculation: sharedCalculationMock.encodeSharedCalculation
  }
})

import { useLoanExport } from './useLoanExport'

const loan: LoanProfile = {
  id: 'loan-export',
  name: 'Экспорт',
  config: defaultConfig,
  repayments: [],
  repaymentRules: [],
  gracePeriods: [],
  selectedScenario: 'combined',
  termUnit: 'months',
  displayDecimals: 2,
  appFontSize: 'normal',
  scheduleFontSize: 'large',
  theme: 'emerald',
  customAccentColor: '#0b9873',
  useCustomAccentColor: false
}

const scheduleRow = (patch: Partial<PaymentScheduleItem> = {}): PaymentScheduleItem => ({
  number: 7,
  date: '2030-01-15',
  days: 31,
  openingBalance: 1122,
  payment: 168,
  interest: 45,
  principal: 123,
  earlyPayment: 0,
  interestAccrued: 45,
  interestPaid: 45,
  principalPaid: 123,
  feePaid: 0,
  deferredInterestOpening: 0,
  deferredInterestClosing: 0,
  cashFlowTotal: 168,
  closingBalance: 999,
  cumulativeInterest: 45,
  cumulativeSavings: 0,
  fee: 0,
  comment: '',
  event: '',
  eventTypes: [],
  paymentRecalculated: false,
  fullyClosedByEarlyRepayment: false,
  isRegularPayment: true,
  isGracePayment: false,
  ...patch
})

function ExportProbe({
  calculatedSchedule,
  calculatedExportsReady = true,
  setImportStatus = vi.fn(),
  activeLoan = loan,
  kind = 'csv',
  calculationErrors = []
}: {
  calculatedSchedule: PaymentScheduleItem[] | null
  calculatedExportsReady?: boolean
  setImportStatus?: (status: ImportStatus | null) => void
  activeLoan?: LoanProfile
  kind?: 'csv' | 'json' | 'xls'
  calculationErrors?: string[]
}) {
  const { download, copyShareLink, createParameterCode } = useLoanExport({
    loans: [activeLoan],
    activeLoanId: activeLoan.id,
    calculatedSchedule,
    calculatedExportsReady,
    calculationErrors,
    setImportStatus
  })
  return <>
    <button onClick={() => download(kind)}>Export</button>
    <button onClick={() => void copyShareLink()}>Link</button>
    <button onClick={() => void createParameterCode()
      .then(code => setImportStatus({ kind: 'success', text: code }))
      .catch(error => setImportStatus({ kind: 'error', text: error instanceof Error ? error.message : 'Не удалось сформировать код параметров' }))}>Code</button>
  </>
}

let exportedBlob: Blob | null = null

beforeEach(() => {
  exportedBlob = null
  candidateValidationMock.mockClear()
  sharedCalculationMock.buildShareUrl.mockClear()
  sharedCalculationMock.encodeSharedCalculation.mockClear()
  vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => {
    exportedBlob = blob as Blob
    return 'blob:test-export'
  })
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('useLoanExport', () => {
  it('exports CSV from the ready calculation result without recalculating scenarios', async () => {
    const user = userEvent.setup()
    render(<ExportProbe calculatedSchedule={[scheduleRow()]}/>)

    await user.click(screen.getByRole('button', { name: 'Export' }))

    expect(candidateValidationMock).not.toHaveBeenCalled()
    expect(exportedBlob).not.toBeNull()
    await expect(exportedBlob!.text()).resolves.toContain('7;2030-01-15;123;45;168;999')
  })

  it('exports JSON from the ready calculation result without candidate validation', async () => {
    const user = userEvent.setup()
    render(<ExportProbe calculatedSchedule={null} kind="json"/>)

    await user.click(screen.getByRole('button', { name: 'Export' }))

    expect(candidateValidationMock).not.toHaveBeenCalled()
    expect(exportedBlob).not.toBeNull()
    await expect(exportedBlob!.text()).resolves.toContain('"version": 1')
  })

  it('rejects calculated export while the worker result is not ready', async () => {
    const user = userEvent.setup()
    const setImportStatus = vi.fn()
    render(<ExportProbe calculatedSchedule={[scheduleRow()]} calculatedExportsReady={false} setImportStatus={setImportStatus}/>)

    await user.click(screen.getByRole('button', { name: 'Export' }))

    expect(candidateValidationMock).not.toHaveBeenCalled()
    expect(exportedBlob).toBeNull()
    expect(setImportStatus).toHaveBeenCalledWith({
      kind: 'error',
      text: 'Дождитесь окончания пересчёта, чтобы экспортировать актуальный график'
    })
  })

  it('rejects JSON export while the worker result is not ready', async () => {
    const user = userEvent.setup()
    const setImportStatus = vi.fn()
    render(<ExportProbe calculatedSchedule={null} calculatedExportsReady={false} kind="json" setImportStatus={setImportStatus}/>)

    await user.click(screen.getByRole('button', { name: 'Export' }))

    expect(candidateValidationMock).not.toHaveBeenCalled()
    expect(exportedBlob).toBeNull()
    expect(setImportStatus).toHaveBeenCalledWith({
      kind: 'error',
      text: 'Дождитесь окончания пересчёта, чтобы экспортировать актуальный график'
    })
  })

  it('rejects JSON export when the current worker result has errors', async () => {
    const user = userEvent.setup()
    const setImportStatus = vi.fn()
    render(<ExportProbe calculatedSchedule={null} calculationErrors={['Полный расчёт остановлен']} kind="json" setImportStatus={setImportStatus}/>)

    await user.click(screen.getByRole('button', { name: 'Export' }))

    expect(candidateValidationMock).not.toHaveBeenCalled()
    expect(exportedBlob).toBeNull()
    expect(setImportStatus).toHaveBeenCalledWith({
      kind: 'error',
      text: 'Полный расчёт остановлен'
    })
  })

  it('rejects JSON export if caller passed an empty error list for an invalid plan', async () => {
    const user = userEvent.setup()
    const setImportStatus = vi.fn()
    const totalRule = (id: string, amount: number): RepaymentRule => ({
      id,
      name: id,
      type: 'monthlyTotalPayment',
      startDate: defaultConfig.firstPaymentDate,
      endDate: defaultConfig.firstPaymentDate,
      amount,
      strategy: 'reduceTerm',
      source: 'own',
      sameDayOrder: 'regularFirst',
      interestFirst: true,
      skipMonths: []
    })
    const invalidLoan = { ...loan, repaymentRules: [totalRule('total-1', 100000), totalRule('total-2', 110000)] }
    render(<ExportProbe calculatedSchedule={null} activeLoan={invalidLoan} calculationErrors={[]} kind="json" setImportStatus={setImportStatus}/>)

    await user.click(screen.getByRole('button', { name: 'Export' }))

    expect(exportedBlob).toBeNull()
    expect(setImportStatus).toHaveBeenCalledWith({
      kind: 'error',
      text: expect.stringContaining('только одну общую сумму')
    })
  })

  it('rejects JSON export when required loan fields are empty', async () => {
    const user = userEvent.setup()
    const setImportStatus = vi.fn()
    const brokenLoan = { ...loan, config: { ...loan.config, firstPaymentDate: '' } }
    render(<ExportProbe calculatedSchedule={null} activeLoan={brokenLoan} kind="json" setImportStatus={setImportStatus}/>)

    await user.click(screen.getByRole('button', { name: 'Export' }))

    expect(exportedBlob).toBeNull()
    expect(setImportStatus).toHaveBeenCalledWith({
      kind: 'error',
      text: 'Заполните обязательные поля перед экспортом: дату первого платежа'
    })
  })

  it('rejects parameter code when required loan fields are empty', async () => {
    const user = userEvent.setup()
    const setImportStatus = vi.fn()
    const brokenLoan = { ...loan, config: { ...loan.config, issueDate: '', firstPaymentDate: '' } }
    render(<ExportProbe calculatedSchedule={null} activeLoan={brokenLoan} setImportStatus={setImportStatus}/>)

    await user.click(screen.getByRole('button', { name: 'Code' }))

    expect(setImportStatus).toHaveBeenCalledWith({
      kind: 'error',
      text: 'Заполните обязательные поля перед экспортом: дату выдачи, дату первого платежа'
    })
  })

  it('copies share link from the ready calculation result without candidate validation', async () => {
    const user = userEvent.setup()
    const setImportStatus = vi.fn()
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText }
    })
    render(<ExportProbe calculatedSchedule={null} setImportStatus={setImportStatus}/>)

    await user.click(screen.getByRole('button', { name: 'Link' }))

    expect(candidateValidationMock).not.toHaveBeenCalled()
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining('#calc=v1.')))
    expect(sharedCalculationMock.buildShareUrl).toHaveBeenCalled()
    await waitFor(() => expect(setImportStatus).toHaveBeenCalledWith({
      kind: 'success',
      text: 'Ссылка на кредит «Экспорт» скопирована. Ссылка содержит параметры кредита, досрочные платежи и льготные периоды. Не отправляйте её тем, кому не доверяете.'
    }))
  })

  it('creates parameter code from the ready calculation result without candidate validation', async () => {
    const user = userEvent.setup()
    const setImportStatus = vi.fn()
    render(<ExportProbe calculatedSchedule={null} setImportStatus={setImportStatus}/>)

    await user.click(screen.getByRole('button', { name: 'Code' }))

    expect(candidateValidationMock).not.toHaveBeenCalled()
    expect(sharedCalculationMock.encodeSharedCalculation).toHaveBeenCalled()
    await waitFor(() => expect(setImportStatus).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'success',
      text: expect.stringMatching(/^v1\./)
    })))
  })
})
