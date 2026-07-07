// @vitest-environment jsdom
import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { PaymentScheduleItem } from '../loanEngine'
import { Schedule } from './Schedule'

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
  const [rows, setRows] = useState(2)
  const schedule = [
    scheduleRow(),
    scheduleRow({ number: 2, date: '2026-08-15', openingBalance: 91000, closingBalance: 81800 })
  ]
  return <Schedule schedule={schedule} baseSchedule={schedule} repayments={[]} currency="RUB" displayDecimals={2} rows={rows} setRows={setRows} more={() => setRows(value => value + 2)}/>
}

describe('Schedule', () => {
  it('показывает сообщение, если дата или месяц не найдены', () => {
    render(<ScheduleProbe/>)

    fireEvent.change(screen.getByPlaceholderText('Дата, месяц или год'), { target: { value: '2030-01' } })
    fireEvent.click(screen.getByRole('button', { name: 'Перейти' }))

    expect(screen.getByText('Дата/месяц не найден')).toBeTruthy()
  })
})
