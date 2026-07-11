// @vitest-environment jsdom
import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { PaymentScheduleItem } from '../loanEngine'
import { getScheduleScrollBehavior, Schedule } from './Schedule'

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
  return <Schedule schedule={schedule} baseSchedule={schedule} repayments={[]} currency="RUB" displayDecimals={2} rows={rows} setRows={setRows}/>
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

  it('не монтирует весь большой график и переключает страницы', () => {
    const large = Array.from({ length: 250 }, (_, index) => scheduleRow({ number: index + 1 }))
    function LargeProbe() {
      const [rows, setRows] = useState(0)
      return <Schedule schedule={large} baseSchedule={large} repayments={[]} currency="RUB" displayDecimals={2} rows={rows} setRows={setRows}/>
    }
    const { container } = render(<LargeProbe/>)

    expect(container.querySelectorAll('tr[id^="schedule-row-"]')).toHaveLength(100)
    expect(container.querySelectorAll('article[id^="mobile-schedule-row-"]')).toHaveLength(100)
    fireEvent.click(screen.getByRole('button', { name: /Далее/ }))
    expect(container.querySelector('#schedule-row-101')).toBeTruthy()
    expect(container.querySelector('#schedule-row-1')).toBeNull()
  })
})
