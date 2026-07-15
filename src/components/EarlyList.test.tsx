// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { EarlyRepayment } from '../loanEngine'
import type { RepaymentRule } from '../repaymentRules'
import { EARLY_LIST_PAGE_SIZE, EarlyList } from './EarlyList'

const INTERACTION_TEST_TIMEOUT_MS = 15_000

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
  it('показывает отключённый платёж в обоих списках и передаёт его быстрому переключателю', () => {
    const item = { ...repayment('manual-disabled', 'manual'), amount: 100_000, enabled: false }
    const toggle = vi.fn()
    render(<EarlyList items={[item]} rules={[]} generated={[]} currency="RUB" displayDecimals={2} remove={vi.fn()} edit={vi.fn()} toggle={toggle} open={vi.fn()} addRule={vi.fn()} updateRule={vi.fn()} removeRule={vi.fn()} defaultStart="2027-01-15"/>)

    expect(screen.getAllByText(/Временно отключено/)).toHaveLength(2)
    const enableButtons = screen.getAllByRole('button', { name: /Включить платёж/i })
    expect(enableButtons).toHaveLength(2)
    fireEvent.click(enableButtons[1])
    expect(toggle).toHaveBeenCalledWith(item)
  })

  it('ограничивает DOM страницами и классифицирует большие списки через Set ручных ID', () => {
    const items = Array.from({ length: EARLY_LIST_PAGE_SIZE }, (_, index) => repayment(`manual-${index}`, 'manual'))
    const generated = Array.from({ length: EARLY_LIST_PAGE_SIZE }, (_, index) => repayment(`rule-${index}-2027-01-15`, 'rule'))
    const linearLookup = vi.spyOn(items, 'find')
    const { container } = render(<EarlyList items={items} rules={[]} generated={generated} currency="RUB" displayDecimals={2} remove={vi.fn()} edit={vi.fn()} toggle={vi.fn()} open={vi.fn()} addRule={vi.fn()} updateRule={vi.fn()} removeRule={vi.fn()} defaultStart="2027-01-15"/>)

    expect(container.querySelectorAll('.combined-event')).toHaveLength(EARLY_LIST_PAGE_SIZE)
    expect(container.querySelectorAll('.event-list > .event').length).toBeLessThanOrEqual(EARLY_LIST_PAGE_SIZE * 2)
    fireEvent.click(screen.getByRole('button', { name: 'Следующая страница: календарь операций' }))
    expect(container.querySelectorAll('.generated-event')).toHaveLength(EARLY_LIST_PAGE_SIZE)
    expect(linearLookup).not.toHaveBeenCalled()
  }, INTERACTION_TEST_TIMEOUT_MS)

  it('показывает правила досрочных платежей страницами', () => {
    const rules: RepaymentRule[] = Array.from({ length: EARLY_LIST_PAGE_SIZE + 1 }, (_, index) => ({
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

    expect(container.querySelectorAll('.rule-list > .event')).toHaveLength(EARLY_LIST_PAGE_SIZE)
    fireEvent.click(screen.getByRole('button', { name: 'Следующая страница: регулярные правила' }))
    expect(container.querySelectorAll('.rule-list > .event')).toHaveLength(1)
  })
})
