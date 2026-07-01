import { format } from 'date-fns'
import { Landmark } from 'lucide-react'
import type { ComparisonResult, EarlyRepayment, LoanConfig, PaymentScheduleItem, ScenarioResult } from '../loanEngine'
import { fmtMonths, money, shortDate } from '../formatters'
import { dayCountBasisLabel, scenarioName } from '../labels'
import { APP_VERSION } from '../version'

export function PrintReport({ config, repayments, comparison, selected }: { config: LoanConfig; repayments: EarlyRepayment[]; comparison: ComparisonResult; selected: ScenarioResult }) {
  const generated = format(new Date(), 'dd.MM.yyyy HH:mm')
  const showFees = selected.schedule.some(row => Math.abs(row.feePaid ?? row.fee) > 0.004)
  return <article className="print-report">
    <div className="print-title"><div><span>Кредитный калькулятор</span><h1>Расчёт кредита</h1><p>Сформировано {generated} · сценарий «{selected.name}» · версия {APP_VERSION}</p></div><Landmark/></div>
    <section className="print-summary"><div><span>Сумма кредита</span><b>{money(config.principal)}</b></div><div><span>Ежемесячный платёж</span><b>{money(selected.monthlyPayment)}</b></div><div><span>Дата закрытия</span><b>{shortDate(selected.closingDate)}</b></div><div><span>Переплата</span><b>{money(selected.overpayment)}</b></div></section>
    <h2>Параметры кредита</h2>
    <dl className="print-params"><div><dt>Ставка</dt><dd>{config.annualRate}% годовых</dd></div><div><dt>Срок</dt><dd>{fmtMonths(config.termMonths)} ({config.termMonths} мес.)</dd></div><div><dt>Дата выдачи</dt><dd>{shortDate(config.issueDate)}</dd></div><div><dt>Первый платёж</dt><dd>{shortDate(config.firstPaymentDate)}</dd></div><div><dt>Тип платежа</dt><dd>{config.paymentType === 'annuity' ? 'Аннуитетный' : 'Дифференцированный'}</dd></div><div><dt>Начисление</dt><dd>{config.interest.method === 'daily' ? 'По фактическим дням' : 'По периодам'}, {dayCountBasisLabel(config.interest.dayCountBasis)}</dd></div></dl>
    <h2>Сравнение сценариев</h2>
    <table className="print-comparison"><thead><tr><th>Сценарий</th><th>Платёж</th><th>Дата закрытия</th><th>Проценты</th><th>Экономия</th></tr></thead><tbody>{comparison.scenarios.map(s => <tr key={s.id} className={s.id === selected.id ? 'chosen' : ''}><td>{s.name}</td><td>{money(s.monthlyPayment)}</td><td>{shortDate(s.closingDate)}</td><td>{money(s.totalInterest)}</td><td>{money(s.interestSavings)}</td></tr>)}</tbody></table>
    <h2>Досрочные платежи</h2>
    {repayments.length ? <table><thead><tr><th>Дата</th><th>Сумма</th><th>Стратегия</th><th>Комментарий</th></tr></thead><tbody>{repayments.map(r => <tr key={r.id}><td>{shortDate(r.date)}</td><td>{money(r.amount)}</td><td>{scenarioName(r.strategy)}</td><td>{r.comment || '—'}</td></tr>)}</tbody></table> : <p className="print-muted">Досрочные платежи не добавлены.</p>}
    <h2 className="page-break">График платежей — {selected.name}</h2>
    <table className="print-schedule"><thead><tr><th rowSpan={2}>№ п/п</th><th rowSpan={2}>Дата</th><th colSpan={showFees ? 4 : 3}>Сумма платежа</th><th rowSpan={2}>Остаток задолженности</th></tr><tr><th>По кредиту</th><th>По процентам</th>{showFees && <th>Комиссия</th>}<th>Итого</th></tr></thead><tbody>{selected.schedule.map((r: PaymentScheduleItem) => <tr key={`${r.number}-${r.date}`} className={r.event ? 'print-event' : ''}><td>{r.number}</td><td>{shortDate(r.date)}</td><td>{money(r.principalPaid ?? r.principal)}</td><td>{money(r.interestPaid ?? r.interest)}</td>{showFees && <td>{money(r.feePaid ?? r.fee)}</td>}<td>{money(r.cashFlowTotal ?? r.payment + r.earlyPayment + r.fee)}</td><td>{money(r.closingBalance)}</td></tr>)}</tbody></table>
    <footer>Расчёт носит информационный характер. Фактический график определяется условиями кредитного договора и правилами банка.</footer>
  </article>
}
