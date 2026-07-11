// @vitest-environment jsdom
import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { EarlyRepayment } from '../loanEngine'
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
  it('классифицирует большие списки через Set ручных ID', () => {
    const items = Array.from({ length: 250 }, (_, index) => repayment(`manual-${index}`, 'manual'))
    const generated = Array.from({ length: 250 }, (_, index) => repayment(`rule-${index}-2027-01-15`, 'rule'))
    const linearLookup = vi.spyOn(items, 'find')
    const { container } = render(<EarlyList items={items} rules={[]} generated={generated} currency="RUB" displayDecimals={2} remove={vi.fn()} edit={vi.fn()} toggle={vi.fn()} open={vi.fn()} addRule={vi.fn()} updateRule={vi.fn()} removeRule={vi.fn()} defaultStart="2027-01-15"/>)

    expect(container.querySelectorAll('.combined-event')).toHaveLength(500)
    expect(container.querySelectorAll('.generated-event')).toHaveLength(250)
    expect(linearLookup).not.toHaveBeenCalled()
  })
})
