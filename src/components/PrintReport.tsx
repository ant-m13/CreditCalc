import { format } from 'date-fns'
import { Landmark } from 'lucide-react'
import type { ComparisonResult, EarlyRepayment, GracePeriod, LoanConfig, PaymentScheduleItem, ScenarioResult } from '../loanEngine'
import { createMoneyFormatter, fmtMonths, shortDate } from '../formatters'
import { dayCountBasisLabel, graceTypeName, rateChangeModeName, roundingName, ruleTypeName, scenarioName } from '../labels'
import type { RepaymentRule } from '../repaymentRules'
import { APP_VERSION, COMMIT_SHA, shortCommitSha } from '../version'

export function StalePrintReport() {
  return <article className="print-report print-warning">
    <div className="print-title"><div><span>Кредитный калькулятор</span><h1>Расчёт обновляется</h1><p>График пересчитывается · версия {APP_VERSION} · commit {shortCommitSha(COMMIT_SHA)}</p></div><Landmark/></div>
    <section className="print-stale-warning">
      <h2>Печать временно недоступна</h2>
      <p>Дождитесь окончания пересчёта, чтобы распечатать актуальный финансовый отчёт.</p>
    </section>
  </article>
}

const amountModeLabel = (repayment: EarlyRepayment) =>
  repayment.amountMode === 'totalWithFee' ? 'Общая сумма списания с учётом комиссии' : 'Сумма списания сверх платежа'

const ruleLabel = (rule: RepaymentRule) =>
  rule.type === 'monthlyTotalPayment' ? 'Общее списание на платёжную дату, продолжается во время льготы' : ruleTypeName(rule.type)

const repaymentActivity = (repayment: EarlyRepayment) => repayment.enabled === false || repayment.amount <= 0 ? 'Выключено' : 'Применяется'
const ruleActivity = (rule: RepaymentRule) => rule.enabled === false || (rule.type === 'paymentPercent' ? (rule.percent ?? 0) <= 0 : (rule.amount ?? 0) <= 0) ? 'Выключено' : 'Применяется'

export function PrintReport({ config, displayDecimals, repayments, repaymentRules, gracePeriods, comparison, selected }: { config: LoanConfig; displayDecimals: 0 | 2; repayments: EarlyRepayment[]; repaymentRules: RepaymentRule[]; gracePeriods: GracePeriod[]; comparison: ComparisonResult; selected: ScenarioResult }) {
  const { money } = createMoneyFormatter(config.currency, displayDecimals)
  const generated = format(new Date(), 'dd.MM.yyyy HH:mm')
  const showFees = selected.schedule.some(row => Math.abs(row.feePaid ?? row.fee) > 0.004)
  const showDeferred = selected.schedule.some(row => Math.abs(row.deferredInterestOpening ?? 0) > 0.004 || Math.abs(row.deferredInterestClosing ?? 0) > 0.004)
  const paymentLabel = config.frequency === 'biweekly' ? 'Платёж раз в 2 недели' : config.frequency === 'quarterly' ? 'Квартальный платёж' : 'Ежемесячный платёж'
  const rateHistory = config.rateChanges.map(change => `${shortDate(change.date)} — ${change.annualRate}%`).join('; ')
  const finalBalloon = selected.schedule.find(row => row.eventTypes.includes('finalBalloon'))
  return <article className="print-report">
    <div className="print-title"><div><span>Кредитный калькулятор</span><h1>Расчёт кредита</h1><p>Сформировано {generated} · сценарий «{selected.name}» · версия {APP_VERSION} · commit {shortCommitSha(COMMIT_SHA)}</p></div><Landmark/></div>
    <section className="print-summary"><div><span>Сумма кредита</span><b>{money(config.principal)}</b></div><div><span>{paymentLabel}</span><b>{money(selected.monthlyPayment)}</b></div><div><span>Дата закрытия</span><b>{shortDate(selected.closingDate)}</b></div><div><span>Переплата</span><b>{money(selected.overpayment)}</b></div></section>
    {finalBalloon && <section className="print-stale-warning"><h2>Финальный платёж</h2><p>{shortDate(finalBalloon.date)} · {money(finalBalloon.cashFlowTotal ?? finalBalloon.payment + finalBalloon.earlyPayment + finalBalloon.fee)}. Закрывает остаток долга и процентов в последнюю договорную дату по выбранным настройкам.</p></section>}
    <h2>Параметры кредита</h2>
    <dl className="print-params"><div><dt>Ставка</dt><dd>{config.annualRate}% годовых</dd></div>{config.rateChanges.length > 0 && <div><dt>Изменения ставки</dt><dd>{rateChangeModeName(config.rateChangeMode)}; {rateHistory}</dd></div>}<div><dt>Срок</dt><dd>{fmtMonths(config.termMonths)} ({config.termMonths} мес.)</dd></div><div><dt>Дата выдачи</dt><dd>{shortDate(config.issueDate)}</dd></div><div><dt>Первый платёж</dt><dd>{shortDate(config.firstPaymentDate)}</dd></div><div><dt>Тип платежа</dt><dd>{config.paymentType === 'annuity' ? 'Аннуитетный' : 'Дифференцированный'}</dd></div><div><dt>Начисление</dt><dd>{config.interest.method === 'daily' ? 'По фактическим дням' : 'По периодам'}, {dayCountBasisLabel(config.interest.dayCountBasis)}</dd></div><div><dt>Округление</dt><dd>{roundingName(config.rounding)}</dd></div><div><dt>Дата платежа</dt><dd>{config.interest.includePaymentDate ? 'включается' : 'не включается'}; начало периода: {config.interest.periodStart === 'inclusive' ? 'включительно' : 'со следующего дня'}; остаток: {config.interest.balanceMoment === 'startOfDay' ? 'на начало дня' : 'на конец дня'}</dd></div><div><dt>Комиссии</dt><dd>Разовая {money(config.oneTimeFee)}, регулярная {money(config.monthlyFee)}, досрочное погашение {config.earlyRepaymentFeePercent}%</dd></div><div><dt>Порог автозакрытия</dt><dd>{money(config.closeThreshold)}</dd></div></dl>
    <h2>Сравнение сценариев</h2>
    <table className="print-comparison"><thead><tr><th>Сценарий</th><th>Платёж</th><th>Дата закрытия</th><th>Проценты</th><th>Экономия</th></tr></thead><tbody>{comparison.scenarios.map(s => <tr key={s.id} className={s.id === selected.id ? 'chosen' : ''}><td>{s.name}</td><td>{money(s.monthlyPayment)}</td><td>{shortDate(s.closingDate)}</td><td>{money(s.totalInterest)}</td><td>{money(s.interestSavings)}</td></tr>)}</tbody></table>
    <h2>Досрочные платежи</h2>
    {repayments.length ? <table><thead><tr><th>Статус</th><th>Дата</th><th>Сумма</th><th>Режим суммы</th><th>Порядок</th><th>Стратегия</th><th>Комментарий</th></tr></thead><tbody>{repayments.map(r => <tr key={r.id} className={repaymentActivity(r) === 'Выключено' ? 'print-disabled' : ''}><td>{repaymentActivity(r)}</td><td>{shortDate(r.date)}</td><td>{money(r.amount)}</td><td>{amountModeLabel(r)}</td><td>{r.sameDayOrder === 'regularFirst' ? 'После регулярного' : 'До регулярного'} · #{r.sameDaySequence ?? 0}</td><td>{scenarioName(r.strategy)}</td><td>{r.comment || '—'}</td></tr>)}</tbody></table> : <p className="print-muted">Досрочные платежи не добавлены.</p>}
    <h2>Регулярные правила и льготы</h2>
    {repaymentRules.length ? <table><thead><tr><th>Статус</th><th>Правило</th><th>Период</th><th>Сумма</th><th>Порядок</th></tr></thead><tbody>{repaymentRules.map(rule => <tr key={rule.id} className={ruleActivity(rule) === 'Выключено' ? 'print-disabled' : ''}><td>{ruleActivity(rule)}</td><td>{rule.name} · {ruleLabel(rule)}</td><td>{shortDate(rule.startDate)} — {shortDate(rule.endDate)}</td><td>{rule.type === 'paymentPercent' ? `${rule.percent}%` : money(rule.amount ?? 0)}</td><td>{rule.sameDayOrder === 'regularFirst' ? 'После регулярного' : 'До регулярного'} · #{rule.ruleSequence ?? 0}</td></tr>)}</tbody></table> : <p className="print-muted">Регулярные правила не добавлены.</p>}
    {gracePeriods.length ? <table><thead><tr><th>Льготный период</th><th>Тип</th><th>Платёж</th><th>Правила</th></tr></thead><tbody>{gracePeriods.map(period => <tr key={period.id}><td>{shortDate(period.startDate)} — {shortDate(period.endDate)}</td><td>{graceTypeName(period.type)}</td><td>{period.paymentAmount === undefined ? 'По умолчанию' : money(period.paymentAmount)}</td><td>{period.extendTerm ? 'продлевает срок' : 'без продления'}; {period.accrueInterest ? 'проценты начисляются' : 'без начисления'}; {period.capitalizeInterest ? 'капитализация' : 'без капитализации'}</td></tr>)}</tbody></table> : <p className="print-muted">Льготные периоды не добавлены.</p>}
    <h2 className="page-break">График платежей — {selected.name}</h2>
    <table className="print-schedule"><thead><tr><th rowSpan={2}>№ п/п</th><th rowSpan={2}>Дата</th><th colSpan={showFees ? 4 : 3}>Сумма платежа</th><th rowSpan={2}>Остаток задолженности</th>{showDeferred && <><th rowSpan={2}>Отложенные проценты</th><th rowSpan={2}>Общая задолженность</th></>}</tr><tr><th>По кредиту</th><th>По процентам</th>{showFees && <th>Комиссия</th>}<th>Итого</th></tr></thead><tbody>{selected.schedule.map((r: PaymentScheduleItem) => <tr key={`${r.number}-${r.date}`} className={r.event ? 'print-event' : ''}><td>{r.number}</td><td>{shortDate(r.date)}</td><td>{money(r.principalPaid ?? r.principal)}</td><td>{money(r.interestPaid ?? r.interest)}</td>{showFees && <td>{money(r.feePaid ?? r.fee)}</td>}<td>{money(r.cashFlowTotal ?? r.payment + r.earlyPayment + r.fee)}</td><td>{money(r.closingBalance)}</td>{showDeferred && <><td>{money(r.deferredInterestClosing ?? 0)}</td><td>{money(r.closingBalance + (r.deferredInterestClosing ?? 0))}</td></>}</tr>)}</tbody></table>
    <footer>Расчёт носит информационный характер. Фактический график определяется условиями кредитного договора и правилами банка.</footer>
  </article>
}
