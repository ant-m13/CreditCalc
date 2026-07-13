// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultConfig } from '../loanDefaults'
import type { GoalPlannerSnapshot } from '../goalPlannerRunner'
import type { GoalPlannerResult, GoalPlanPreview } from '../goalPlanner'
import type { ScenarioResult } from '../loanEngine'
import { GoalPlanner } from './GoalPlanner'

const runnerMocks = vi.hoisted(() => ({
  calculate: vi.fn(),
  preview: vi.fn(),
  cancel: vi.fn(),
  dispose: vi.fn()
}))

vi.mock('../goalPlannerRunner', () => ({
  GoalPlannerRunner: class {
    calculate(...args: unknown[]) { runnerMocks.calculate(...args) }
    preview(...args: unknown[]) { runnerMocks.preview(...args) }
    cancel() { runnerMocks.cancel() }
    dispose() { runnerMocks.dispose() }
  }
}))

vi.mock('./Schedule', () => ({ Schedule: ({ repayments }: { repayments: Array<{ id: string }> }) => <div>Предпросмотр графика · {repayments.map(repayment => repayment.id).join(', ')}</div> }))

const operations = {
  repayments: [],
  repaymentRules: [{
    id: 'goal-rule', name: 'План', type: 'monthlyFixed' as const, startDate: '2026-08-01', endDate: '2030-01-01', amount: 5000, strategy: 'reduceTerm' as const, source: 'own' as const, sameDayOrder: 'regularFirst' as const, interestFirst: true, skipMonths: []
  }]
}

const summary = {
  closingDate: '2029-01-01',
  totalPaid: 1_100_000,
  totalInterest: 90_000,
  overpayment: 100_000,
  interestSavings: 25_000,
  totalPaidDifference: -20_000,
  daysSaved: 365,
  total: { bankTransfer: 1_100_000, principal: 1_000_000, interest: 90_000, fees: 10_000 },
  plannerContribution: { bankTransfer: 120_000, principal: 110_000, interest: 0, fees: 10_000, regularPayment: 0, unused: 0, additionalInvestment: 120_000 }
}

const result: GoalPlannerResult = {
  status: 'planned',
  targetDate: '2029-01-01',
  current: { ...summary, closingDate: '2030-01-01', totalInterest: 115_000, overpayment: 125_000, interestSavings: 0, daysSaved: 0 },
  variants: [
    { kind: 'monthlyExtra', title: 'Ежемесячное увеличение', status: 'achieved', monthlyExtra: 5000, boundaryVerified: true, operations, summary },
    { kind: 'combined', title: 'Комбинированный план', status: 'infeasible', reason: 'Укажите разовый взнос', boundaryVerified: false, operations: { repayments: [], repaymentRules: [] } }
  ]
}

const scenario = (id: string): ScenarioResult => ({ id, name: id, strategy: 'combined', schedule: [], monthlyPayment: 0, totalPaid: 0, totalInterest: 0, overpayment: 0, closingDate: '2029-01-01', termMonths: 0, termDays: 0, interestSavings: 0, monthsSaved: 0, daysSaved: 0 })

const config = { ...defaultConfig, principal: 1_000_000, issueDate: '2026-01-01', firstPaymentDate: '2026-02-01', paymentDay: 1, termMonths: 60 }
const repayments: never[] = []
const repaymentRules: never[] = []
const gracePeriods: never[] = []
const previewRepayment = {
  id: 'rule-goal-rule-2026-08-01',
  date: '2026-08-01',
  amount: 5000,
  amountMode: 'extra' as const,
  strategy: 'reduceTerm' as const,
  source: 'own' as const,
  sameDayOrder: 'regularFirst' as const,
  interestFirst: true
}

const props = (patch = {}) => ({
  loanId: 'loan-1',
  sourceRevision: 'source-1',
  config,
  repayments,
  repaymentRules,
  gracePeriods,
  selectedScenario: 'combined',
  displayDecimals: 2 as const,
  applyGoalPlan: vi.fn(),
  ...patch
})

beforeEach(() => {
  runnerMocks.calculate.mockReset().mockImplementation((snapshot: GoalPlannerSnapshot, onResult: (value: unknown) => void) => onResult({ revision: snapshot.revision, snapshot, result }))
  runnerMocks.preview.mockReset().mockImplementation((snapshot: GoalPlannerSnapshot, _operations: unknown, onResult: (value: unknown) => void) => {
    const preview: GoalPlanPreview = { current: scenario('current'), planned: scenario('planned'), repayments: [previewRepayment] }
    onResult({ revision: snapshot.revision, snapshot, result: preview })
  })
  runnerMocks.cancel.mockReset()
  runnerMocks.dispose.mockReset()
})

afterEach(cleanup)

describe('GoalPlanner UI', () => {
  it('предлагает сокращение срока до десяти лет и передаёт выбранную цель в расчёт', async () => {
    const user = userEvent.setup()
    render(<GoalPlanner {...props()}/>)

    const select = screen.getByLabelText('Сократить срок')
    expect(screen.getByRole('option', { name: 'На 6 месяцев' })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'На 1 год' })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'На 2 года' })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'На 3 года' })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'На 5 лет' })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'На 10 лет' })).toBeTruthy()

    await user.selectOptions(select, '120')
    await user.click(screen.getByRole('button', { name: 'Рассчитать план' }))

    expect(runnerMocks.calculate.mock.calls[0]?.[0]).toMatchObject({ goal: { type: 'monthsEarlier', months: 120 } })
  })

  it('показывает варианты, сравнение и применяет план к исходной ревизии', async () => {
    const user = userEvent.setup()
    const applyGoalPlan = vi.fn()
    render(<GoalPlanner {...props({ applyGoalPlan })}/>)

    await user.click(screen.getByRole('button', { name: 'Рассчитать план' }))
    expect(await screen.findByText(/Платите дополнительно/)).toBeTruthy()
    expect(screen.getByText('Укажите разовый взнос')).toBeTruthy()
    expect(screen.getByText('По операциям плана банку')).toBeTruthy()
    expect(screen.getByText('Обязательная часть в операциях')).toBeTruthy()
    expect(screen.getByText('Досрочно в тело')).toBeTruthy()
    expect(screen.getByText('Проценты в операциях')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Сравнить варианты' }))
    expect(screen.getByRole('table')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Добавить этот план в кредит' }))

    expect(applyGoalPlan).toHaveBeenCalledWith(expect.objectContaining({
      expectedLoanId: 'loan-1',
      expectedConfig: config,
      expectedRepayments: repayments,
      expectedRepaymentRules: repaymentRules,
      expectedGracePeriods: gracePeriods,
      operations
    }))
    expect(screen.getByText(/добавлен в кредит/)).toBeTruthy()
  })

  it('открывает выбранный график через отдельный Worker-запрос', async () => {
    const user = userEvent.setup()
    render(<GoalPlanner {...props()}/>)
    await user.click(screen.getByRole('button', { name: 'Рассчитать план' }))
    await user.click(await screen.findByRole('button', { name: 'Посмотреть новый график' }))

    expect(runnerMocks.preview).toHaveBeenCalledWith(expect.objectContaining({ loanId: 'loan-1' }), operations, expect.any(Function), expect.any(Function))
    expect(await screen.findByRole('dialog', { name: 'Новый график платежей' })).toBeTruthy()
    expect(screen.getByText(/Предпросмотр графика · rule-goal-rule-2026-08-01/)).toBeTruthy()
  })

  it('помечает результат устаревшим после изменения исходной ревизии', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<GoalPlanner {...props()}/>)
    await user.click(screen.getByRole('button', { name: 'Рассчитать план' }))
    expect(await screen.findByText(/Платите дополнительно/)).toBeTruthy()

    rerender(<GoalPlanner {...props({ sourceRevision: 'source-2' })}/>)

    await waitFor(() => expect(screen.getByText(/Параметры изменились/)).toBeTruthy())
    expect(screen.queryByText(/Платите дополнительно/)).toBeNull()
  })

  it('отменяет выполняющийся подбор без сохранения результата', async () => {
    const user = userEvent.setup()
    runnerMocks.calculate.mockImplementationOnce(() => undefined)
    render(<GoalPlanner {...props()}/>)

    await user.click(screen.getByRole('button', { name: 'Рассчитать план' }))
    await user.click(screen.getByRole('button', { name: 'Отменить' }))

    expect(runnerMocks.cancel).toHaveBeenCalledOnce()
    expect(screen.getByText('Расчёт отменён')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Рассчитать план' })).toBeTruthy()
  })

  it('показывает ошибку Worker и снимает состояние загрузки', async () => {
    const user = userEvent.setup()
    runnerMocks.calculate.mockImplementationOnce((_snapshot: unknown, _onResult: unknown, onError: (message: string) => void) => onError('Worker недоступен'))
    render(<GoalPlanner {...props()}/>)

    await user.click(screen.getByRole('button', { name: 'Рассчитать план' }))

    expect(screen.getByRole('alert').textContent).toContain('Worker недоступен')
    expect(screen.getByRole('button', { name: 'Рассчитать план' })).toBeTruthy()
  })

  it('не показывает успех, если store отклонил применение плана', async () => {
    const user = userEvent.setup()
    const applyGoalPlan = vi.fn(() => { throw new Error('Кредит изменился') })
    render(<GoalPlanner {...props({ applyGoalPlan })}/>)
    await user.click(screen.getByRole('button', { name: 'Рассчитать план' }))

    await user.click(await screen.findByRole('button', { name: 'Добавить этот план в кредит' }))

    expect(screen.getByRole('alert').textContent).toContain('Кредит изменился')
    expect(screen.queryByText(/добавлен в кредит/)).toBeNull()
  })
})
