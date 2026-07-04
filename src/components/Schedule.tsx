import { useEffect, useMemo, useState } from 'react'
import type React from 'react'
import { format, parseISO } from 'date-fns'
import { ru } from 'date-fns/locale'
import { ChevronDown, CircleHelp } from 'lucide-react'
import type { EarlyRepayment, PaymentScheduleItem } from '../loanEngine'
import { money, plural, shortDate } from '../formatters'
import { dayCountBasisLabel, roundingName } from '../labels'

interface ScheduleProps {
  schedule: PaymentScheduleItem[]
  baseSchedule: PaymentScheduleItem[]
  repayments: EarlyRepayment[]
  rows: number
  setRows: React.Dispatch<React.SetStateAction<number>>
  more: () => void
}

const rowTotal = (row: PaymentScheduleItem) => row.cashFlowTotal ?? row.payment + row.earlyPayment + row.fee
const rowFee = (row: PaymentScheduleItem) => row.feePaid ?? row.fee
const rowDeferredInterest = (row: PaymentScheduleItem) => row.deferredInterestClosing ?? 0
const rowTotalDebt = (row: PaymentScheduleItem) => row.closingBalance + rowDeferredInterest(row)
const hasFee = (row: PaymentScheduleItem) => Math.abs(rowFee(row)) > 0.004
const hasDeferredInterest = (row: PaymentScheduleItem) => Math.abs(row.deferredInterestOpening ?? 0) > 0.004 || Math.abs(rowDeferredInterest(row)) > 0.004
const monthKey = (date: string) => date.slice(0, 7)
const monthTitle = (date: string) => format(parseISO(`${monthKey(date)}-01`), 'LLLL yyyy', { locale: ru })

const parseAmount = (value: string) => {
  const normalized = value.replace(/\s/g, '').replace(',', '.').trim()
  if (!normalized) return null
  const amount = Number(normalized)
  return Number.isFinite(amount) ? amount : null
}

const matchesAmount = (row: PaymentScheduleItem, amount: number) => {
  const values = [row.principalPaid ?? row.principal, row.interestPaid ?? row.interest, row.feePaid ?? row.fee, rowTotal(row), row.closingBalance]
  return values.some(value => Math.abs(value - amount) < 0.01)
}
const operationOrderName = (value: string) => value
  .replaceAll('earlyFirst', 'сначала досрочный платёж')
  .replaceAll('regularFirst', 'после регулярного платежа')
const rateLabel = (value: number) => `${value.toLocaleString('ru-RU', { maximumFractionDigits: 4 })}%`

function AuditFields({ audit }: { audit: NonNullable<PaymentScheduleItem['audit']> }) {
  return <dl><div><dt>Период начисления</dt><dd>{shortDate(audit.periodStart)} — {shortDate(audit.periodEnd)}</dd></div><div><dt>Дней</dt><dd>{audit.days}</dd></div><div><dt>База года</dt><dd>{dayCountBasisLabel(audit.dayCountBasis)}</dd></div><div><dt>Остаток для процентов</dt><dd>{money(audit.interestBalance)}</dd></div><div><dt>Проценты до округления</dt><dd>{money(audit.interestBeforeRounding)}</dd></div><div><dt>Округление</dt><dd>{roundingName(audit.rounding)}</dd></div><div><dt>Порядок операций</dt><dd>{operationOrderName(audit.operationOrder)}</dd></div>{audit.interestSegments.map((segment, index) => <div key={`${segment.from}-${segment.to}-${index}`}><dt>{segment.reason}</dt><dd>{shortDate(segment.from)} — {shortDate(segment.to)}, {segment.days} дн., ставка {rateLabel(segment.annualRate)}, {money(segment.rawInterest)}</dd></div>)}</dl>
}

function AuditDetails({ row, colSpan }: { row: PaymentScheduleItem; colSpan: number }) {
  if (!row.audit) return null
  const audit = row.audit
  return <tr id={`audit-row-${row.number}`} className="audit-row"><td colSpan={colSpan}><div className="audit-card"><b>Формула строки №{row.number}</b><AuditFields audit={audit}/></div></td></tr>
}

function AuditCard({ row }: { row: PaymentScheduleItem }) {
  if (!row.audit) return null
  const audit = row.audit
  return <div className="audit-card"><b>Формула строки №{row.number}</b><AuditFields audit={audit}/></div>
}

function ScheduleTable({ rows, expandedRows, toggleRow, showFees, showDeferred }: { rows: PaymentScheduleItem[]; expandedRows: Set<number>; toggleRow: (number: number) => void; showFees: boolean; showDeferred: boolean }) {
  const colSpan = (showFees ? 7 : 6) + (showDeferred ? 2 : 0)
  return <table className="bank-schedule"><thead><tr><th rowSpan={2}>№ п/п</th><th rowSpan={2}>Дата</th><th colSpan={showFees ? 4 : 3}>Сумма платежа</th><th rowSpan={2}>Остаток задолженности</th>{showDeferred && <><th rowSpan={2}>Отложенные проценты</th><th rowSpan={2}>Общая задолженность</th></>}</tr><tr><th>По кредиту</th><th>По процентам</th>{showFees && <th>Комиссия</th>}<th>Итого</th></tr></thead><tbody>{rows.flatMap(row => [<tr id={`schedule-row-${row.number}`} key={`${row.number}-${row.date}`} className={row.event ? 'recalc-row' : ''}><td>{row.audit ? <button className="audit-toggle" onClick={() => toggleRow(row.number)} aria-label={`${expandedRows.has(row.number) ? 'Скрыть' : 'Показать'} формулу строки ${row.number}`} aria-expanded={expandedRows.has(row.number)} aria-controls={`audit-row-${row.number}`}>{expandedRows.has(row.number) ? '−' : '+'}</button> : <span className="audit-spacer" aria-hidden="true"/>}{row.number}</td><td>{shortDate(row.date)}</td><td>{money(row.principalPaid ?? row.principal)}</td><td>{money(row.interestPaid ?? row.interest)}</td>{showFees && <td>{money(rowFee(row))}</td>}<td>{money(rowTotal(row))}</td><td><b>{money(row.closingBalance)}</b></td>{showDeferred && <><td>{money(rowDeferredInterest(row))}</td><td><b>{money(rowTotalDebt(row))}</b></td></>}</tr>, ...(row.audit && expandedRows.has(row.number) ? [<AuditDetails row={row} colSpan={colSpan} key={`audit-${row.number}-${row.date}`}/>] : [])])}</tbody></table>
}

export function Schedule({ schedule, baseSchedule, repayments, rows, setRows, more }: ScheduleProps) {
  const [jump, setJump] = useState('')
  const [yearFilter, setYearFilter] = useState('all')
  const [amountSearch, setAmountSearch] = useState('')
  const [monthsCollapsed, setMonthsCollapsed] = useState(false)
  const [mobileTableMode, setMobileTableMode] = useState(false)
  const [openMonths, setOpenMonths] = useState<Set<string>>(new Set())
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set())
  const [pendingRow, setPendingRow] = useState<number | null>(null)
  const showFees = useMemo(() => schedule.some(hasFee) || baseSchedule.some(hasFee), [schedule, baseSchedule])
  const showDeferred = useMemo(() => schedule.some(hasDeferredInterest) || baseSchedule.some(hasDeferredInterest), [schedule, baseSchedule])
  const totals = schedule.reduce((sum, row) => ({ principal: sum.principal + (row.principalPaid ?? row.principal), interest: sum.interest + (row.interestPaid ?? row.interest), fee: sum.fee + rowFee(row), total: sum.total + rowTotal(row) }), { principal: 0, interest: 0, fee: 0, total: 0 })
  const closingDate = schedule.at(-1)?.date
  const savedRows = closingDate ? baseSchedule.filter(row => rowTotal(row) > 0 && row.date > closingDate) : []
  const savedTotals = savedRows.reduce((sum, row) => ({ principal: sum.principal + (row.principalPaid ?? row.principal), interest: sum.interest + (row.interestPaid ?? row.interest), fee: sum.fee + rowFee(row), total: sum.total + rowTotal(row) }), { principal: 0, interest: 0, fee: 0, total: 0 })
  const today = format(new Date(), 'yyyy-MM-dd')
  const nextRow = schedule.find(row => row.date >= today) ?? schedule.at(-1)
  const nextEarly = repayments.find(item => item.date >= today)
  const currentRow = [...schedule].reverse().find(row => row.date <= today)
  const currentBalance = currentRow ? rowTotalDebt(currentRow) : schedule[0]?.openingBalance ?? 0
  const years = useMemo(() => [...new Set(schedule.map(row => row.date.slice(0, 4)))], [schedule])
  const amount = parseAmount(amountSearch)
  const filteredSchedule = useMemo(() => schedule.filter(row => (yearFilter === 'all' || row.date.startsWith(yearFilter)) && (amount === null || matchesAmount(row, amount))), [schedule, yearFilter, amount])
  const visibleRows = filteredSchedule.slice(0, yearFilter === 'all' && amount === null ? rows : filteredSchedule.length)
  const groupedRows = useMemo(() => {
    const groups: { key: string; title: string; rows: PaymentScheduleItem[]; totals: { principal: number; interest: number; fee: number; total: number; closing: number; deferred: number; debt: number } }[] = []
    for (const row of visibleRows) {
      const key = monthKey(row.date)
      let group = groups.at(-1)
      if (!group || group.key !== key) {
        group = { key, title: monthTitle(row.date), rows: [], totals: { principal: 0, interest: 0, fee: 0, total: 0, closing: 0, deferred: 0, debt: 0 } }
        groups.push(group)
      }
      group.rows.push(row)
      group.totals.principal += row.principalPaid ?? row.principal
      group.totals.interest += row.interestPaid ?? row.interest
      group.totals.fee += rowFee(row)
      group.totals.total += rowTotal(row)
      group.totals.closing = row.closingBalance
      group.totals.deferred = rowDeferredInterest(row)
      group.totals.debt = rowTotalDebt(row)
    }
    return groups
  }, [visibleRows])

  const normalizeJump = (value: string) => {
    const trimmed = value.trim()
    const dateMatch = trimmed.match(/^(\d{2})\.(\d{2})\.(\d{4})$/)
    if (dateMatch) return `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`
    return trimmed
  }
  const jumpTo = () => {
    const query = normalizeJump(jump)
    if (!query) return
    const index = schedule.findIndex(row => row.date === query || row.date.startsWith(`${query}-`) || row.date.startsWith(query))
    if (index < 0) return
    setRows(Math.max(rows, index + 1))
    setYearFilter('all')
    setAmountSearch('')
    setMonthsCollapsed(false)
    setPendingRow(schedule[index].number)
  }
  const quickJump = (query: string) => {
    const index = schedule.findIndex(row => row.date === query || row.date.startsWith(query))
    if (index < 0) return
    setRows(Math.max(rows, index + 1))
    setYearFilter('all')
    setAmountSearch('')
    setMonthsCollapsed(false)
    setPendingRow(schedule[index].number)
  }
  const toggleMonth = (key: string) => setOpenMonths(current => {
    const next = new Set(current)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  })
  const toggleRow = (number: number) => setExpandedRows(current => {
    const next = new Set(current)
    if (next.has(number)) next.delete(number)
    else next.add(number)
    return next
  })

  useEffect(() => {
    if (pendingRow === null) return
    const timer = window.setTimeout(() => {
      const target = document.getElementById(`mobile-schedule-row-${pendingRow}`) ?? document.getElementById(`schedule-row-${pendingRow}`)
      target?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      setPendingRow(null)
    }, 80)
    return () => window.clearTimeout(timer)
  }, [pendingRow, rows])

  return <section className="panel table-panel">
    <div className="panel-head schedule-head"><div><h3>График платежей</h3><p>{schedule.length} строк · показано {visibleRows.length} · закрытие {schedule.at(-1) ? shortDate(schedule.at(-1)!.date) : '—'}</p></div><div className="schedule-tools"><input value={jump} onChange={event => setJump(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') jumpTo() }} placeholder="Дата, месяц или год"/><button className="ghost" onClick={jumpTo}>Перейти</button><button className="ghost" onClick={() => setRows(schedule.length)}>Показать всё</button></div></div>
    <div className="mobile-schedule-bar"><div><span>Остаток долга</span><b>{money(currentBalance)}</b></div><div className="mobile-quick-actions"><button className="ghost compact" onClick={() => quickJump(today.slice(0,4))}>Текущий год</button>{nextRow && <button className="ghost compact" onClick={() => quickJump(nextRow.date)}>Следующий платёж</button>}{nextEarly && <button className="ghost compact" onClick={() => quickJump(nextEarly.date)}>Досрочные</button>}<button className="ghost compact" onClick={() => setMobileTableMode(value => !value)}>{mobileTableMode ? 'Карточки' : 'Таблица'}</button></div></div>
    <div className="schedule-filters"><label><span>Год</span><select value={yearFilter} onChange={event => setYearFilter(event.target.value)}><option value="all">Все годы</option>{years.map(year => <option value={year} key={year}>{year}</option>)}</select></label><label><span>Поиск суммы</span><input inputMode="decimal" value={amountSearch} onChange={event => setAmountSearch(event.target.value)} placeholder="Например 35479,81"/></label><button className="ghost" onClick={() => { setYearFilter('all'); setAmountSearch(''); setMonthsCollapsed(false); setOpenMonths(new Set()) }}>Сбросить</button><label className="schedule-collapse-toggle"><input type="checkbox" checked={monthsCollapsed} onChange={event => setMonthsCollapsed(event.target.checked)}/><span>Свернуть месяцы</span></label></div>
    <div className={mobileTableMode ? 'table-wrap force-mobile-table' : 'table-wrap'}>
      {monthsCollapsed ? <table className="bank-schedule"><thead><tr><th>Месяц</th><th>Строк</th><th>По кредиту</th><th>По процентам</th>{showFees && <th>Комиссия</th>}<th>Итого</th><th>Остаток задолженности</th>{showDeferred && <><th>Отложенные проценты</th><th>Общая задолженность</th></>}<th>Действие</th></tr></thead><tbody>{groupedRows.map(group => {
        const groupRow = <tr key={group.key} className="month-row"><td>{group.title}</td><td>{group.rows.length}</td><td>{money(group.totals.principal)}</td><td>{money(group.totals.interest)}</td>{showFees && <td>{money(group.totals.fee)}</td>}<td>{money(group.totals.total)}</td><td>{money(group.totals.closing)}</td>{showDeferred && <><td>{money(group.totals.deferred)}</td><td>{money(group.totals.debt)}</td></>}<td><button className="ghost compact" onClick={() => toggleMonth(group.key)}>{openMonths.has(group.key) ? 'Свернуть' : 'Открыть'}</button></td></tr>
        if (!openMonths.has(group.key)) return [groupRow]
        const colSpan = (showFees ? 8 : 7) + (showDeferred ? 2 : 0)
        return [groupRow, ...group.rows.flatMap(item => [<tr id={`schedule-row-${item.number}`} key={`${item.number}-${item.date}`} className={item.event ? 'recalc-row detail-row' : 'detail-row'}><td>{item.audit ? <button className="audit-toggle" onClick={() => toggleRow(item.number)} aria-label={`${expandedRows.has(item.number) ? 'Скрыть' : 'Показать'} формулу строки ${item.number}`} aria-expanded={expandedRows.has(item.number)} aria-controls={`audit-row-${item.number}`}>{expandedRows.has(item.number) ? '−' : '+'}</button> : <span className="audit-spacer" aria-hidden="true"/>}{shortDate(item.date)}</td><td>№ {item.number}</td><td>{money(item.principalPaid ?? item.principal)}</td><td>{money(item.interestPaid ?? item.interest)}</td>{showFees && <td>{money(rowFee(item))}</td>}<td>{money(rowTotal(item))}</td><td>{money(item.closingBalance)}</td>{showDeferred && <><td>{money(rowDeferredInterest(item))}</td><td>{money(rowTotalDebt(item))}</td></>}</tr>, ...(item.audit && expandedRows.has(item.number) ? [<AuditDetails row={item} colSpan={colSpan} key={`audit-${item.number}-${item.date}`}/>] : [])])]
      }).flat()}</tbody></table> : <ScheduleTable rows={visibleRows} expandedRows={expandedRows} toggleRow={toggleRow} showFees={showFees} showDeferred={showDeferred}/>}
    </div>
    {!mobileTableMode && !monthsCollapsed && <div className="mobile-schedule-cards">{visibleRows.map(row => <article id={`mobile-schedule-row-${row.number}`} key={`card-${row.number}-${row.date}`} className={row.event ? 'schedule-card recalc-row' : 'schedule-card'}><div><span>№ {row.number}</span><b>{shortDate(row.date)}</b></div><dl><div><dt>По кредиту</dt><dd>{money(row.principalPaid ?? row.principal)}</dd></div><div><dt>Проценты</dt><dd>{money(row.interestPaid ?? row.interest)}</dd></div>{showFees && <div><dt>Комиссия</dt><dd>{money(rowFee(row))}</dd></div>}<div><dt>Итого</dt><dd>{money(rowTotal(row))}</dd></div><div><dt>Остаток</dt><dd>{money(row.closingBalance)}</dd></div>{showDeferred && <><div><dt>Отложенные проценты</dt><dd>{money(rowDeferredInterest(row))}</dd></div><div><dt>Общая задолженность</dt><dd>{money(rowTotalDebt(row))}</dd></div></>}</dl>{row.audit && <button className="ghost compact" onClick={() => toggleRow(row.number)} aria-expanded={expandedRows.has(row.number)} aria-controls={`mobile-audit-${row.number}`}>{expandedRows.has(row.number) ? 'Скрыть формулу' : 'Показать формулу'}</button>}{expandedRows.has(row.number) && <div id={`mobile-audit-${row.number}`} className="mobile-audit"><AuditCard row={row}/></div>}</article>)}</div>}
    {!monthsCollapsed && <table className="schedule-totals bank-schedule"><tfoot><tr><td colSpan={2}>Итого за весь срок</td><td>{money(totals.principal)}</td><td>{money(totals.interest)}</td>{showFees && <td>{money(totals.fee)}</td>}<td>{money(totals.total)}</td><td>{money(schedule.at(-1)?.closingBalance ?? 0)}</td>{showDeferred && <><td>{money(schedule.at(-1)?.deferredInterestClosing ?? 0)}</td><td>{money(schedule.at(-1) ? rowTotalDebt(schedule.at(-1)!) : 0)}</td></>}</tr></tfoot></table>}
    {yearFilter === 'all' && amount === null && rows < schedule.length && <button className="load-more" onClick={more}>Показать ещё <ChevronDown/></button>}
    {savedRows.length > 0 && <div className="saved-period"><div className="saved-period-head"><div><span className="eyebrow">Сокращённый срок</span><h4>Платежи исходного графика, которые больше не нужны</h4><p>Это хвост первоначального графика после даты закрытия выбранного сценария. Сумма “Итого” показывает платежи, которые исчезли из исходного графика, но не является чистой экономией: часть “по кредиту” — это основной долг, погашенный раньше. Экономия денег считается по процентам.</p></div><b>{savedRows.length} {plural(savedRows.length, 'платёж', 'платежа', 'платежей')}</b></div><div className="table-wrap"><table className="bank-schedule saved-schedule"><thead><tr><th rowSpan={2}>№ п/п</th><th rowSpan={2}>Дата</th><th colSpan={showFees ? 4 : 3}>Сумма платежа по исходному графику</th><th rowSpan={2}>Остаток задолженности</th></tr><tr><th>По кредиту</th><th>По процентам</th>{showFees && <th>Комиссия</th>}<th>Итого</th></tr></thead><tbody>{savedRows.map(row => <tr key={`saved-${row.number}-${row.date}`}><td>{row.number}</td><td>{shortDate(row.date)}</td><td>{money(row.principalPaid ?? row.principal)}</td><td>{money(row.interestPaid ?? row.interest)}</td>{showFees && <td>{money(rowFee(row))}</td>}<td>{money(rowTotal(row))}</td><td><b>{money(row.closingBalance)}</b></td></tr>)}</tbody><tfoot><tr><td colSpan={2}>Исчезнувшие платежи исходного графика</td><td>{money(savedTotals.principal)}</td><td>{money(savedTotals.interest)}</td>{showFees && <td>{money(savedTotals.fee)}</td>}<td>{money(savedTotals.total)}</td><td>—</td></tr></tfoot></table></div><div className="saved-period-note"><CircleHelp/> Чистая финансовая экономия — это снижение процентов по всему кредиту, а не сумма всех исчезнувших строк исходного графика.</div></div>}
  </section>
}
