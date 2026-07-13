import { describe, expect, it } from 'vitest'
import { parseLoanBackup } from './importExport'
import { MAX_ID_LENGTH, MAX_RATE_CHANGES, MAX_REPAYMENT_RULES, MAX_RULE_SKIP_MONTHS } from './loanEngine/limits'
import { defaultConfig } from './store'

const repayment = { id: 'early-1', date: defaultConfig.firstPaymentDate, amount: 8704.99, amountMode: 'extra', strategy: 'reduceTerm', source: 'own', sameDayOrder: 'regularFirst', interestFirst: true }

describe('импорт резервной копии', () => {
  it('принимает текущую версию JSON и legacy-файл без поля version', () => {
    expect(parseLoanBackup(JSON.stringify({ version: 1, config: defaultConfig }))).toMatchObject({ config: defaultConfig })
    expect(parseLoanBackup(JSON.stringify({ config: defaultConfig }))).toMatchObject({ config: defaultConfig })
  })

  it('отклоняет явно указанную неизвестную версию JSON', () => {
    expect(() => parseLoanBackup(JSON.stringify({ version: 2, config: defaultConfig }))).toThrow('Версия JSON-резервной копии 2 не поддерживается')
    expect(() => parseLoanBackup(JSON.stringify({ version: '1', config: defaultConfig }))).toThrow('Версия JSON-резервной копии 1 не поддерживается')
  })

  it('восстанавливает расчёт и настройки интерфейса', () => {
    const result = parseLoanBackup(JSON.stringify({ config: defaultConfig, repayments: [repayment], gracePeriods: [], selectedScenario: 'reducePayment', settings: { termUnit: 'years', displayDecimals: 0, theme: 'ocean' } }))
    expect(result.repayments[0].amount).toBe(8704.99)
    expect(result.selectedScenario).toBe('reducePayment')
    expect(result.repaymentRules).toEqual([])
    expect(result.termUnit).toBe('years')
    expect(result.displayDecimals).toBe(0)
    expect(result.theme).toBe('ocean')
  })

  it('поддерживает JSON старого формата', () => {
    const result = parseLoanBackup(JSON.stringify({ config: defaultConfig, repayments: [repayment], scenario: { id: 'reduceTerm', schedule: [] } }))
    expect(result.selectedScenario).toBe('reduceTerm')
    expect(result.gracePeriods).toEqual([])
    expect(result.repaymentRules).toEqual([])
  })

  it('подставляет значения по умолчанию для полей, отсутствующих в старом JSON', () => {
    const legacyConfig = {
      principal: defaultConfig.principal,
      annualRate: defaultConfig.annualRate,
      issueDate: defaultConfig.issueDate,
      firstPaymentDate: defaultConfig.firstPaymentDate,
      termMonths: defaultConfig.termMonths,
      paymentDay: defaultConfig.paymentDay,
      currency: defaultConfig.currency,
      closeThreshold: defaultConfig.closeThreshold,
      oneTimeFee: defaultConfig.oneTimeFee,
      monthlyFee: defaultConfig.monthlyFee,
      earlyRepaymentFeePercent: defaultConfig.earlyRepaymentFeePercent
    }
    const result = parseLoanBackup(JSON.stringify({ config: legacyConfig, repayments: [], scenario: { id: 'reduceTerm', schedule: [] } }))
    expect(result.config.firstPaymentInterestOnly).toBe(defaultConfig.firstPaymentInterestOnly)
    expect(result.config.paymentType).toBe(defaultConfig.paymentType)
    expect(result.config.frequency).toBe(defaultConfig.frequency)
    expect(result.config.rounding).toBe(defaultConfig.rounding)
    expect(result.config.rateChanges).toEqual([])
    expect(result.config.rateChangeMode).toBe(defaultConfig.rateChangeMode)
    expect(result.config.interest).toEqual(defaultConfig.interest)
  })

  it('восстанавливает и сортирует историю изменения ставки', () => {
    const rateChanges = [
      { id: 'rate-2', date: '2026-10-26', annualRate: 7.5 },
      { id: 'rate-1', date: '2026-08-26', annualRate: 8.2 }
    ]
    const result = parseLoanBackup(JSON.stringify({ config: { ...defaultConfig, rateChanges }, repayments: [], gracePeriods: [], selectedScenario: 'combined' }))
    expect(result.config.rateChanges).toEqual([rateChanges[1], rateChanges[0]])
  })

  it('восстанавливает режим применения изменения ставки', () => {
    const result = parseLoanBackup(JSON.stringify({ config: { ...defaultConfig, rateChangeMode: 'exactDate' }, repayments: [], gracePeriods: [], selectedScenario: 'combined' }))
    expect(result.config.rateChangeMode).toBe('exactDate')
  })

  it('отклоняет повреждённую историю изменения ставки', () => {
    expect(() => parseLoanBackup(JSON.stringify({ config: { ...defaultConfig, rateChangeMode: 'broken' }, repayments: [], gracePeriods: [] }))).toThrow('Режим изменения ставки')
    expect(() => parseLoanBackup(JSON.stringify({ config: { ...defaultConfig, rateChanges: [{ id: 'rate-1', date: '2026-08-26', annualRate: 101 }] }, repayments: [], gracePeriods: [] }))).toThrow('изменении ставки')
    expect(() => parseLoanBackup(JSON.stringify({ config: { ...defaultConfig, rateChanges: [{ id: 'rate-1', date: defaultConfig.issueDate, annualRate: 8 }] }, repayments: [], gracePeriods: [] }))).toThrow('после выдачи')
    expect(() => parseLoanBackup(JSON.stringify({ config: { ...defaultConfig, rateChanges: [{ id: 'rate-1', date: '2026-08-26', annualRate: 8 }, { id: 'rate-2', date: '2026-08-26', annualRate: 9 }] }, repayments: [], gracePeriods: [] }))).toThrow('дублирующийся ID: 2026-08-26')
  })

  it('восстанавливает правила досрочных платежей', () => {
    const rule = { id: 'rule-1', name: 'Ежемесячно', ruleSequence: 3, type: 'monthlyFixed', startDate: '2026-08-15', endDate: '2026-12-15', amount: 20000, strategy: 'reduceTerm', source: 'own', sameDayOrder: 'regularFirst', interestFirst: true, skipMonths: ['2026-09', '2026-09'] }
    const result = parseLoanBackup(JSON.stringify({ config: defaultConfig, repayments: [], repaymentRules: [rule], gracePeriods: [], selectedScenario: 'combined' }))
    expect(result.repaymentRules[0]).toMatchObject({ ...rule, skipMonths: ['2026-09'] })
  })

  it('отклоняет дублирующийся порядок досрочных платежей в одну дату', () => {
    expect(() => parseLoanBackup(JSON.stringify({ config: defaultConfig, repayments: [
      { ...repayment, id: 'early-1', sameDaySequence: 0 },
      { ...repayment, id: 'early-2', sameDaySequence: 0 }
    ], gracePeriods: [], selectedScenario: 'combined' }))).toThrow('дублирующийся порядок')
  })

  it('отклоняет дублирующийся порядок правил досрочных платежей', () => {
    const firstRule = { id: 'rule-1', name: 'Первое', ruleSequence: 0, type: 'monthlyFixed', startDate: '2026-08-15', endDate: '2026-12-15', amount: 20000, strategy: 'reduceTerm', source: 'own', sameDayOrder: 'regularFirst', interestFirst: true, skipMonths: [] }
    const secondRule = { ...firstRule, id: 'rule-2', name: 'Второе' }

    expect(() => parseLoanBackup(JSON.stringify({ config: defaultConfig, repayments: [], repaymentRules: [firstRule, secondRule], gracePeriods: [], selectedScenario: 'combined' }))).toThrow('дублирующийся порядок')
  })

  it('отклоняет импорт с платежом раньше даты выдачи', () => {
    expect(() => parseLoanBackup(JSON.stringify({
      config: defaultConfig,
      repayments: [{ ...repayment, date: '2026-06-01' }],
      repaymentRules: [],
      gracePeriods: [],
      selectedScenario: 'combined'
    }))).toThrow('раньше выдачи')
  })

  it('отклоняет слишком большой массив месяцев пропуска', () => {
    const skipMonths = Array.from({ length: MAX_RULE_SKIP_MONTHS + 1 }, (_, index) => `20${String(Math.floor(index / 12) + 30).padStart(2, '0')}-${String(index % 12 + 1).padStart(2, '0')}`)
    const rule = { id: 'rule-big-skip', name: 'Много пропусков', type: 'monthlyFixed', startDate: '2026-08-15', endDate: '2026-12-15', amount: 20000, strategy: 'reduceTerm', source: 'own', sameDayOrder: 'regularFirst', interestFirst: true, skipMonths }

    expect(() => parseLoanBackup(JSON.stringify({ config: defaultConfig, repayments: [], repaymentRules: [rule], gracePeriods: [], selectedScenario: 'combined' }))).toThrow(String(MAX_RULE_SKIP_MONTHS))
  })

  it('отклоняет импорт с количеством изменений ставки сверх лимита', () => {
    const rateChanges = Array.from({ length: MAX_RATE_CHANGES + 1 }, (_, index) => ({ id: `rate-${index}`, date: `2030-${String(Math.floor(index / 28) % 12 + 1).padStart(2, '0')}-${String(index % 28 + 1).padStart(2, '0')}`, annualRate: 7 }))
    expect(() => parseLoanBackup(JSON.stringify({ config: { ...defaultConfig, rateChanges }, repayments: [], gracePeriods: [], selectedScenario: 'combined' }))).toThrow(String(MAX_RATE_CHANGES))
  })

  it('восстанавливает расширенные правила досрочных платежей', () => {
    const rules = [
      { id: 'rule-week', name: 'Раз в неделю', type: 'weeklyFixed', startDate: '2026-08-15', endDate: '2026-09-15', amount: 20000, strategy: 'reduceTerm', source: 'own', sameDayOrder: 'regularFirst', interestFirst: true, skipMonths: [] },
      { id: 'rule-two-months', name: 'Раз в 2 месяца', type: 'bimonthlyFixed', startDate: '2026-08-15', endDate: '2026-12-15', amount: 20000, strategy: 'reduceTerm', source: 'own', sameDayOrder: 'regularFirst', interestFirst: true, skipMonths: [] },
      { id: 'rule-quarter', name: 'Квартал', type: 'quarterlyFixed', startDate: '2026-08-15', endDate: '2026-12-15', amount: 20000, strategy: 'reduceTerm', source: 'own', sameDayOrder: 'regularFirst', interestFirst: true, skipMonths: [] },
      { id: 'rule-half-year', name: 'Полгода', type: 'semiannualFixed', startDate: '2026-08-15', endDate: '2027-08-15', amount: 20000, strategy: 'reduceTerm', source: 'own', sameDayOrder: 'regularFirst', interestFirst: true, skipMonths: [] },
      { id: 'rule-year', name: 'Год', type: 'annualFixed', startDate: '2026-08-15', endDate: '2028-08-15', amount: 20000, strategy: 'reduceTerm', source: 'own', sameDayOrder: 'regularFirst', interestFirst: true, skipMonths: [] },
      { id: 'rule-total', name: 'Итого каждый месяц', type: 'monthlyTotalPayment', startDate: '2026-08-15', endDate: '2026-12-15', amount: 100000, strategy: 'reduceTerm', source: 'own', sameDayOrder: 'earlyFirst', interestFirst: true, skipMonths: [] }
    ]
    const result = parseLoanBackup(JSON.stringify({ config: defaultConfig, repayments: [], repaymentRules: rules, gracePeriods: [], selectedScenario: 'combined' }))
    expect(result.repaymentRules.map(rule => rule.type)).toEqual(['weeklyFixed', 'bimonthlyFixed', 'quarterlyFixed', 'semiannualFixed', 'annualFixed', 'monthlyTotalPayment'])
    expect(result.repaymentRules.at(-1)).toMatchObject({ type: 'monthlyTotalPayment', sameDayOrder: 'regularFirst' })
  })

  it('восстанавливает временно отключенные досрочные платежи и правила', () => {
    const disabledRepayment = { ...repayment, enabled: false, amountMode: 'totalWithFee', sameDayOrder: 'earlyFirst' }
    const disabledRule = { id: 'rule-off', name: 'Пауза', type: 'monthlyFixed', startDate: '2026-08-15', endDate: '2026-12-15', amount: 20000, enabled: false, strategy: 'reduceTerm', source: 'own', sameDayOrder: 'regularFirst', interestFirst: true, skipMonths: [] }
    const result = parseLoanBackup(JSON.stringify({ config: defaultConfig, repayments: [disabledRepayment], repaymentRules: [disabledRule], gracePeriods: [], selectedScenario: 'combined' }))
    expect(result.repayments[0]).toMatchObject({ amount: 8704.99, enabled: false })
    expect(result.repaymentRules[0]).toMatchObject({ amount: 20000, enabled: false })
  })

  it('восстанавливает правила с нулевой суммой или процентом', () => {
    const zeroAmountRule = { id: 'rule-zero-amount', name: 'Пауза', type: 'monthlyFixed', startDate: '2026-08-15', endDate: '2026-12-15', amount: 0, strategy: 'reduceTerm', source: 'own', sameDayOrder: 'regularFirst', interestFirst: true, skipMonths: [] }
    const zeroPercentRule = { id: 'rule-zero-percent', name: 'Пауза процента', type: 'paymentPercent', startDate: '2026-08-15', endDate: '2026-12-15', percent: 0, strategy: 'reducePayment', source: 'own', sameDayOrder: 'regularFirst', interestFirst: true, skipMonths: [] }
    const result = parseLoanBackup(JSON.stringify({ config: defaultConfig, repayments: [], repaymentRules: [zeroAmountRule, zeroPercentRule], gracePeriods: [], selectedScenario: 'combined' }))

    expect(result.repaymentRules).toHaveLength(2)
    expect(result.repaymentRules[0]).toMatchObject({ id: 'rule-zero-amount', amount: 0 })
    expect(result.repaymentRules[1]).toMatchObject({ id: 'rule-zero-percent', percent: 0 })
  })

  it('отклоняет импорт с количеством правил сверх лимита', () => {
    const rules = Array.from({ length: MAX_REPAYMENT_RULES + 1 }, (_, index) => ({ id: `rule-${index}`, name: 'Ежемесячно', type: 'monthlyFixed', startDate: '2026-02-26', endDate: '2026-12-26', amount: 20000, strategy: 'reduceTerm', source: 'own', sameDayOrder: 'regularFirst', interestFirst: true, skipMonths: [] }))
    expect(() => parseLoanBackup(JSON.stringify({ config: defaultConfig, repayments: [], repaymentRules: rules, gracePeriods: [], selectedScenario: 'combined' }))).toThrow('Слишком много правил')
  })

  it('отклоняет повреждённый файл', () => {
    expect(() => parseLoanBackup('{broken')).toThrow('корректным JSON')
    expect(() => parseLoanBackup(JSON.stringify({ repayments: [] }))).toThrow('параметры кредита')
  })

  it('преобразует только известный legacy-код валюты с предупреждением', () => {
    const result = parseLoanBackup(JSON.stringify({ config: { ...defaultConfig, currency: 'RUR' }, repayments: [], gracePeriods: [] }))

    expect(result.config.currency).toBe(defaultConfig.currency)
    expect(result.importWarnings).toEqual(['Legacy-код валюты RUR преобразован в RUB без конвертации суммы'])
    expect(() => parseLoanBackup(JSON.stringify({ config: { ...defaultConfig, currency: 'NOT-A-CURRENCY' } }))).toThrow('не поддерживается')
  })

  it('мигрирует дублирующую legacy-базу 365 в Actual/365', () => {
    const legacy = { ...defaultConfig, interest: { ...defaultConfig.interest, dayCountBasis: '365' } }
    const result = parseLoanBackup(JSON.stringify({ config: legacy, repayments: [], gracePeriods: [] }))

    expect(result.config.interest.dayCountBasis).toBe('actual365')
    expect(result.importWarnings).toContain('Legacy-база 365 преобразована в однозначную Actual/365 без изменения расчёта')
  })

  it.each([
    ['тип платежа', { paymentType: 'broken' }],
    ['частоту', { frequency: 'broken' }],
    ['округление', { rounding: 'broken' }],
    ['режим ставки', { rateChangeMode: 'broken' }],
    ['boolean первого платежа', { firstPaymentInterestOnly: 'true' }],
    ['метод процентов', { interest: { ...defaultConfig.interest, method: 'broken' } }],
    ['day-count basis', { interest: { ...defaultConfig.interest, dayCountBasis: 'broken' } }],
    ['boolean даты платежа', { interest: { ...defaultConfig.interest, includePaymentDate: 1 } }]
  ])('отклоняет явно повреждённое финансовое поле: %s', (_label, patch) => {
    expect(() => parseLoanBackup(JSON.stringify({ config: { ...defaultConfig, ...patch } }))).toThrow('недопустимое значение')
  })

  it('предупреждает о допустимых legacy-преобразованиях amountMode', () => {
    const withoutMode = { ...repayment } as Record<string, unknown>
    delete withoutMode.amountMode
    withoutMode.amount = 100_000
    const result = parseLoanBackup(JSON.stringify({ config: defaultConfig, repayments: [withoutMode, { ...repayment, id: 'legacy-total', date: '2026-08-15', amount: 100_000, sameDaySequence: 1, amountMode: 'total' }] }))
    expect(result.importWarnings).toEqual([
      'Ошибка в досрочном платеже №1: отсутствующий legacy amountMode преобразован в totalWithFee',
      'Ошибка в досрочном платеже №2: legacy amountMode total преобразован в totalWithFee'
    ])
  })

  it('предупреждает о валюте по умолчанию для старого файла без валюты', () => {
    const legacyConfig = { ...defaultConfig } as Record<string, unknown>
    delete legacyConfig.currency
    const result = parseLoanBackup(JSON.stringify({ config: legacyConfig, repayments: [], gracePeriods: [] }))

    expect(result.config.currency).toBe(defaultConfig.currency)
    expect(result.importWarnings).toEqual(['В файле не указана валюта, используется RUB'])
  })

  it('отклоняет невозможные календарные даты', () => {
    expect(() => parseLoanBackup(JSON.stringify({ config: { ...defaultConfig, issueDate: '2024-02-31' }, repayments: [], gracePeriods: [] }))).toThrow('даты')
  })

  it('отклоняет слишком длинный срок', () => {
    expect(() => parseLoanBackup(JSON.stringify({ config: { ...defaultConfig, termMonths: 1201 }, repayments: [], gracePeriods: [] }))).toThrow('недопустимые числа')
  })

  it('отклоняет нулевую сумму кредита и дробные календарные поля', () => {
    expect(() => parseLoanBackup(JSON.stringify({ config: { ...defaultConfig, principal: 0 }, repayments: [], gracePeriods: [] }))).toThrow('недопустимые числа')
    expect(() => parseLoanBackup(JSON.stringify({ config: { ...defaultConfig, termMonths: 12.5 }, repayments: [], gracePeriods: [] }))).toThrow('недопустимые числа')
    expect(() => parseLoanBackup(JSON.stringify({ config: { ...defaultConfig, paymentDay: 15.7 }, repayments: [], gracePeriods: [] }))).toThrow('недопустимые числа')
  })

  it('отклоняет Number.MAX_VALUE и чрезмерные суммы операций', () => {
    expect(() => parseLoanBackup(JSON.stringify({ config: { ...defaultConfig, principal: Number.MAX_VALUE } }))).toThrow('недопустимые числа')
    expect(() => parseLoanBackup(JSON.stringify({ config: defaultConfig, repayments: [{ ...repayment, amount: Number.MAX_VALUE }] }))).toThrow('досрочном платеже')
  })

  it('отклоняет комиссию за досрочное погашение выше 100%', () => {
    expect(() => parseLoanBackup(JSON.stringify({ config: { ...defaultConfig, earlyRepaymentFeePercent: 150 }, repayments: [], gracePeriods: [] }))).toThrow('недопустимые числа')
  })

  it('отклоняет неизвестный выбранный сценарий', () => {
    expect(() => parseLoanBackup(JSON.stringify({ config: defaultConfig, repayments: [], gracePeriods: [], selectedScenario: 'broken' }))).toThrow('неизвестный сценарий')
  })

  it('отклоняет общую сумму строки банка с порядком earlyFirst', () => {
    expect(() => parseLoanBackup(JSON.stringify({ config: defaultConfig, repayments: [{ ...repayment, amountMode: 'totalWithFee', sameDayOrder: 'earlyFirst' }], gracePeriods: [] }))).toThrow('общая сумма')
  })

  it('отклоняет общую сумму строки банка не в дату регулярного платежа', () => {
    const config = { ...defaultConfig, issueDate: '2026-01-01', firstPaymentDate: '2026-01-26', paymentDay: 26 }
    expect(() => parseLoanBackup(JSON.stringify({ config, repayments: [{ ...repayment, date: '2026-01-27', amountMode: 'totalWithFee', sameDayOrder: 'regularFirst' }], gracePeriods: [] }))).toThrow('дату регулярного платежа')
  })

  it('нормализует legacy amountMode до preview и не допускает две общие суммы на дату', () => {
    const config = { ...defaultConfig, issueDate: '2026-01-01', firstPaymentDate: '2026-01-26', paymentDay: 26 }
    const legacy = parseLoanBackup(JSON.stringify({ config, repayments: [{ ...repayment, date: '2026-01-26', amount: 100000, amountMode: undefined }], gracePeriods: [] }))
    expect(legacy.repayments[0]).toMatchObject({ amountMode: 'totalWithFee', sameDayOrder: 'regularFirst' })
    expect(() => parseLoanBackup(JSON.stringify({ config, repayments: [
      { ...repayment, id: 'total-1', date: '2026-01-26', amountMode: 'totalWithFee', sameDayOrder: 'regularFirst' },
      { ...repayment, id: 'total-2', date: '2026-01-26', amountMode: 'totalWithFee', sameDayOrder: 'regularFirst' }
    ], gracePeriods: [] }))).toThrow('дублирующийся ID: 2026-01-26')
  })

  it('отклоняет дублирующиеся ID в импортируемых коллекциях', () => {
    const grace = { id: 'same', startDate: '2026-08-01', endDate: '2026-08-31', type: 'full', extendTerm: true, accrueInterest: true, capitalizeInterest: false }
    expect(() => parseLoanBackup(JSON.stringify({ config: defaultConfig, repayments: [{ ...repayment, id: 'same' }, { ...repayment, id: 'same' }], gracePeriods: [] }))).toThrow('дублирующийся ID')
    expect(() => parseLoanBackup(JSON.stringify({ config: defaultConfig, repayments: [], gracePeriods: [grace, grace] }))).toThrow('дублирующийся ID')
  })

  it('отклоняет нестроковый комментарий до передачи данных в React', () => {
    expect(() => parseLoanBackup(JSON.stringify({
      config: defaultConfig,
      repayments: [{ ...repayment, comment: { text: 'не строка' } }]
    }))).toThrow('Комментарий досрочного платежа №1 должно быть строкой')
  })

  it('ограничивает длину всех импортируемых ID', () => {
    const longId = 'x'.repeat(MAX_ID_LENGTH + 1)
    const rule = { id: longId, name: 'Правило', type: 'monthlyFixed', startDate: '2026-08-15', endDate: '2026-12-15', amount: 20000, strategy: 'reduceTerm', source: 'own', sameDayOrder: 'regularFirst', interestFirst: true, skipMonths: [] }
    const grace = { id: longId, startDate: '2026-08-01', endDate: '2026-08-31', type: 'full', extendTerm: true, accrueInterest: true, capitalizeInterest: false }
    expect(() => parseLoanBackup(JSON.stringify({ config: { ...defaultConfig, rateChanges: [{ id: longId, date: '2026-08-26', annualRate: 8 }] } }))).toThrow(String(MAX_ID_LENGTH))
    expect(() => parseLoanBackup(JSON.stringify({ config: defaultConfig, repayments: [{ ...repayment, id: longId }] }))).toThrow(String(MAX_ID_LENGTH))
    expect(() => parseLoanBackup(JSON.stringify({ config: defaultConfig, repayments: [], repaymentRules: [rule] }))).toThrow(String(MAX_ID_LENGTH))
    expect(() => parseLoanBackup(JSON.stringify({ config: defaultConfig, repayments: [], gracePeriods: [grace] }))).toThrow(String(MAX_ID_LENGTH))
  })

  it('проецирует только известные поля во всех вложенных объектах', () => {
    const rule = { id: 'rule-safe', name: 'Правило', type: 'monthlyFixed', startDate: '2026-08-15', endDate: '2026-12-15', amount: 20000, strategy: 'reduceTerm', source: 'own', sameDayOrder: 'regularFirst', interestFirst: true, skipMonths: [], unknownRule: 'drop' }
    const grace = { id: 'grace-safe', startDate: '2026-08-01', endDate: '2026-08-14', type: 'full', extendTerm: true, accrueInterest: true, capitalizeInterest: false, unknownGrace: 'drop' }
    const result = parseLoanBackup(JSON.stringify({
      version: 1,
      config: { ...defaultConfig, unknownConfig: 'drop', interest: { ...defaultConfig.interest, unknownInterest: 'drop' }, rateChanges: [{ id: 'rate-safe', date: '2026-08-26', annualRate: 8, unknownRate: 'drop' }] },
      repayments: [{ ...repayment, unknownRepayment: 'drop' }],
      repaymentRules: [rule],
      gracePeriods: [grace],
      unknownRoot: 'drop'
    }))

    expect(result).not.toHaveProperty('unknownRoot')
    expect(result.config).not.toHaveProperty('unknownConfig')
    expect(result.config.interest).not.toHaveProperty('unknownInterest')
    expect(result.config.rateChanges[0]).not.toHaveProperty('unknownRate')
    expect(result.repayments[0]).not.toHaveProperty('unknownRepayment')
    expect(result.repaymentRules[0]).not.toHaveProperty('unknownRule')
    expect(result.gracePeriods[0]).not.toHaveProperty('unknownGrace')
  })

  it('отклоняет обратный льготный период', () => {
    const grace = { id: 'g1', startDate: '2026-09-01', endDate: '2026-08-01', type: 'full', extendTerm: true, accrueInterest: true, capitalizeInterest: false }
    expect(() => parseLoanBackup(JSON.stringify({ config: defaultConfig, repayments: [], gracePeriods: [grace] }))).toThrow('окончание раньше начала')
  })

  it('отклоняет пересекающиеся льготные периоды в preview импорта', () => {
    const first = { id: 'g1', startDate: '2026-08-01', endDate: '2026-08-31', type: 'full', extendTerm: true, accrueInterest: true, capitalizeInterest: false }
    const second = { id: 'g2', startDate: '2026-08-15', endDate: '2026-09-15', type: 'interestOnly', extendTerm: false, accrueInterest: true, capitalizeInterest: false }
    expect(() => parseLoanBackup(JSON.stringify({ config: defaultConfig, repayments: [], gracePeriods: [first, second] }))).toThrow('не должны пересекаться')
  })
})
