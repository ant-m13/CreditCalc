import { describe, expect, it } from 'vitest'
import { defaultConfig } from './loanDefaults'
import { parseLoanBackup } from './importExport'
import { buildShareUrl, createLoanSnapshot, decodeSharedCalculation, encodeSharedCalculation, parseLoanSnapshot, readSharedCalculationFromLocation } from './shareCalculation'
import type { EarlyRepayment, GracePeriod, LoanConfig } from './loanEngine'

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
  interest: { method: 'daily', dayCountBasis: 'actualActual', includePaymentDate: false, balanceMoment: 'startOfDay' }
}

const repayments: EarlyRepayment[] = [
  { id: 'r1', date: '2025-11-28', amount: 35480, amountMode: 'total', strategy: 'reduceTerm', source: 'own', sameDayOrder: 'regularFirst', interestFirst: true, comment: 'Первый платёж 🏠 & #%+"' },
  { id: 'r2', date: '2026-01-26', amount: 8704.99, amountMode: 'extra', strategy: 'reducePayment', source: 'subsidy', sameDayOrder: 'earlyFirst', interestFirst: false, comment: 'Маткапитал' },
  { id: 'r3', date: '2026-03-27', amount: 12342.6, amountMode: 'extra', strategy: 'full', source: 'insurance', sameDayOrder: 'regularFirst', interestFirst: true, comment: 'Страховка' }
]

const gracePeriods: GracePeriod[] = [
  { id: 'g1', startDate: '2026-04-01', endDate: '2026-04-30', type: 'full', extendTerm: true, accrueInterest: true, capitalizeInterest: false },
  { id: 'g2', startDate: '2026-05-01', endDate: '2026-05-31', type: 'interestOnly', extendTerm: false, accrueInterest: true, capitalizeInterest: false },
  { id: 'g3', startDate: '2026-06-01', endDate: '2026-06-30', type: 'reduced', paymentAmount: 1000, extendTerm: true, accrueInterest: true, capitalizeInterest: true },
  { id: 'g4', startDate: '2026-07-01', endDate: '2026-07-31', type: 'custom', paymentAmount: 500, extendTerm: false, accrueInterest: false, capitalizeInterest: false }
]

const snapshot = () => createLoanSnapshot({
  config,
  repayments,
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
    expect(decoded.repayments).toHaveLength(3)
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

  it('отклоняет payload с недопустимым enum', async () => {
    const bad = { ...snapshot(), config: { ...config, paymentType: 'strange' } }
    await expect(decodeSharedCalculation(await encodeSharedCalculation(bad as never))).rejects.toThrow('неизвестный тип')
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
})
