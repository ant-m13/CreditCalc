import { describe, expect, it } from 'vitest'
import { defaultConfig } from './loanDefaults'
import { parseLoanBackup } from './importExport'
import { buildShareUrl, createLoanSnapshot, decodeSharedCalculation, encodeSharedCalculation, looksLikeSharedCalculationUrl, normalizeSharedCalculationPayload, parseLoanSnapshot, readSharedCalculationFromLocation } from './shareCalculation'
import type { EarlyRepayment, GracePeriod, LoanConfig } from './loanEngine'
import type { RepaymentRule } from './repaymentRules'

const config: LoanConfig = {
  ...defaultConfig,
  principal: 5_917_734,
  annualRate: 6,
  issueDate: '2025-11-26',
  firstPaymentDate: '2025-12-26',
  firstPaymentInterestOnly: true,
  termMonths: 360,
  paymentDay: 26,
  paymentType: 'annuity',
  frequency: 'monthly',
  currency: 'RUB',
  rounding: 'kopecks',
  closeThreshold: 123,
  oneTimeFee: 1000,
  monthlyFee: 50,
  earlyRepaymentFeePercent: 0.1,
  interest: { method: 'daily', dayCountBasis: 'actualActual', includePaymentDate: false, periodStart: 'inclusive', balanceMoment: 'startOfDay' }
}

const repayments: EarlyRepayment[] = [
  { id: 'r1', date: '2025-11-28', amount: 35480, enabled: true, amountMode: 'extra', sameDaySequence: 0, strategy: 'reduceTerm', source: 'own', sameDayOrder: 'regularFirst', interestFirst: true, comment: 'Первый платёж 🏠 & #%+"' },
  { id: 'r2', date: '2026-01-26', amount: 8704.99, enabled: true, amountMode: 'extra', sameDaySequence: 1, strategy: 'reducePayment', source: 'subsidy', sameDayOrder: 'earlyFirst', interestFirst: false, comment: 'Маткапитал' },
  { id: 'r3', date: '2026-03-27', amount: 12342.6, enabled: true, amountMode: 'extra', sameDaySequence: 2, strategy: 'full', source: 'insurance', sameDayOrder: 'regularFirst', interestFirst: true, comment: 'Страховка' }
]

const gracePeriods: GracePeriod[] = [
  { id: 'g1', startDate: '2026-04-01', endDate: '2026-04-30', type: 'full', extendTerm: true, accrueInterest: true, capitalizeInterest: false },
  { id: 'g2', startDate: '2026-05-01', endDate: '2026-05-31', type: 'interestOnly', extendTerm: false, accrueInterest: true, capitalizeInterest: false },
  { id: 'g3', startDate: '2026-06-01', endDate: '2026-06-30', type: 'reduced', paymentAmount: 1000, extendTerm: true, accrueInterest: true, capitalizeInterest: true },
  { id: 'g4', startDate: '2026-07-01', endDate: '2026-07-31', type: 'custom', paymentAmount: 500, extendTerm: false, accrueInterest: false, capitalizeInterest: false }
]

const repaymentRules: RepaymentRule[] = [
  { id: 'rule-1', name: '20 000 каждый месяц', type: 'monthlyFixed', startDate: '2026-02-26', endDate: '2027-02-26', amount: 20000, enabled: true, strategy: 'reduceTerm', source: 'own', sameDayOrder: 'regularFirst', interestFirst: true, skipMonths: ['2026-08'], comment: 'Автоплатёж' },
  { id: 'rule-2', name: 'Премия', type: 'annualBonus', startDate: '2026-12-15', endDate: '2028-12-15', amount: 150000, enabled: true, strategy: 'reduceTerm', source: 'own', sameDayOrder: 'earlyFirst', interestFirst: true, skipMonths: [] },
  { id: 'rule-3', name: '10% от платежа', type: 'paymentPercent', startDate: '2026-02-26', endDate: '2026-12-26', percent: 10, enabled: true, strategy: 'reducePayment', source: 'other', sameDayOrder: 'regularFirst', interestFirst: true, skipMonths: [] }
]

const snapshot = () => createLoanSnapshot({
  name: 'Семейный кредит',
  config,
  repayments,
  repaymentRules,
  gracePeriods,
  selectedScenario: 'combined',
  termUnit: 'years',
  displayDecimals: 0,
  appFontSize: 'xlarge',
  scheduleFontSize: 'large',
  theme: 'violet'
})

describe('ссылка на расчёт', () => {
  it('выполняет полный round-trip encode → decode → validate', async () => {
    const decoded = await decodeSharedCalculation(await encodeSharedCalculation(snapshot()))
    expect(decoded.config.principal).toBe(5_917_734)
    expect(decoded.name).toBe('Семейный кредит')
    expect(decoded.repayments).toHaveLength(3)
    expect(decoded.repaymentRules).toHaveLength(3)
    expect(decoded.gracePeriods).toHaveLength(4)
  })

  it('восстанавливает все поля LoanConfig', async () => {
    const decoded = await decodeSharedCalculation(await encodeSharedCalculation(snapshot()))
    expect(decoded.config).toEqual(config)
  })

  it('восстанавливает несколько досрочных платежей со всеми вариантами полей', async () => {
    const decoded = await decodeSharedCalculation(await encodeSharedCalculation(snapshot()))
    expect(decoded.repayments).toEqual(repayments)
  })

  it('восстанавливает несколько льготных периодов всех типов', async () => {
    const decoded = await decodeSharedCalculation(await encodeSharedCalculation(snapshot()))
    expect(decoded.gracePeriods).toEqual(gracePeriods)
  })

  it('восстанавливает правила досрочных платежей', async () => {
    const decoded = await decodeSharedCalculation(await encodeSharedCalculation(snapshot()))
    expect(decoded.repaymentRules).toEqual(repaymentRules)
  })

  it('сохраняет selectedScenario и настройки интерфейса', async () => {
    const decoded = await decodeSharedCalculation(await encodeSharedCalculation(snapshot()))
    expect(decoded.selectedScenario).toBe('combined')
    expect(decoded.termUnit).toBe('years')
    expect(decoded.displayDecimals).toBe(0)
    expect(decoded.appFontSize).toBe('xlarge')
    expect(decoded.scheduleFontSize).toBe('large')
    expect(decoded.theme).toBe('violet')
  })

  it('корректно работает с кириллицей, emoji и URL-символами', async () => {
    const decoded = await decodeSharedCalculation(await encodeSharedCalculation(snapshot()))
    expect(decoded.repayments[0].comment).toBe('Первый платёж 🏠 & #%+"')
  })

  it('отклоняет повреждённый payload', async () => {
    await expect(decodeSharedCalculation('v1.not-valid')).rejects.toThrow('Ссылка повреждена')
  })

  it('отклоняет неизвестную версию', async () => {
    await expect(decodeSharedCalculation(await encodeSharedCalculation({ ...snapshot(), version: 2 } as never))).rejects.toThrow('Версия ссылки')
    expect(() => parseLoanSnapshot({ ...snapshot(), version: 2 })).toThrow('Версия ссылки')
  })

  it('нормализует устаревший payload ссылки с неизвестными полями расчёта', async () => {
    const legacy = {
      ...snapshot(),
      config: {
        ...config,
        firstPaymentInterestOnly: 'yes',
        paymentType: 'strange',
        frequency: 'monthly-old',
        rounding: 'coins',
        interest: {
          method: 'legacy',
          dayCountBasis: 'actual360',
          includePaymentDate: 'no',
          periodStart: 'middle',
          balanceMoment: 'paymentTime'
        }
      }
    }
    const decoded = await decodeSharedCalculation(await encodeSharedCalculation(legacy as never))
    expect(decoded.config.firstPaymentInterestOnly).toBe(defaultConfig.firstPaymentInterestOnly)
    expect(decoded.config.paymentType).toBe(defaultConfig.paymentType)
    expect(decoded.config.frequency).toBe(defaultConfig.frequency)
    expect(decoded.config.rounding).toBe(defaultConfig.rounding)
    expect(decoded.config.interest).toEqual(defaultConfig.interest)
  })

  it('отклоняет слишком большой payload', async () => {
    const tooBig = { ...snapshot(), repayments: [{ ...repayments[0], comment: 'я'.repeat(700_000) }] }
    await expect(encodeSharedCalculation(tooBig)).rejects.toThrow('слишком большой')
  })

  it('buildShareUrl сохраняет origin, pathname, Vite base path и query string', async () => {
    const url = await buildShareUrl(snapshot(), 'https://example.github.io/CreditCalc/index.html?tab=export')
    const parsed = new URL(url)
    expect(parsed.origin).toBe('https://example.github.io')
    expect(parsed.pathname).toBe('/CreditCalc/index.html')
    expect(parsed.search).toBe('?tab=export')
    expect(readSharedCalculationFromLocation({ hash: parsed.hash } as Location)?.startsWith('v1.')).toBe(true)
  })

  it('позволяет переносить расчёт чистым кодом параметров без полной ссылки', async () => {
    const code = await encodeSharedCalculation(snapshot())
    expect(code.startsWith('v1.')).toBe(true)
    expect(normalizeSharedCalculationPayload(code)).toBe(code)
    expect(normalizeSharedCalculationPayload(`calc=${code}`)).toBe(code)
    expect((await decodeSharedCalculation(normalizeSharedCalculationPayload(code))).config.principal).toBe(5_917_734)
    const url = `https://example.test/#calc=${code}`
    expect(looksLikeSharedCalculationUrl(url)).toBe(true)
    expect(normalizeSharedCalculationPayload(url)).toBe(code)
    expect(() => normalizeSharedCalculationPayload('https://example.test/')).toThrow('не найден')
  })

  it('старый JSON-импорт продолжает работать', () => {
    const decoded = parseLoanBackup(JSON.stringify({ config, repayments, scenario: { id: 'reduceTerm', schedule: [] } }))
    expect(decoded.selectedScenario).toBe('reduceTerm')
    expect(decoded.gracePeriods).toEqual([])
  })

  it('отсутствующие необязательные настройки получают значения по умолчанию', () => {
    const decoded = parseLoanSnapshot({ version: 1, config, repayments: [], gracePeriods: [], selectedScenario: 'reduceTerm', settings: { termUnit: 'months', displayDecimals: 2, theme: 'emerald' } })
    expect(decoded.appFontSize).toBe('normal')
    expect(decoded.scheduleFontSize).toBe('large')
  })

  it('поддерживает старый payload ссылки без внутреннего поля version', () => {
    const decoded = parseLoanSnapshot({ config, repayments: [], gracePeriods: [], selectedScenario: 'reduceTerm', settings: { termUnit: 'months', displayDecimals: 2, theme: 'emerald' } })
    expect(decoded.config.principal).toBe(config.principal)
    expect(decoded.selectedScenario).toBe('reduceTerm')
  })
})
