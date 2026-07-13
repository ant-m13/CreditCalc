// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { EarlyRepayment } from '../loanEngine'
import type { RepaymentRule } from '../repaymentRules'
import { EarlyList } from './EarlyList'

const repayment = (id: string, operationSource: 'manual' | 'rule'): EarlyRepayment => ({
  id,
  date: '2027-01-15',
  amount: 1,
  amountMode: 'extra',
  operationSource,
  strategy: 'reduceTerm',
  source: 'own',
  sameDayOrder: 'regularFirst',
  interestFirst: true
})

describe('EarlyList', () => {
  it('ограничивает DOM страницами и классифицирует большие списки через Set ручных ID', () => {
    const items = Array.from({ length: 250 }, (_, index) => repayment(`manual-${index}`, 'manual'))
    const generated = Array.from({ length: 250 }, (_, index) => repayment(`rule-${index}-2027-01-15`, 'rule'))
    const linearLookup = vi.spyOn(items, 'find')
    const { container } = render(<EarlyList items={items} rules={[]} generated={generated} currency="RUB" displayDecimals={2} remove={vi.fn()} edit={vi.fn()} toggle={vi.fn()} open={vi.fn()} addRule={vi.fn()} updateRule={vi.fn()} removeRule={vi.fn()} defaultStart="2027-01-15"/>)

    expect(container.querySelectorAll('.combined-event')).toHaveLength(50)
    expect(container.querySelectorAll('.event-list > .event').length).toBeLessThanOrEqual(100)
    for (let page = 0; page < 5; page += 1) fireEvent.click(screen.getByRole('button', { name: 'Следующая страница: календарь операций' }))
    expect(container.querySelectorAll('.generated-event')).toHaveLength(50)
    expect(linearLookup).not.toHaveBeenCalled()
  }, 15_000)

  it('показывает правила досрочных платежей страницами', () => {
    const rules: RepaymentRule[] = Array.from({ length: 120 }, (_, index) => ({
      id: `rule-${index}`,
      name: `Правило ${index}`,
      type: 'monthlyFixed',
      startDate: '2027-01-15',
      endDate: '2028-01-15',
      amount: 1000,
      strategy: 'reduceTerm',
      source: 'own',
      sameDayOrder: 'regularFirst',
      interestFirst: true,
      skipMonths: []
    }))
    const { container } = render(<EarlyList items={[]} rules={rules} generated={[]} currency="RUB" displayDecimals={2} remove={vi.fn()} edit={vi.fn()} toggle={vi.fn()} open={vi.fn()} addRule={vi.fn()} updateRule={vi.fn()} removeRule={vi.fn()} defaultStart="2027-01-15"/>)

    expect(container.querySelectorAll('.rule-list > .event')).toHaveLength(50)
    fireEvent.click(screen.getByRole('button', { name: 'Следующая страница: регулярные правила' }))
    expect(container.querySelectorAll('.rule-list > .event')).toHaveLength(50)
  })
})
