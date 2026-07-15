// @vitest-environment jsdom
import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PaymentScheduleItem } from '../loanEngine'
import { calculateDebtAtDate, generateBaseSchedule } from '../loanEngine'
import { defaultConfig } from '../loanDefaults'
import { shortTestConfig } from '../testFixtures'
import { createMoneyFormatter } from '../formatters'
import { getScheduleScrollBehavior, SAVED_ROWS_PAGE_SIZE, SCHEDULE_PAGE_SIZE, Schedule } from './Schedule'

afterEach(() => cleanup())

const scheduleRow = (patch: Partial<PaymentScheduleItem> = {}): PaymentScheduleItem => ({
  number: 1,
  date: '2026-07-15',
  days: 30,
  openingBalance: 100000,
  payment: 10000,
  interest: 1000,
  principal: 9000,
  earlyPayment: 0,
  interestAccrued: 1000,
  interestPaid: 1000,
  principalPaid: 9000,
  feePaid: 0,
  deferredInterestOpening: 0,
  deferredInterestClosing: 0,
  cashFlowTotal: 10000,
  closingBalance: 91000,
  cumulativeInterest: 1000,
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

function ScheduleProbe() {
  const [rows, setRows] = useState(0)
  const schedule = [
    scheduleRow(),
    scheduleRow({ number: 2, date: '2026-08-15', openingBalance: 91000, closingBalance: 81800 })
  ]
  return <Schedule schedule={schedule} baseSchedule={schedule} repayments={[]} config={defaultConfig} gracePeriods={[]} currency="RUB" displayDecimals={2} rows={rows} setRows={setRows}/>
}

describe('Schedule', () => {
  it('отключает плавную прокрутку при reduced motion', () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }))

    expect(getScheduleScrollBehavior()).toBe('auto')

    vi.unstubAllGlobals()
  })

  it('показывает сообщение, если дата или месяц не найдены', () => {
    render(<ScheduleProbe/>)

    fireEvent.change(screen.getByRole('textbox', { name: 'Дата или месяц для перехода по графику' }), { target: { value: '2030-01' } })
    fireEvent.click(screen.getByRole('button', { name: 'Перейти' }))

    expect(screen.getByText('Дата/месяц не найден')).toBeTruthy()
  })

  it('помечает базу года как неприменимую в формуле периодического метода', () => {
    const periodicConfig = { ...shortTestConfig, interest: { ...shortTestConfig.interest, method: 'annuity' as const } }
    const schedule = generateBaseSchedule(periodicConfig)
    function AuditProbe() {
      const [rows, setRows] = useState(0)
      return <Schedule schedule={schedule} baseSchedule={schedule} repayments={[]} config={periodicConfig} gracePeriods={[]} currency="RUB" displayDecimals={2} rows={rows} setRows={setRows}/>
    }
    render(<AuditProbe/>)

    fireEvent.click(screen.getByRole('button', { name: 'Показать формулу строки 2' }))
    expect(screen.getAllByText('Не применяется при расчёте по периодам').length).toBeGreaterThan(0)
  })

  it('не монтирует весь большой график и переключает страницы', () => {
    const large = Array.from({ length: SCHEDULE_PAGE_SIZE + 1 }, (_, index) => scheduleRow({ number: index + 1 }))
    function LargeProbe() {
      const [rows, setRows] = useState(0)
      return <Schedule schedule={large} baseSchedule={large} repayments={[]} config={defaultConfig} gracePeriods={[]} currency="RUB" displayDecimals={2} rows={rows} setRows={setRows}/>
    }
    const { container } = render(<LargeProbe/>)

    expect(container.querySelectorAll('tr[id^="schedule-row-"]')).toHaveLength(SCHEDULE_PAGE_SIZE)
    expect(container.querySelectorAll('article[id^="mobile-schedule-row-"]')).toHaveLength(SCHEDULE_PAGE_SIZE)
    fireEvent.click(screen.getByRole('button', { name: /Далее/ }))
    expect(container.querySelector('#schedule-row-101')).toBeTruthy()
    expect(container.querySelector('#schedule-row-1')).toBeNull()
  })

  it('ограничивает DOM исчезнувших строк исходного графика', () => {
    const selected = [scheduleRow({ number: 1, date: '2026-07-15', openingBalance: 1000, closingBalance: 0 })]
    const base = Array.from({ length: SAVED_ROWS_PAGE_SIZE + 1 }, (_, index) => scheduleRow({
      number: index + 1,
      date: `${2027 + Math.floor(index / 12)}-${String(index % 12 + 1).padStart(2, '0')}-15`
    }))
    function SavedRowsProbe() {
      const [rows, setRows] = useState(0)
      return <Schedule schedule={selected} baseSchedule={base} repayments={[]} config={defaultConfig} gracePeriods={[]} currency="RUB" displayDecimals={2} rows={rows} setRows={setRows}/>
    }
    const { container } = render(<SavedRowsProbe/>)

    expect(container.querySelectorAll('.saved-schedule tbody tr')).toHaveLength(SAVED_ROWS_PAGE_SIZE)
    fireEvent.click(screen.getByRole('button', { name: 'Следующие исчезнувшие платежи' }))
    expect(container.querySelector('.saved-schedule tbody tr td')?.textContent).toBe('101')
  })

  it('показывает ту же задолженность с межплатёжными процентами, что и Overview', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-15T12:00:00Z'))
    const config = { ...defaultConfig, principal: 120_000, annualRate: 12, issueDate: '2024-01-01', firstPaymentDate: '2024-02-01', paymentDay: 1, termMonths: 12 }
    const schedule = generateBaseSchedule(config)
    const expected = calculateDebtAtDate(config, schedule, [], '2024-01-15')
    const { money } = createMoneyFormatter('RUB', 2)
    function DebtProbe() {
      const [rows, setRows] = useState(0)
      return <Schedule schedule={schedule} baseSchedule={schedule} repayments={[]} config={config} gracePeriods={[]} currency="RUB" displayDecimals={2} rows={rows} setRows={setRows}/>
    }
    const { container } = render(<DebtProbe/>)

    const debtBlock = container.querySelector('.mobile-schedule-bar > div')!
    expect(debtBlock.querySelector('b')?.textContent).toBe(money(expected.total))
    expect(expected.interest).toBeGreaterThan(0)
    vi.useRealTimers()
  })
})
