import { describe, expect, it } from 'vitest'
import { MAX_EARLY_REPAYMENTS, MAX_RATE_CHANGES, MAX_REPAYMENT_RULES } from './loanEngine/limits'
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
          termMonths: 999999,
          rateChangeMode: 'broken',
          rateChanges: [
            { id: 'bad-rate-date', date: '', annualRate: 7 },
            { id: 'bad-rate-value', date: '2030-03-01', annualRate: 200 },
            { id: 'bad-rate-before', date: '2029-12-31', annualRate: 7 },
            { id: 'good-rate', date: '2030-04-01', annualRate: 7.5 },
            { id: 'duplicate-rate-date', date: '2030-04-01', annualRate: 8 }
          ]
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
          { id: 'good-grace', startDate: '2030-05-01', endDate: '2030-05-31', type: 'custom', paymentAmount: 1234.56, extendTerm: true, accrueInterest: false, capitalizeInterest: false }
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
    expect(normalized.config.rateChangeMode).toBe(defaultConfig.rateChangeMode)
    expect(normalized.config.rateChanges).toEqual([{ id: 'good-rate', date: '2030-04-01', annualRate: 7.5 }])
    expect(normalized.repayments.map((item: any) => item.id)).toEqual(['legacy-total', 'total-nonregular', 'total-regular'])
    expect(normalized.repayments[0]).toMatchObject({ amountMode: 'total', sameDayOrder: 'regularFirst' })
    expect(normalized.repayments[1]).toMatchObject({ amountMode: 'extra' })
    expect(normalized.repayments[2]).toMatchObject({ amountMode: 'total', sameDayOrder: 'regularFirst' })
    expect(normalized.repaymentRules).toHaveLength(1)
    expect(normalized.repaymentRules[0]).toMatchObject({ id: 'good-rule', name: 'Регулярный платёж', skipMonths: ['2030-04'] })
    expect(normalized.gracePeriods).toHaveLength(1)
    expect(normalized.gracePeriods[0]).toMatchObject({ id: 'good-grace', type: 'custom', paymentAmount: 1234.56, accrueInterest: false })
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

  it('перенумеровывает повторяющийся порядок операций и правил при миграции', () => {
    const normalized = normalizePersistedState({
      repayments: [
        { id: 'same-day-1', date: defaultConfig.firstPaymentDate, amount: 1000, amountMode: 'extra', sameDaySequence: 0, ...repaymentBase },
        { id: 'same-day-2', date: defaultConfig.firstPaymentDate, amount: 2000, amountMode: 'extra', sameDaySequence: 0, ...repaymentBase }
      ],
      repaymentRules: [
        { ...rule(1), id: 'rule-seq-1', ruleSequence: 0 },
        { ...rule(2), id: 'rule-seq-2', ruleSequence: 0 }
      ]
    }) as any

    expect(normalized.repayments.map((item: any) => item.sameDaySequence)).toEqual([0, 1])
    expect(normalized.repaymentRules.map((item: any) => item.ruleSequence)).toEqual([0, 1])
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

  it('нормализует правило общего ежемесячного платежа', () => {
    const normalized = normalizePersistedState({
      repaymentRules: [{
        ...rule(1),
        type: 'monthlyTotalPayment',
        amount: 100000,
        sameDayOrder: 'earlyFirst'
      }]
    }) as any
    expect(normalized.repaymentRules[0]).toMatchObject({ type: 'monthlyTotalPayment', amount: 100000, sameDayOrder: 'regularFirst' })
  })

  it('восстанавливает порядок same-day досрочных платежей по исходному массиву', () => {
    const normalized = normalizePersistedState({
      repayments: [
        { id: 'term-first', date: defaultConfig.firstPaymentDate, amount: 1000, amountMode: 'extra', ...repaymentBase, strategy: 'reduceTerm' },
        { id: 'payment-second', date: defaultConfig.firstPaymentDate, amount: 1000, amountMode: 'extra', ...repaymentBase, strategy: 'reducePayment' }
      ]
    }) as any
    expect(normalized.repayments.map((item: any) => item.sameDaySequence)).toEqual([0, 1])
  })

  it('сохраняет предсказуемые первые 1000 изменений ставки после сортировки при миграции', () => {
    const lateRates = Array.from({ length: MAX_RATE_CHANGES }, (_, index) => {
      const year = 2035 + Math.floor(index / 336)
      const dayOfYear = index % 336
      return { id: `late-${index}`, date: `${year}-${String(Math.floor(dayOfYear / 28) + 1).padStart(2, '0')}-${String(dayOfYear % 28 + 1).padStart(2, '0')}`, annualRate: 7 }
    })
    const earlyRate = { id: 'early-rate', date: '2030-02-01', annualRate: 6 }
    const normalized = normalizePersistedState({ config: { ...defaultConfig, issueDate: '2030-01-01', firstPaymentDate: '2030-02-01', rateChanges: [...lateRates, earlyRate] } }) as any
    expect(normalized.config.rateChanges).toHaveLength(MAX_RATE_CHANGES)
    expect(normalized.config.rateChanges[0]).toEqual(earlyRate)
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

  it('не сохраняет конфликтующие monthlyTotalPayment rules', () => {
    setStoreLoan(loanProfile())
    const first = { ...rule(1), type: 'monthlyTotalPayment' as const, amount: 100000, startDate: defaultConfig.firstPaymentDate, endDate: defaultConfig.firstPaymentDate }
    const second = { ...rule(2), type: 'monthlyTotalPayment' as const, amount: 110000, startDate: defaultConfig.firstPaymentDate, endDate: defaultConfig.firstPaymentDate }
    useLoanStore.getState().addRepaymentRule(first)
    expect(() => useLoanStore.getState().addRepaymentRule(second)).toThrow('только одну общую сумму')
    expect(useLoanStore.getState().repaymentRules).toHaveLength(1)
  })

  it('не сохраняет total rule, конфликтующее с ручной total-операцией', () => {
    setStoreLoan(loanProfile({ repayments: [{ ...repayment(1), amount: 100000, amountMode: 'total', sameDayOrder: 'regularFirst' }] }))
    const totalRule = { ...rule(1), type: 'monthlyTotalPayment' as const, amount: 110000, startDate: defaultConfig.firstPaymentDate, endDate: defaultConfig.firstPaymentDate }
    expect(() => useLoanStore.getState().addRepaymentRule(totalRule)).toThrow('только одну общую сумму')
    expect(useLoanStore.getState().repaymentRules).toHaveLength(0)
  })

  it('не сохраняет ручную total-операцию, конфликтующую с существующей', () => {
    const activeTotal = { ...repayment(1), amount: 100000, amountMode: 'total' as const, sameDayOrder: 'regularFirst' as const, sameDaySequence: 0 }
    const disabledTotal = { ...repayment(2), id: 'disabled-total', amount: 110000, amountMode: 'total' as const, enabled: false, sameDayOrder: 'regularFirst' as const, sameDaySequence: 1 }
    setStoreLoan(loanProfile({ repayments: [activeTotal, disabledTotal] }))

    expect(() => useLoanStore.getState().updateRepayment({ ...disabledTotal, enabled: true })).toThrow('только одну общую сумму')
    expect(useLoanStore.getState().repayments.find(item => item.id === 'disabled-total')?.enabled).toBe(false)
  })

  it('назначает новую sameDaySequence при переносе платежа на занятую дату', () => {
    const occupied = { ...repayment(1), id: 'occupied', sameDaySequence: 0 }
    const moving = { ...repayment(2), id: 'moving', date: '2026-08-15', sameDaySequence: 0 }
    setStoreLoan(loanProfile({ repayments: [occupied, moving] }))

    useLoanStore.getState().updateRepayment({ ...moving, date: defaultConfig.firstPaymentDate })

    expect(useLoanStore.getState().repayments.find(item => item.id === 'moving')?.sameDaySequence).toBe(1)
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

  it('не импортирует кредит с количеством изменений ставки сверх лимита', () => {
    setStoreLoan(loanProfile())
    const rateChanges = Array.from({ length: MAX_RATE_CHANGES + 1 }, (_, index) => ({ id: `rate-${index}`, date: `2030-${String(Math.floor(index / 28) % 12 + 1).padStart(2, '0')}-${String(index % 28 + 1).padStart(2, '0')}`, annualRate: 7 }))
    expect(() => useLoanStore.getState().addLoanFromData({
      config: { ...defaultConfig, rateChanges },
      repayments: [],
      repaymentRules: [],
      gracePeriods: [],
      selectedScenario: 'combined',
      termUnit: 'months',
      displayDecimals: 2,
      theme: 'emerald'
    })).toThrow(String(MAX_RATE_CHANGES))
    expect(useLoanStore.getState().loans).toHaveLength(1)
  })

  it('не добавляет пересекающиеся льготные периоды', () => {
    const first = { id: 'g1', startDate: '2026-05-01', endDate: '2026-05-31', type: 'full', extendTerm: true, accrueInterest: true, capitalizeInterest: false } as const
    const second = { id: 'g2', startDate: '2026-05-15', endDate: '2026-06-15', type: 'interestOnly', extendTerm: true, accrueInterest: true, capitalizeInterest: false } as const
    setStoreLoan(loanProfile({ gracePeriods: [first] }))
    expect(() => useLoanStore.getState().addGrace(second)).toThrow('не должны пересекаться')
    expect(useLoanStore.getState().gracePeriods).toHaveLength(1)
  })
})
