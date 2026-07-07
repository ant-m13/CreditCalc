// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PaymentScheduleItem } from '../loanEngine'
import { defaultConfig } from '../loanDefaults'
import type { LoanProfile } from '../store'
import type { ImportStatus } from './useLoanImport'

const syncRecalcMock = vi.hoisted(() => vi.fn(() => {
  throw new Error('sync recalculation should not run')
}))

vi.mock('../loanCalculation', () => ({
  buildLoanCalculationOrThrow: syncRecalcMock
}))

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
  setImportStatus = vi.fn()
}: {
  calculatedSchedule: PaymentScheduleItem[] | null
  calculatedExportsReady?: boolean
  setImportStatus?: (status: ImportStatus | null) => void
}) {
  const { download } = useLoanExport({
    loans: [loan],
    activeLoanId: loan.id,
    calculatedSchedule,
    calculatedExportsReady,
    setImportStatus
  })
  return <button onClick={() => download('csv')}>CSV</button>
}

let exportedBlob: Blob | null = null

beforeEach(() => {
  exportedBlob = null
  syncRecalcMock.mockClear()
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

    await user.click(screen.getByRole('button', { name: 'CSV' }))

    expect(syncRecalcMock).not.toHaveBeenCalled()
    expect(exportedBlob).not.toBeNull()
    await expect(exportedBlob!.text()).resolves.toContain('7;2030-01-15;123;45;168;999')
  })

  it('rejects calculated export while the worker result is not ready', async () => {
    const user = userEvent.setup()
    const setImportStatus = vi.fn()
    render(<ExportProbe calculatedSchedule={[scheduleRow()]} calculatedExportsReady={false} setImportStatus={setImportStatus}/>)

    await user.click(screen.getByRole('button', { name: 'CSV' }))

    expect(syncRecalcMock).not.toHaveBeenCalled()
    expect(exportedBlob).toBeNull()
    expect(setImportStatus).toHaveBeenCalledWith({
      kind: 'error',
      text: 'Дождитесь окончания пересчёта, чтобы экспортировать актуальный график'
    })
  })
})
