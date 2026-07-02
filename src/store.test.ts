import { describe, expect, it } from 'vitest'
import { defaultConfig, normalizePersistedState } from './store'

const repaymentBase = {
  strategy: 'reduceTerm',
  source: 'own',
  sameDayOrder: 'earlyFirst',
  interestFirst: true
} as const

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
})
