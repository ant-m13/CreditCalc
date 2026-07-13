import type { EarlyRepayment, GracePeriod, LoanConfig } from './loanEngine'
import type { RepaymentRule } from './repaymentRules'

export const repaymentStrategyName = (strategy: EarlyRepayment['strategy']) =>
  strategy === 'reduceTerm' ? 'сокращение срока' :
  strategy === 'reducePayment' ? 'уменьшение платежа' :
  strategy === 'full' ? 'полное погашение' :
  'комбинированная'

export const scenarioName = (scenario: string) =>
  scenario === 'base' ? 'Без досрочных платежей' :
  scenario === 'reduceTerm' ? 'Сократить срок' :
  scenario === 'reducePayment' ? 'Снизить платёж' :
  scenario === 'combined' ? 'По операциям' :
  scenario === 'full' ? 'Полное погашение' :
  scenario === 'custom' ? 'Комбинированная стратегия' :
  scenario

export const sourceName = (source: EarlyRepayment['source']) =>
  source === 'own' ? 'Собственные средства' :
  source === 'subsidy' ? 'Маткапитал / субсидия' :
  source === 'insurance' ? 'Страховое возмещение' :
  'Прочее'

export const ruleTypeName = (type: RepaymentRule['type']) =>
  type === 'weeklyFixed' ? 'Раз в неделю фиксированная сумма' :
  type === 'monthlyFixed' ? 'Каждый месяц фиксированная сумма' :
  type === 'bimonthlyFixed' ? 'Раз в 2 месяца фиксированная сумма' :
  type === 'quarterlyFixed' ? 'Раз в квартал фиксированная сумма' :
  type === 'semiannualFixed' ? 'Раз в полгода фиксированная сумма' :
  type === 'annualFixed' ? 'Раз в год фиксированная сумма' :
  type === 'annualBonus' ? 'Ежегодная премия' :
  type === 'monthlyTotalPayment' ? 'Общее ежемесячное списание с комиссией' :
  'Процент от регулярного платежа'

export const graceTypeName = (type: GracePeriod['type']) =>
  type === 'full' ? 'Полная отсрочка' :
  type === 'interestOnly' ? 'Только проценты' :
  type === 'reduced' ? 'Уменьшенный платёж' :
  'Индивидуальный платёж'

export const dayCountBasisLabel = (value: LoanConfig['interest']['dayCountBasis']) =>
  value === 'actualActual' ? 'фактические дни / фактический год' :
  value === 'actual365' ? 'фактические дни / 365 дней' :
  `фактические дни / ${value} дней`

export const roundingName = (value: LoanConfig['rounding']) =>
  value === 'kopecks' ? 'До копеек' :
  value === 'rubles' ? 'До рублей' :
  'Банковское округление'

export const rateChangeModeName = (value: LoanConfig['rateChangeMode']) =>
  value === 'exactDate' ? 'Точно с даты изменения' : 'Со следующего платёжного периода'

export const firstInterestOnlyModeName = (value: LoanConfig['firstPaymentInterestOnlyMode']) =>
  value === 'withinTerm' ? 'включён в договорный срок' : 'добавлен к договорному сроку'

export const balanceMomentName = (value: LoanConfig['interest']['balanceMoment']) =>
  value === 'startOfDay' ? 'На начало дня' : 'На конец дня'
