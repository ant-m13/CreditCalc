import { describe, expect, it, vi } from 'vitest'
import { validateScenario } from './loanEngine'
import { buildLoanCalculation } from './loanCalculation'
import { MAX_EARLY_REPAYMENTS, MAX_RATE_CHANGES, MAX_REPAYMENT_RULES } from './loanEngine/limits'
import { defaultConfig, MAX_LOANS, normalizePersistedState, useLoanStore, type LoanProfile } from './store'
import type { EarlyRepayment } from './loanEngine'
import { expandRepaymentRules, type RepaymentRule } from './repaymentRules'
import type { GoalPlanOperations } from './goalPlanner'

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

const currentCalculationErrors = () => {
  const state = useLoanStore.getState()
  return buildLoanCalculation({
    config: state.config,
    repayments: state.repayments,
    repaymentRules: state.repaymentRules,
    gracePeriods: state.gracePeriods,
    selectedScenario: state.selectedScenario
  }).errors.join(' · ')
}

describe('миграция локального хранилища', () => {
  it('создаёт новый кредит без демонстрационного досрочного платежа', () => {
    const normalized = normalizePersistedState({}) as any
    expect(normalized.repayments).toEqual([])
  })

  it('мигрирует persisted-базу 365 в Actual/365', () => {
    const normalized = normalizePersistedState({ config: { ...defaultConfig, interest: { ...defaultConfig.interest, dayCountBasis: '365' } } }) as any
    expect(normalized.config.interest.dayCountBasis).toBe('actual365')
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
          { id: 'legacy-total', date: '2030-02-01', amount: 100000, ...repaymentBase },
          { id: 'total-regular', date: '2030-03-01', amount: 110000, amountMode: 'totalWithFee', ...repaymentBase },
          { id: 'total-nonregular', date: '2030-02-02', amount: 6000, amountMode: 'totalWithFee', ...repaymentBase }
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
    expect(normalized.repayments[0]).toMatchObject({ amountMode: 'totalWithFee', sameDayOrder: 'regularFirst' })
    expect(normalized.repayments[1]).toMatchObject({ amountMode: 'extra' })
    expect(normalized.repayments[2]).toMatchObject({ amountMode: 'totalWithFee', sameDayOrder: 'regularFirst' })
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

  it('помещает структурно повреждённый восстановленный кредит в карантин с отчётом', () => {
    const normalized = normalizePersistedState({
      activeLoanId: 'broken-plan',
      loans: [{
        id: 'broken-plan',
        name: 'Повреждённый план',
        config: defaultConfig,
        repayments: [],
        repaymentRules: [],
        gracePeriods: [
          { id: 'g1', startDate: '2026-08-01', endDate: '2026-08-31', type: 'full', extendTerm: true, accrueInterest: true, capitalizeInterest: false },
          { id: 'g2', startDate: '2026-08-15', endDate: '2026-09-15', type: 'interestOnly', extendTerm: true, accrueInterest: true, capitalizeInterest: false }
        ],
        selectedScenario: 'reduceTerm',
        termUnit: 'months',
        displayDecimals: 2,
        appFontSize: 'normal',
        scheduleFontSize: 'large',
        theme: 'emerald'
      }]
    }) as any

    expect(normalized.activeLoanId).toBe('loan-default')
    expect(normalized.storageRecoveryReport.join(' ')).toContain('карантин')
    expect(normalized.storageRecoveryReport.join(' ')).toContain('Льготные периоды')
    expect(normalized.quarantinedLoansRaw).toHaveLength(1)
    expect(normalized.quarantinedLoansRaw[0]).toMatchObject({
      id: 'broken-plan',
      name: 'Повреждённый план',
      reason: expect.stringContaining('Льготные периоды')
    })
    expect(normalized.quarantinedLoansRaw[0].raw).toMatchObject({ id: 'broken-plan', gracePeriods: expect.arrayContaining([expect.objectContaining({ id: 'g1' })]) })
  })

  it('восстанавливает расчётно невалидный, но структурно корректный план без карантина', () => {
    const first = { ...rule(1), type: 'monthlyTotalPayment' as const, amount: 100000, startDate: defaultConfig.firstPaymentDate, endDate: defaultConfig.firstPaymentDate }
    const second = { ...rule(2), type: 'monthlyTotalPayment' as const, amount: 110000, startDate: defaultConfig.firstPaymentDate, endDate: defaultConfig.firstPaymentDate }
    const persistedLoan = loanProfile({
      id: 'recoverable-plan',
      name: 'Расчёт с ошибкой',
      repaymentRules: [first, second]
    })

    const normalized = normalizePersistedState({
      activeLoanId: persistedLoan.id,
      loans: [persistedLoan]
    }) as any
    const errors = buildLoanCalculation({
      config: normalized.config,
      repayments: normalized.repayments,
      repaymentRules: normalized.repaymentRules,
      gracePeriods: normalized.gracePeriods,
      selectedScenario: normalized.selectedScenario
    }).errors.join(' · ')

    expect(normalized.activeLoanId).toBe(persistedLoan.id)
    expect(normalized.repaymentRules).toHaveLength(2)
    expect(normalized.storageRecoveryReport).toEqual([])
    expect(normalized.quarantinedLoansRaw).toEqual([])
    expect(errors).toContain('только одну общую сумму')
  })

  it('сохраняет уже накопленный буфер карантина при следующей миграции', () => {
    const raw = { id: 'lost-loan', config: { principal: 'broken' } }
    const normalized = normalizePersistedState({
      quarantinedLoansRaw: [{ id: 'lost-loan', name: 'Старый сбой', reason: 'ошибка расчёта', raw }]
    }) as any

    expect(normalized.quarantinedLoansRaw).toEqual([{ id: 'lost-loan', name: 'Старый сбой', reason: 'ошибка расчёта', raw }])
  })

  it('отбрасывает повреждённые записи буфера карантина при миграции', () => {
    const raw = { id: 'valid-raw' }
    const normalized = normalizePersistedState({
      quarantinedLoansRaw: [
        null,
        { id: '', name: 'Без ID', reason: 'ошибка', raw },
        { id: 'bad-name', name: '', reason: 'ошибка', raw },
        { id: 'bad-reason', name: 'Без причины', reason: '', raw },
        { id: 'no-raw', name: 'Без raw', reason: 'ошибка' },
        { id: ' valid ', name: ' Сохранить ', reason: ' ошибка ', raw }
      ]
    }) as any

    expect(normalized.quarantinedLoansRaw).toEqual([{ id: 'valid', name: 'Сохранить', reason: 'ошибка', raw }])
  })

  it('скрывает отчёт без удаления raw-буфера карантина', () => {
    setStoreLoan(loanProfile())
    useLoanStore.setState({
      storageRecoveryReport: ['Кредит помещён в карантин'],
      quarantinedLoansRaw: [{ id: 'bad', name: 'Сбой', reason: 'ошибка', raw: { id: 'bad' } }],
      storageRecoveryDismissed: false
    })

    useLoanStore.getState().dismissStorageRecoveryReport()

    expect(useLoanStore.getState().storageRecoveryReport).toEqual(['Кредит помещён в карантин'])
    expect(useLoanStore.getState().quarantinedLoansRaw).toEqual([{ id: 'bad', name: 'Сбой', reason: 'ошибка', raw: { id: 'bad' } }])
    expect(useLoanStore.getState().storageRecoveryDismissed).toBe(true)

    useLoanStore.getState().showStorageRecoveryReport()
    expect(useLoanStore.getState().storageRecoveryDismissed).toBe(false)

    useLoanStore.getState().deleteQuarantinedLoans()
    expect(useLoanStore.getState().quarantinedLoansRaw).toEqual([])
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

  it('сохраняет правила с нулевой суммой или процентом как временно замороженные', () => {
    setStoreLoan(loanProfile())
    const zeroAmountRule = { ...rule(1), amount: 0 }
    const zeroPercentRule = { ...rule(2), type: 'paymentPercent' as const, amount: undefined, percent: 0 }

    useLoanStore.getState().addRepaymentRule(zeroAmountRule)
    useLoanStore.getState().addRepaymentRule(zeroPercentRule)

    const rules = useLoanStore.getState().repaymentRules
    expect(rules).toHaveLength(2)
    expect(rules[0]).toMatchObject({ id: 'rule-1', amount: 0 })
    expect(rules[1]).toMatchObject({ id: 'rule-2', percent: 0 })
    expect(expandRepaymentRules(defaultConfig, rules)).toEqual([])
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

  it('не теряет валидный хвост после повреждённого префикса в массивах', () => {
    const invalidRepayments = Array.from({ length: MAX_EARLY_REPAYMENTS }, (_, index) => ({ id: `bad-early-${index}`, date: '', amount: 1000, amountMode: 'extra', ...repaymentBase }))
    const invalidRules = Array.from({ length: MAX_REPAYMENT_RULES }, (_, index) => ({ ...rule(index), id: `bad-rule-${index}`, startDate: '', endDate: '2030-12-01' }))
    const invalidGrace = Array.from({ length: 100 }, (_, index) => ({ id: `bad-grace-${index}`, startDate: '', endDate: '2030-04-01', type: 'full', extendTerm: true, accrueInterest: true, capitalizeInterest: false }))
    const normalized = normalizePersistedState({
      repayments: [...invalidRepayments, { id: 'tail-early', date: defaultConfig.firstPaymentDate, amount: 7777, amountMode: 'extra', ...repaymentBase }],
      repaymentRules: [...invalidRules, { ...rule(10_001), id: 'tail-rule', startDate: defaultConfig.firstPaymentDate, endDate: '2030-12-01' }],
        gracePeriods: [...invalidGrace, { id: 'tail-grace', startDate: '2026-08-01', endDate: '2026-08-31', type: 'custom', paymentAmount: 1234, extendTerm: true, accrueInterest: true, capitalizeInterest: false }]
    }) as any

    expect(normalized.repayments).toHaveLength(1)
    expect(normalized.repayments[0]).toMatchObject({ id: 'tail-early', amount: 7777 })
    expect(normalized.repaymentRules).toHaveLength(1)
    expect(normalized.repaymentRules[0]).toMatchObject({ id: 'tail-rule' })
    expect(normalized.gracePeriods).toHaveLength(1)
    expect(normalized.gracePeriods[0]).toMatchObject({ id: 'tail-grace', paymentAmount: 1234 })
  })

  it('не теряет валидный tail кредита после повреждённых первых 100 записей', () => {
    const validLoan = { id: 'tail-loan', name: 'Хвост', config: defaultConfig, repayments: [], repaymentRules: [], gracePeriods: [], selectedScenario: 'reduceTerm', termUnit: 'months', displayDecimals: 2, appFontSize: 'normal', scheduleFontSize: 'large', theme: 'emerald' }
    const brokenPrefix = Array.from({ length: MAX_LOANS }, (_, index) => ({ id: `broken-${index}` }))
    const normalized = normalizePersistedState({ activeLoanId: 'tail-loan', loans: [...brokenPrefix, validLoan] }) as any

    expect(normalized.loans).toHaveLength(1)
    expect(normalized.loans[0].id).toBe('tail-loan')
    expect(normalized.activeLoanId).toBe('tail-loan')
  })
})

describe('применение плана цели', () => {
  const planOperations = (): GoalPlanOperations => ({
    repayments: [{
      ...repayment(10),
      id: 'goal-plan-one-time',
      date: '2026-08-15',
      amount: 100_000,
      comment: 'Добавлено планировщиком цели'
    }],
    repaymentRules: [{
      ...rule(10),
      id: 'goal-plan-monthlyFixed',
      name: 'Планировщик цели · ежемесячная доплата',
      amount: 8_700
    }]
  })

  const applyCurrent = (operations = planOperations()) => {
    const state = useLoanStore.getState()
    state.applyGoalPlan({
      expectedLoanId: state.activeLoanId,
      expectedConfig: state.config,
      expectedRepayments: state.repayments,
      expectedRepaymentRules: state.repaymentRules,
      expectedGracePeriods: state.gracePeriods,
      operations
    })
  }

  it('атомарно добавляет комбинированный план с новыми ID', () => {
    setStoreLoan(loanProfile({ selectedScenario: 'reducePayment' }))

    applyCurrent()
    const state = useLoanStore.getState()

    expect(state.repayments).toHaveLength(1)
    expect(state.repaymentRules).toHaveLength(1)
    expect(state.repayments[0].id).toMatch(/^goal-early-/)
    expect(state.repaymentRules[0].id).toMatch(/^goal-rule-/)
    expect(state.selectedScenario).toBe('combined')
    expect(currentCalculationErrors()).toBe('')
  })

  it('отклоняет устаревший результат после изменения кредита', () => {
    setStoreLoan(loanProfile())
    const stale = useLoanStore.getState()
    stale.updateConfig({ annualRate: stale.config.annualRate + 1 })

    expect(() => useLoanStore.getState().applyGoalPlan({
      expectedLoanId: stale.activeLoanId,
      expectedConfig: stale.config,
      expectedRepayments: stale.repayments,
      expectedRepaymentRules: stale.repaymentRules,
      expectedGracePeriods: stale.gracePeriods,
      operations: planOperations()
    })).toThrow('изменился')
    expect(useLoanStore.getState().repayments).toEqual([])
    expect(useLoanStore.getState().repaymentRules).toEqual([])
  })

  it('не применяет результат к другому активному кредиту', () => {
    const first = loanProfile({ id: 'loan-first', name: 'Первый' })
    const second = loanProfile({ id: 'loan-second', name: 'Второй' })
    useLoanStore.setState({ ...first, loans: [first, second], activeLoanId: first.id })
    const stale = useLoanStore.getState()
    stale.switchLoan(second.id)

    expect(() => useLoanStore.getState().applyGoalPlan({
      expectedLoanId: stale.activeLoanId,
      expectedConfig: stale.config,
      expectedRepayments: stale.repayments,
      expectedRepaymentRules: stale.repaymentRules,
      expectedGracePeriods: stale.gracePeriods,
      operations: planOperations()
    })).toThrow('изменился')
    expect(useLoanStore.getState().activeLoanId).toBe(second.id)
    expect(useLoanStore.getState().repayments).toEqual([])
    expect(useLoanStore.getState().loans.every(loan => loan.repayments.length === 0 && loan.repaymentRules.length === 0)).toBe(true)
  })

  it('не сохраняет ни одну часть конфликтующего плана', () => {
    const existingTotal = { ...rule(1), type: 'monthlyTotalPayment' as const, amount: 100_000, startDate: defaultConfig.firstPaymentDate, endDate: '2027-12-01' }
    setStoreLoan(loanProfile({ repaymentRules: [existingTotal] }))
    const conflict = planOperations()
    conflict.repaymentRules = [{ ...conflict.repaymentRules[0], type: 'monthlyTotalPayment', startDate: defaultConfig.firstPaymentDate, amount: 120_000 }]

    expect(() => applyCurrent(conflict)).toThrow('только одну общую сумму')
    expect(useLoanStore.getState().repayments).toEqual([])
    expect(useLoanStore.getState().repaymentRules).toEqual([existingTotal])
  })
})

describe('лимиты store до мутации', () => {
  it('не оставляет дату первого платежа раньше или в день выдачи при изменении параметров', () => {
    setStoreLoan(loanProfile())
    useLoanStore.getState().updateConfig({ issueDate: '2026-08-01' })

    expect(useLoanStore.getState().config.firstPaymentDate > useLoanStore.getState().config.issueDate).toBe(true)
  })

  it('отклоняет перенос даты выдачи после существующего досрочного платежа', () => {
    const config = { ...defaultConfig, issueDate: '2026-07-01', firstPaymentDate: '2026-08-15', paymentDay: 15 }
    const early = { ...repayment(1), date: '2026-08-01' }
    setStoreLoan(loanProfile({ config, repayments: [early] }))

    expect(() => useLoanStore.getState().updateConfig({ issueDate: '2026-09-01' })).toThrow('дата раньше выдачи')
    expect(useLoanStore.getState().config).toEqual(config)
    expect(useLoanStore.getState().loans[0].config).toEqual(config)
    expect(useLoanStore.getState().repayments).toEqual([early])
  })

  it('не переводит totalWithFee в extra при изменении календаря платежей', () => {
    const config = { ...defaultConfig, issueDate: '2026-06-23', firstPaymentDate: '2026-07-15', paymentDay: 15, frequency: 'monthly' as const }
    const totalPayment = { ...repayment(1), date: '2026-08-15', amount: 500000, amountMode: 'totalWithFee' as const, sameDayOrder: 'regularFirst' as const }
    const activeLoan = loanProfile({ config, repayments: [totalPayment] })
    setStoreLoan(activeLoan)

    expect(() => useLoanStore.getState().updateConfig({ frequency: 'quarterly' })).toThrow('дату регулярного платежа')
    expect(useLoanStore.getState().config).toEqual(config)
    expect(useLoanStore.getState().repayments[0]).toMatchObject({ amountMode: 'totalWithFee' })

    const recovered = normalizePersistedState({ loans: useLoanStore.getState().loans, activeLoanId: activeLoan.id }) as any
    expect(recovered.repayments[0]).toMatchObject({ amountMode: 'totalWithFee' })
  })

  it('не создаёт 101-й кредит', () => {
    const loans = Array.from({ length: MAX_LOANS }, (_, index) => loanProfile({ id: `loan-${index}`, name: `Кредит ${index}` }))
    const normalized = normalizePersistedState({ loans, activeLoanId: loans[0].id }) as Partial<ReturnType<typeof useLoanStore.getState>>
    useLoanStore.setState(normalized)
    expect(() => useLoanStore.getState().createLoan()).toThrow(String(MAX_LOANS))
    expect(useLoanStore.getState().loans).toHaveLength(MAX_LOANS)
  })

  it('создаёт независимую копию существующего кредита и переключается на неё', () => {
    const source = loanProfile({
      id: 'loan-source',
      name: 'Исходный кредит',
      config: { ...defaultConfig, principal: 7_500_000, rateChanges: [{ id: 'rate-1', date: '2030-02-01', annualRate: 8 }] },
      repayments: [repayment(1)],
      repaymentRules: [rule(1)],
      gracePeriods: [{ id: 'grace-1', startDate: '2026-08-01', endDate: '2026-08-31', type: 'interestOnly', extendTerm: true, accrueInterest: true, capitalizeInterest: false }],
      selectedScenario: 'reducePayment',
      theme: 'ocean'
    })
    setStoreLoan(source)

    useLoanStore.getState().createLoan('Новый сценарий', source.id)

    const state = useLoanStore.getState()
    const copied = state.loans.find(loan => loan.id === state.activeLoanId)!
    expect(state.loans).toHaveLength(2)
    expect(copied).toMatchObject({
      name: 'Новый сценарий',
      config: source.config,
      repayments: source.repayments,
      repaymentRules: source.repaymentRules,
      gracePeriods: source.gracePeriods,
      selectedScenario: source.selectedScenario,
      theme: source.theme
    })
    expect(copied.id).not.toBe(source.id)
    expect(copied.config).not.toBe(source.config)
    expect(copied.config.rateChanges).not.toBe(source.config.rateChanges)
    expect(copied.repayments).not.toBe(source.repayments)
    expect(copied.repaymentRules).not.toBe(source.repaymentRules)
    expect(copied.gracePeriods).not.toBe(source.gracePeriods)

    useLoanStore.getState().updateConfig({ principal: 6_000_000 })
    expect(useLoanStore.getState().loans.find(loan => loan.id === source.id)?.config.principal).toBe(7_500_000)
    expect(useLoanStore.getState().config.principal).toBe(6_000_000)
  })

  it('не создаёт копию из отсутствующего кредита', () => {
    setStoreLoan(loanProfile())

    expect(() => useLoanStore.getState().createLoan('Копия', 'missing-loan')).toThrow('не найден')
    expect(useLoanStore.getState().loans).toHaveLength(1)
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

  it('не добавляет структурно повреждённое правило', () => {
    setStoreLoan(loanProfile())

    expect(() => useLoanStore.getState().addRepaymentRule({ ...rule(1), startDate: 'broken-date' })).toThrow('дата начала')

    expect(useLoanStore.getState().repaymentRules).toEqual([])
  })

  it('не обновляет правило повреждёнными данными', () => {
    const existingRule = rule(1)
    setStoreLoan(loanProfile({ repaymentRules: [existingRule] }))

    expect(() => useLoanStore.getState().updateRepaymentRule({ ...existingRule, amount: Number.NaN })).toThrow('сумма')

    expect(useLoanStore.getState().repaymentRules).toEqual([existingRule])
  })

  it('сохраняет конфликтующие monthlyTotalPayment rules до полного async-расчёта', () => {
    setStoreLoan(loanProfile())
    const first = { ...rule(1), type: 'monthlyTotalPayment' as const, amount: 100000, startDate: defaultConfig.firstPaymentDate, endDate: defaultConfig.firstPaymentDate }
    const second = { ...rule(2), type: 'monthlyTotalPayment' as const, amount: 110000, startDate: defaultConfig.firstPaymentDate, endDate: defaultConfig.firstPaymentDate }
    useLoanStore.getState().addRepaymentRule(first)
    useLoanStore.getState().addRepaymentRule(second)

    expect(useLoanStore.getState().repaymentRules).toHaveLength(2)
    expect(currentCalculationErrors()).toContain('только одну общую сумму')
  })

  it('сохраняет total rule, конфликтующее с ручной total-операцией, до полного async-расчёта', () => {
    setStoreLoan(loanProfile({ repayments: [{ ...repayment(1), amount: 100000, amountMode: 'totalWithFee', sameDayOrder: 'regularFirst' }] }))
    const totalRule = { ...rule(1), type: 'monthlyTotalPayment' as const, amount: 110000, startDate: defaultConfig.firstPaymentDate, endDate: defaultConfig.firstPaymentDate }

    useLoanStore.getState().addRepaymentRule(totalRule)

    expect(useLoanStore.getState().repaymentRules).toHaveLength(1)
    expect(currentCalculationErrors()).toContain('только одну общую сумму')
  })

  it('сохраняет нулевое total rule рядом с ручной общей суммой', () => {
    setStoreLoan(loanProfile({ repayments: [{ ...repayment(1), amount: 100000, amountMode: 'totalWithFee', sameDayOrder: 'regularFirst' }] }))
    const frozenTotalRule = { ...rule(1), type: 'monthlyTotalPayment' as const, amount: 0, startDate: defaultConfig.firstPaymentDate, endDate: defaultConfig.firstPaymentDate }

    useLoanStore.getState().addRepaymentRule(frozenTotalRule)

    expect(useLoanStore.getState().repaymentRules).toHaveLength(1)
    expect(expandRepaymentRules(defaultConfig, useLoanStore.getState().repaymentRules)).toEqual([])
  })

  it('не сохраняет ручную total-операцию, конфликтующую с существующей', () => {
    const activeTotal = { ...repayment(1), amount: 100000, amountMode: 'totalWithFee' as const, sameDayOrder: 'regularFirst' as const, sameDaySequence: 0 }
    const disabledTotal = { ...repayment(2), id: 'disabled-total', amount: 110000, amountMode: 'totalWithFee' as const, enabled: false, sameDayOrder: 'regularFirst' as const, sameDaySequence: 1 }
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

  it('не мутирует активный кредит при невалидном импорте', () => {
    const activeLoan = loanProfile({ repayments: [repayment(1)] })
    setStoreLoan(activeLoan)
    const before = useLoanStore.getState()

    expect(() => useLoanStore.getState().replaceData({
      config: defaultConfig,
      repayments: [{ ...repayment(2), amount: 1, amountMode: 'totalWithFee', sameDayOrder: 'regularFirst' }],
      repaymentRules: [],
      gracePeriods: [],
      selectedScenario: 'combined',
      termUnit: 'months',
      displayDecimals: 2,
      theme: 'emerald'
    })).toThrow('не меньше обязательного платежа')

    expect(useLoanStore.getState().config).toEqual(before.config)
    expect(useLoanStore.getState().repayments).toEqual(before.repayments)
    expect(useLoanStore.getState().loans).toEqual(before.loans)
  })

  it('не добавляет пересекающиеся льготные периоды', () => {
    const first = { id: 'g1', startDate: '2026-05-01', endDate: '2026-05-31', type: 'full', extendTerm: true, accrueInterest: true, capitalizeInterest: false } as const
    const second = { id: 'g2', startDate: '2026-05-15', endDate: '2026-06-15', type: 'interestOnly', extendTerm: true, accrueInterest: true, capitalizeInterest: false } as const
    setStoreLoan(loanProfile({ gracePeriods: [first] }))
    expect(() => useLoanStore.getState().addGrace(second)).toThrow('не должны пересекаться')
    expect(useLoanStore.getState().gracePeriods).toHaveLength(1)
  })

  it('добавляет льготный период до полного async-расчёта, даже если он делает общий платёж невалидным', () => {
    const totalRule = { ...rule(1), type: 'monthlyTotalPayment' as const, amount: 10000, startDate: defaultConfig.firstPaymentDate, endDate: defaultConfig.firstPaymentDate }
    const invalidGrace = { id: 'g-invalid', startDate: defaultConfig.firstPaymentDate, endDate: defaultConfig.firstPaymentDate, type: 'custom' as const, paymentAmount: 20000, extendTerm: true, accrueInterest: true, capitalizeInterest: false }
    setStoreLoan(loanProfile({ repaymentRules: [totalRule] }))

    useLoanStore.getState().addGrace(invalidGrace)

    expect(useLoanStore.getState().gracePeriods).toHaveLength(1)
    expect(currentCalculationErrors()).toContain('не меньше обязательного платежа')
  })

  it('удаляет льготный период до полного async-расчёта, даже если без него общий платёж становится невалидным', () => {
    const totalRule = { ...rule(1), type: 'monthlyTotalPayment' as const, amount: 10000, startDate: defaultConfig.firstPaymentDate, endDate: defaultConfig.firstPaymentDate }
    const requiredGrace = { id: 'g-required', startDate: defaultConfig.firstPaymentDate, endDate: defaultConfig.firstPaymentDate, type: 'custom' as const, paymentAmount: 5000, extendTerm: true, accrueInterest: true, capitalizeInterest: false }
    setStoreLoan(loanProfile({ repaymentRules: [totalRule], gracePeriods: [requiredGrace] }))

    useLoanStore.getState().removeGrace(requiredGrace.id)

    expect(useLoanStore.getState().gracePeriods).toHaveLength(0)
    expect(currentCalculationErrors()).toContain('не меньше обязательного платежа')
  })

  it('строит примерный кредит с актуальными датами и валидным досрочным платежом', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2030, 6, 4))
    setStoreLoan(loanProfile())

    useLoanStore.getState().loadExampleLoan()

    const state = useLoanStore.getState()
    expect(state.config.issueDate).toBe('2030-07-04')
    expect(state.repayments[0].date > state.config.issueDate).toBe(true)
    expect(validateScenario(state.config, state.repayments, state.gracePeriods)).toEqual([])
    vi.useRealTimers()
  })
})
