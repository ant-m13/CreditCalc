export const supportedCurrencies = ['RUB', 'USD', 'EUR', 'CNY'] as const
export const paymentTypes = ['annuity', 'differentiated'] as const
export const frequencies = ['monthly', 'biweekly', 'quarterly'] as const
export const roundingModes = ['kopecks', 'rubles', 'bank'] as const
export const interestMethods = ['annuity', 'daily'] as const
export const firstInterestOnlyModes = ['addToTerm', 'withinTerm'] as const
export const dayCountBases = ['366', '360', 'actual365', 'actualActual'] as const
export const periodStarts = ['inclusive', 'exclusive'] as const
export const balanceMoments = ['startOfDay', 'endOfDay'] as const
export const rateChangeModes = ['nextPeriod', 'exactDate'] as const
export const repaymentStrategies = ['reduceTerm', 'reducePayment', 'full', 'custom'] as const
export const repaymentSources = ['own', 'subsidy', 'insurance', 'other'] as const
export const sameDayOrders = ['regularFirst', 'earlyFirst'] as const
export const repaymentAmountModes = ['extra', 'totalWithFee'] as const
export const repaymentOperationSources = ['manual', 'rule'] as const
export const repaymentRuleTypes = ['weeklyFixed', 'monthlyFixed', 'bimonthlyFixed', 'quarterlyFixed', 'semiannualFixed', 'annualFixed', 'annualBonus', 'paymentPercent', 'monthlyTotalPayment'] as const
export const graceTypes = ['full', 'interestOnly', 'reduced', 'custom'] as const
export const scenarioIds = ['base', 'reduceTerm', 'reducePayment', 'combined'] as const
export const termUnits = ['months', 'years'] as const
export const themeNames = ['emerald', 'ocean', 'violet', 'graphite', 'warm', 'night'] as const

export const isOneOf = <T extends string>(value: unknown, values: readonly T[]): value is T =>
  typeof value === 'string' && values.includes(value as T)

export const migrateLegacyDayCountBasis = (value: unknown) => value === '365' ? 'actual365' : value
