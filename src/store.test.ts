import { describe, expect, it } from 'vitest'
import { MAX_EARLY_REPAYMENTS, MAX_REPAYMENT_RULES } from './loanEngine/limits'
import { defaultConfig, MAX_LOANS, normalizePersistedState, useLoanStore, type LoanProfile } from './store'
import type { EarlyRepayment } from './loanEngine'
import type { RepaymentRule } from './repaymentRules'

const repaymentBase = {
  strategy: 'reduceTerm',
  source: 'own',
  sameDayOrder: 'earlyFirst',
  interestFirst: true
} as const

const loanProfile = (patch: Partial<LoanProfile> = {}): LoanProfile => ({
  id: 'loan-active',
  name: 'Рабочий',
  config: defaultConfig,
  repayments: [],
  repaymentRules: [],
  gracePeriods: [],
  selectedScenario: 'reduceTerm',
  termUnit: 'months',
  displayDecimals: 2,
  appFontSize: 'normal',
  scheduleFontSize: 'large',
  theme: 'emerald',
  customAccentColor: '#0b9873',
  useCustomAccentColor: false,
  ...patch
})

const repayment = (index: number): EarlyRepayment => ({
  id: `early-${index}`,
  date: defaultConfig.firstPaymentDate,
  amount: 1000 + index,
  amountMode: 'extra',
  strategy: 'reduceTerm',
  source: 'own',
  sameDayOrder: 'regularFirst',
  interestFirst: true
})

const rule = (index: number): RepaymentRule => ({
  id: `rule-${index}`,
  name: `Правило ${index}`,
  type: 'monthlyFixed',
  startDate: defaultConfig.firstPaymentDate,
  endDate: '2027-12-01',
  amount: 1000,
  strategy: 'reduceTerm',
  source: 'own',
  sameDayOrder: 'regularFirst',
  interestFirst: true,
  skipMonths: []
})

const setStoreLoan = (loan: LoanProfile) => {
  useLoanStore.setState({ ...loan, loans: [loan], activeLoanId: loan.id })
}

describe('миграция локального хранилища', () => {
  it('создаёт новый кредит без демонстрационного досрочного платежа', () => {
    const normalized = normalizePersistedState({}) as any
    expect(normalized.repayments).toEqual([])
  })

  it('нормализует старые кредиты и очищает повреждённые массивы', () => {
    const normalized = normalizePersistedState({
      activeLoanId: 'legacy',
      loans: [{
        id: 'legacy',
        name: ' Старый кредит ',
        config: {
          ...defaultConfig,
          currency: 'BROKEN',
          issueDate: '2030-01-01',
          firstPaymentDate: '',
          paymentDay: 1,
          termMonths: 999999
        },
        repayments: [
          { id: 'bad-date', date: '', amount: 1000, amountMode: 'extra', ...repaymentBase },
          { id: 'legacy-total', date: '2030-02-01', amount: 4000, ...repaymentBase },
          { id: 'total-regular', date: '2030-03-01', amount: 5000, amountMode: 'total', ...repaymentBase },
          { id: 'total-nonregular', date: '2030-02-02', amount: 6000, amountMode: 'total', ...repaymentBase }
        ],
        repaymentRules: [
          { id: 'bad-rule', name: 'Плохое правило', type: 'monthlyFixed', startDate: '', endDate: '2030-12-01', amount: 1000, strategy: 'reduceTerm', source: 'own', sameDayOrder: 'regularFirst', interestFirst: true, skipMonths: [] },
          { id: 'good-rule', name: '', type: 'monthlyFixed', startDate: '2030-03-01', endDate: '2030-12-01', amount: 1000, strategy: 'reduceTerm', source: 'own', sameDayOrder: 'regularFirst', interestFirst: true, skipMonths: ['2030-04', 'bad'] }
        ],
        gracePeriods: [
          { id: 'bad-grace', startDate: '', endDate: '2030-04-01', type: 'full', extendTerm: true, accrueInterest: true, capitalizeInterest: false },
          { id: 'good-grace', startDate: '2030-05-01', endDate: '2030-05-31', type: 'full', extendTerm: true, accrueInterest: false, capitalizeInterest: false }
        ],
        selectedScenario: 'reduceTerm',
        termUnit: 'months',
        displayDecimals: 2,
        appFontSize: 'normal',
        scheduleFontSize: 'large',
        theme: 'emerald'
      }]
    }) as any

    expect(normalized.activeLoanId).toBe('legacy')
    expect(normalized.config.currency).toBe('RUB')
    expect(normalized.config.issueDate).toBe('2030-01-01')
    expect(normalized.config.firstPaymentDate).toBe('2030-02-01')
    expect(normalized.config.termMonths).toBe(1200)
    expect(normalized.repayments.map((item: any) => item.id)).toEqual(['legacy-total', 'total-nonregular', 'total-regular'])
    expect(normalized.repayments[0]).toMatchObject({ amountMode: 'total', sameDayOrder: 'regularFirst' })
    expect(normalized.repayments[1]).toMatchObject({ amountMode: 'extra' })
    expect(normalized.repayments[2]).toMatchObject({ amountMode: 'total', sameDayOrder: 'regularFirst' })
    expect(normalized.repaymentRules).toHaveLength(1)
    expect(normalized.repaymentRules[0]).toMatchObject({ id: 'good-rule', name: 'Регулярный платёж', skipMonths: ['2030-04'] })
    expect(normalized.gracePeriods).toHaveLength(1)
    expect(normalized.gracePeriods[0]).toMatchObject({ id: 'good-grace', accrueInterest: false })
  })

  it('игнорирует повреждённые элементы массива loans и ограничивает их число', () => {
    const validLoan = { id: 'valid', name: 'Рабочий', config: defaultConfig, repayments: [], repaymentRules: [], gracePeriods: [], selectedScenario: 'reduceTerm', termUnit: 'months', displayDecimals: 2, appFontSize: 'normal', scheduleFontSize: 'large', theme: 'emerald' }
    const manyLoans = Array.from({ length: 105 }, (_, index) => ({ ...validLoan, id: `loan-${index}` }))
    const normalized = normalizePersistedState({ activeLoanId: 'valid', loans: [null, 15, 'broken', validLoan, ...manyLoans] }) as any
    expect(normalized.loans).toHaveLength(100)
    expect(normalized.loans[0].id).toBe('valid')
    expect(normalized.activeLoanId).toBe('valid')
  })

  it('перевыпускает повторяющиеся ID кредитов и вложенных записей', () => {
    const normalized = normalizePersistedState({
      loans: [
        {
          id: 'duplicate',
          name: 'Первый',
          config: defaultConfig,
          repayments: [
            { id: 'same', date: defaultConfig.firstPaymentDate, amount: 1000, amountMode: 'extra', ...repaymentBase },
            { id: 'same', date: defaultConfig.firstPaymentDate, amount: 2000, amountMode: 'extra', ...repaymentBase }
          ],
          repaymentRules: [],
          gracePeriods: [],
          selectedScenario: 'reduceTerm',
          termUnit: 'months',
          displayDecimals: 2,
          appFontSize: 'normal',
          scheduleFontSize: 'large',
          theme: 'emerald'
        },
        { id: 'duplicate', name: 'Второй', config: defaultConfig, repayments: [], repaymentRules: [], gracePeriods: [], selectedScenario: 'reduceTerm', termUnit: 'months', displayDecimals: 2, appFontSize: 'normal', scheduleFontSize: 'large', theme: 'emerald' }
      ]
    }) as any
    expect(new Set(normalized.loans.map((loan: any) => loan.id)).size).toBe(2)
    expect(new Set(normalized.loans[0].repayments.map((item: any) => item.id)).size).toBe(2)
  })

  it('сохраняет явно отключенные досрочные платежи и правила при миграции', () => {
    const normalized = normalizePersistedState({
      repayments: [{ id: 'off-once', date: defaultConfig.firstPaymentDate, amount: 1000, enabled: false, amountMode: 'extra', ...repaymentBase }],
      repaymentRules: [{ ...rule(1), amount: 1000, enabled: false }]
    }) as any
    expect(normalized.repayments).toHaveLength(1)
    expect(normalized.repayments[0]).toMatchObject({ id: 'off-once', amount: 1000, enabled: false })
    expect(normalized.repaymentRules).toHaveLength(1)
    expect(normalized.repaymentRules[0]).toMatchObject({ amount: 1000, enabled: false })
  })
})

describe('лимиты store до мутации', () => {
  it('не создаёт 101-й кредит', () => {
    const loans = Array.from({ length: MAX_LOANS }, (_, index) => loanProfile({ id: `loan-${index}`, name: `Кредит ${index}` }))
    const normalized = normalizePersistedState({ loans, activeLoanId: loans[0].id }) as Partial<ReturnType<typeof useLoanStore.getState>>
    useLoanStore.setState(normalized)
    expect(() => useLoanStore.getState().createLoan()).toThrow(String(MAX_LOANS))
    expect(useLoanStore.getState().loans).toHaveLength(MAX_LOANS)
  })

  it('не добавляет 5001-й разовый платёж', () => {
    const repayments = Array.from({ length: MAX_EARLY_REPAYMENTS }, (_, index) => repayment(index))
    setStoreLoan(loanProfile({ repayments }))
    expect(() => useLoanStore.getState().addRepayment(repayment(MAX_EARLY_REPAYMENTS + 1))).toThrow(String(MAX_EARLY_REPAYMENTS))
    expect(useLoanStore.getState().repayments).toHaveLength(MAX_EARLY_REPAYMENTS)
  })

  it('не добавляет 5001-е регулярное правило', () => {
    const repaymentRules = Array.from({ length: MAX_REPAYMENT_RULES }, (_, index) => rule(index))
    setStoreLoan(loanProfile({ repaymentRules }))
    expect(() => useLoanStore.getState().addRepaymentRule(rule(MAX_REPAYMENT_RULES + 1))).toThrow(String(MAX_REPAYMENT_RULES))
    expect(useLoanStore.getState().repaymentRules).toHaveLength(MAX_REPAYMENT_RULES)
  })

  it('не импортирует кредит с количеством правил сверх лимита', () => {
    setStoreLoan(loanProfile())
    const repaymentRules = Array.from({ length: MAX_REPAYMENT_RULES + 1 }, (_, index) => rule(index))
    expect(() => useLoanStore.getState().addLoanFromData({
      config: defaultConfig,
      repayments: [],
      repaymentRules,
      gracePeriods: [],
      selectedScenario: 'combined',
      termUnit: 'months',
      displayDecimals: 2,
      theme: 'emerald'
    })).toThrow('правил')
    expect(useLoanStore.getState().loans).toHaveLength(1)
  })
})
