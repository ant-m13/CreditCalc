import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { differenceInCalendarMonths, format, parseISO } from 'date-fns'
import { CalendarDays, Check, Clock3, Sparkles, Target, WalletCards } from 'lucide-react'
import type { ComparisonResult, EarlyRepayment, LoanConfig, PaymentScheduleItem, ScenarioResult } from '../loanEngine'
import { calculateInterest } from '../loanEngine'
import { fmtMonths, fmtMonthsFull, money, plural, shortDate } from '../formatters'
import { repaymentStrategyName } from '../labels'

const todayISO = () => format(new Date(), 'yyyy-MM-dd')
const rowCashFlow = (row: PaymentScheduleItem) => row.cashFlowTotal ?? row.payment + row.earlyPayment + row.fee

const currentDebt = (schedule: PaymentScheduleItem[], config: LoanConfig, today = todayISO()) => {
  if (!schedule.length || today < config.issueDate) return { date: today, principal: 0, interest: 0, total: 0, fromDate: config.issueDate }
  const paidRows = schedule.filter(row => row.date <= today)
  const lastRow = paidRows.at(-1) ?? schedule[0]
  const principal = Math.max(0, lastRow.closingBalance)
  const deferredInterest = Math.max(0, lastRow.deferredInterestClosing ?? 0)
  const accruedInterest = principal > 0 && lastRow.date < today ? calculateInterest(principal, config.annualRate, lastRow.date, today, config.interest).toDecimalPlaces(2).toNumber() : 0
  const interest = deferredInterest + accruedInterest
  return { date: today, principal, interest, total: principal + interest, fromDate: lastRow.date }
}

function ProgressBar({ title, value }: { title: string; value: number }) {
  return <div className="progress-item"><div><span>{title}</span><b>{Math.round(value)}%</b></div><i><em style={{ width: `${Math.min(100, Math.max(0, value))}%` }}/></i></div>
}

export function Overview({ config, repayments, comparison, selected, chartData, onSelect, onOpen }: { config: LoanConfig; repayments: EarlyRepayment[]; comparison: ComparisonResult; selected: ScenarioResult; chartData: { date: string; base: number; balance: number | null }[]; onSelect: (id: string) => void; onOpen: () => void }) {
  const base = comparison.scenarios[0]
  const debt = currentDebt(selected.schedule, config)
  const earlyTotal = repayments.reduce((sum, item) => sum + item.amount, 0)
  const today = todayISO()
  const nextPayment = selected.schedule.find(row => row.date >= today && rowCashFlow(row) > 0)
  const nextPaymentFee = nextPayment ? nextPayment.feePaid ?? nextPayment.fee : 0
  const principalPaidPercent = Math.min(100, Math.max(0, (config.principal - debt.principal) / Math.max(1, config.principal) * 100))
  const elapsedMonths = Math.max(0, differenceInCalendarMonths(parseISO(today), parseISO(config.issueDate)))
  const termPassedPercent = Math.min(100, elapsedMonths / Math.max(1, selected.termMonths) * 100)
  const interestPaidToDate = selected.schedule.filter(row => row.date <= today).reduce((sum, row) => sum + (row.interestPaid ?? row.interest), 0)
  const interestPaidPercent = Math.min(100, interestPaidToDate / Math.max(1, selected.totalInterest) * 100)
  const paymentPeriodLabel = config.frequency === 'biweekly' ? '/ 2 нед.' : config.frequency === 'quarterly' ? '/ квартал' : '/ мес'
  const remainingMonths = Math.max(0, differenceInCalendarMonths(parseISO(selected.closingDate), parseISO(today)))
  const milestones = [
    { title: 'Остаток ниже 75%', done: debt.principal <= config.principal * .75 },
    { title: 'Половина кредита погашена', done: debt.principal <= config.principal * .5 },
    { title: 'Последний миллион', done: debt.principal <= 1_000_000 },
    { title: 'Последний год', done: remainingMonths <= 12 },
    { title: 'Полное закрытие', done: debt.total <= 0 }
  ]
  return <>
    <section className="hero-card"><div><span className="eyebrow">Сумма кредита</span><strong>{money(base.schedule[0]?.openingBalance ?? 0)}</strong><div className="hero-meta"><span><WalletCards/>Платёж <b>{money(selected.monthlyPayment)}</b></span><span><CalendarDays/>Закрытие <b>{shortDate(selected.closingDate)}</b></span><span><Clock3/>Срок сценария <b>{fmtMonths(selected.termMonths)}</b></span></div></div><div className="hero-ring"><svg viewBox="0 0 42 42"><circle cx="21" cy="21" r="16"/><circle className="progress" cx="21" cy="21" r="16" strokeDasharray={`${Math.max(2, Math.round(selected.monthsSaved / Math.max(1, base.termMonths) * 100))} 100`}/></svg><div><b>−{selected.monthsSaved}</b><span>{fmtMonthsFull(selected.monthsSaved)}</span></div></div></section>
    <section className="current-debt-grid">
      <div className="current-debt main"><span>Остаток долга на {shortDate(debt.date)}</span><b>{money(debt.total)}</b><small>Тело кредита + начисленные проценты после {shortDate(debt.fromDate)}</small></div>
      <div className="current-debt"><span>Тело кредита</span><b>{money(debt.principal)}</b><small>Остаток основного долга</small></div>
      <div className="current-debt"><span>Проценты</span><b>{money(debt.interest)}</b><small>Начислено к сегодняшнему дню</small></div>
      <div className="current-debt"><span>Досрочно добавлено</span><b>{money(earlyTotal)}</b><small>{repayments.length ? `${repayments.length} ${plural(repayments.length, 'операция', 'операции', 'операций')}` : 'Операций нет'}</small></div>
    </section>
    {nextPayment && <section className="panel next-payment-panel"><div className="panel-head"><div><h3>Ближайший платёж</h3><p>{shortDate(nextPayment.date)} · строка №{nextPayment.number}</p></div><b>{money(rowCashFlow(nextPayment))}</b></div><div className="next-payment-grid"><div><span>По кредиту</span><b>{money(nextPayment.principalPaid ?? nextPayment.principal)}</b><small>Погашение тела</small></div><div><span>По процентам</span><b>{money(nextPayment.interestPaid ?? nextPayment.interest)}</b><small>Начисленные проценты</small></div>{Math.abs(nextPaymentFee) > 0.004 && <div><span>Комиссия</span><b>{money(nextPaymentFee)}</b><small>Дополнительный платёж</small></div>}<div><span>Остаток после</span><b>{money(nextPayment.closingBalance)}</b><small>Основной долг</small></div></div></section>}
    <section className="panel chart-panel"><div className="panel-head"><div><h3>Как меняется ваш долг</h3><p>Остаток основного долга по выбранной стратегии</p></div><span className="chart-legend"><i/> Ваш сценарий <i/> Базовый</span></div><ResponsiveContainer width="100%" height={280}><AreaChart data={chartData}><defs><linearGradient id="area" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--green)" stopOpacity={.32}/><stop offset="100%" stopColor="var(--green)" stopOpacity={0}/></linearGradient></defs><CartesianGrid stroke="#dce8e4" vertical={false}/><XAxis dataKey="date" tickLine={false} axisLine={false}/><YAxis tickFormatter={v => `${Math.round(Number(v)/1000000)}м`} tickLine={false} axisLine={false}/><Tooltip formatter={(v: unknown, name: unknown) => [money(Number(v ?? 0)), String(name)]}/><Area dataKey="base" name="Базовый график" stroke="#afc2bd" fill="none" strokeDasharray="5 5"/><Area dataKey="balance" name="Ваш сценарий" stroke="var(--green)" strokeWidth={3} fill="url(#area)"/></AreaChart></ResponsiveContainer></section>
    <section className="panel progress-panel"><div className="panel-head"><div><h3>Прогресс погашения</h3><p>Наглядно показывает, где вы сейчас относительно выбранного сценария</p></div><b>До закрытия: {fmtMonthsFull(remainingMonths)}</b></div><div className="progress-grid"><ProgressBar title="Погашено основного долга" value={principalPaidPercent}/><ProgressBar title="Прошло срока" value={termPassedPercent}/><ProgressBar title="Выплачено процентов" value={interestPaidPercent}/></div><div className="milestone-list">{milestones.map(item => <span key={item.title} className={item.done ? 'done' : ''}>{item.done ? '✓' : '○'} {item.title}</span>)}</div></section>
    <div className="section-heading"><div><span className="eyebrow">Сценарии досрочного погашения</span><h2>Как применять добавленные досрочные платежи</h2></div><p>Выберите вариант сравнения. “По операциям” использует стратегию, указанную в каждой операции.</p></div>
    <div className="scenario-grid">{comparison.scenarios.slice(1).map((s, i) => <button key={s.id} className={selected.id === s.id ? 'scenario selected' : 'scenario'} onClick={() => onSelect(s.id)}><span className={`scenario-icon c${i}`} >{i === 0 ? <Target/> : i === 1 ? <WalletCards/> : <Sparkles/>}</span><span className="scenario-title">{s.name}{s.id === comparison.bestSavings.id && <em>Выгоднее</em>}</span><b>{money(s.monthlyPayment)} <small>{paymentPeriodLabel}</small></b><span className="scenario-stats"><i>Экономия <strong>{money(s.interestSavings, true)}</strong></i><i>Срок <strong>−{fmtMonthsFull(s.monthsSaved)}</strong></i></span><span className="radio">{selected.id === s.id && <Check size={14}/>}</span></button>)}</div>
    <section className="insight"><div className="insight-icon"><Sparkles/></div><div><span className="eyebrow">Пояснение</span><h3>Сейчас выбран сценарий «{selected.name}»</h3><p>В нём досрочные платежи пересчитывают график как <b>{selected.strategy === 'combined' ? 'указано в каждой операции' : selected.strategy === 'base' ? 'без досрочных платежей' : repaymentStrategyName(selected.strategy)}</b>. Сокращение срока: <b>{fmtMonthsFull(selected.monthsSaved)}</b>, экономия процентов: <b>{money(selected.interestSavings, true)}</b>.</p></div><button className="ghost" onClick={onOpen}>Добавить платёж</button></section>
  </>
}
