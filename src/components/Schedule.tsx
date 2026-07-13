import { useEffect, useMemo, useState } from 'react'
import type React from 'react'
import { format, parseISO } from 'date-fns'
import { ru } from 'date-fns/locale'
import { ChevronDown, CircleHelp } from 'lucide-react'
import { calculateDebtAtDate, type EarlyRepayment, type GracePeriod, type LoanConfig, type PaymentScheduleItem } from '../loanEngine'
import { createMoneyFormatter, plural, shortDate } from '../formatters'
import { dayCountBasisLabel, roundingName } from '../labels'
import { useBoundedPage } from '../hooks/useBoundedPage'

interface ScheduleProps {
  schedule: PaymentScheduleItem[]
  baseSchedule: PaymentScheduleItem[]
  repayments: EarlyRepayment[]
  config: LoanConfig
  gracePeriods: GracePeriod[]
  currency: string
  displayDecimals: 0 | 2
  rows: number
  setRows: React.Dispatch<React.SetStateAction<number>>
}

const SCHEDULE_PAGE_SIZE = 100
export const SAVED_ROWS_PAGE_SIZE = 100

export const getScheduleScrollBehavior = (): ScrollBehavior =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ? 'auto'
    : 'smooth'

const rowTotal = (row: PaymentScheduleItem) => row.cashFlowTotal ?? row.payment + row.earlyPayment + row.fee
const rowFee = (row: PaymentScheduleItem) => row.feePaid ?? row.fee
const rowDeferredInterest = (row: PaymentScheduleItem) => row.deferredInterestClosing ?? 0
const rowTotalDebt = (row: PaymentScheduleItem) => row.closingBalance + rowDeferredInterest(row)
const hasFee = (row: PaymentScheduleItem) => Math.abs(rowFee(row)) > 0.004
const hasDeferredInterest = (row: PaymentScheduleItem) => Math.abs(row.deferredInterestOpening ?? 0) > 0.004 || Math.abs(rowDeferredInterest(row)) > 0.004
const isIgnoredOnlyRow = (row: PaymentScheduleItem) => row.eventTypes.length > 0 && row.eventTypes.every(type => type === 'earlyIgnored')
const isFinancialClosingRow = (row: PaymentScheduleItem) => row.closingBalance === 0 && rowDeferredInterest(row) === 0 && !isIgnoredOnlyRow(row)
const monthKey = (date: string) => date.slice(0, 7)
const monthTitle = (date: string) => format(parseISO(`${monthKey(date)}-01`), 'LLLL yyyy', { locale: ru })

const parseAmount = (value: string) => {
  const normalized = value.replace(/\s/g, '').replace(',', '.').trim()
  if (!normalized) return null
  const amount = Number(normalized)
  return Number.isFinite(amount) ? amount : null
}

const matchesAmount = (row: PaymentScheduleItem, amount: number) => {
  const values = [row.principalPaid ?? row.principal, row.interestPaid ?? row.interest, row.feePaid ?? row.fee, rowTotal(row), row.closingBalance, rowDeferredInterest(row), rowTotalDebt(row)]
  return values.some(value => Math.abs(value - amount) < 0.01)
}
const operationOrderName = (value: string) => value
  .replaceAll('earlyFirst', 'сначала досрочный платёж')
  .replaceAll('regularFirst', 'после регулярного платежа')
const rateLabel = (value: number) => `${value.toLocaleString('ru-RU', { maximumFractionDigits: 4 })}%`

function AuditFields({ audit, money }: { audit: NonNullable<PaymentScheduleItem['audit']>; money: (value: number, compact?: boolean) => string }) {
  return <dl><div><dt>Период начисления</dt><dd>{shortDate(audit.periodStart)} — {shortDate(audit.periodEnd)}</dd></div><div><dt>Дней</dt><dd>{audit.days}</dd></div><div><dt>База года</dt><dd>{audit.interestMethod === 'daily' ? dayCountBasisLabel(audit.dayCountBasis) : 'Не применяется при расчёте по периодам'}</dd></div><div><dt>Остаток для процентов</dt><dd>{money(audit.interestBalance)}</dd></div><div><dt>Проценты до округления</dt><dd>{money(audit.interestBeforeRounding)}</dd></div><div><dt>Округление</dt><dd>{roundingName(audit.rounding)}</dd></div><div><dt>Порядок операций</dt><dd>{operationOrderName(audit.operationOrder)}</dd></div>{audit.interestSegments.map((segment, index) => <div key={`${segment.from}-${segment.to}-${index}`}><dt>{segment.reason}</dt><dd>{shortDate(segment.from)} — {shortDate(segment.to)}, {segment.days} дн., ставка {rateLabel(segment.annualRate)}, {money(segment.rawInterest)}</dd></div>)}</dl>
}

function AuditDetails({ row, colSpan, money }: { row: PaymentScheduleItem; colSpan: number; money: (value: number, compact?: boolean) => string }) {
  if (!row.audit) return null
  const audit = row.audit
  return <tr id={`audit-row-${row.number}`} className="audit-row"><td colSpan={colSpan}><div className="audit-card"><b>Формула строки №{row.number}</b><AuditFields audit={audit} money={money}/></div></td></tr>
}

function AuditCard({ row, money }: { row: PaymentScheduleItem; money: (value: number, compact?: boolean) => string }) {
  if (!row.audit) return null
  const audit = row.audit
  return <div className="audit-card"><b>Формула строки №{row.number}</b><AuditFields audit={audit} money={money}/></div>
}

function ScheduleTable({ rows, expandedRows, toggleRow, showFees, showDeferred, money }: { rows: PaymentScheduleItem[]; expandedRows: Set<number>; toggleRow: (number: number) => void; showFees: boolean; showDeferred: boolean; money: (value: number, compact?: boolean) => string }) {
  const colSpan = (showFees ? 7 : 6) + (showDeferred ? 2 : 0)
  return <table className="bank-schedule"><caption className="sr-only">График платежей: даты, погашение основного долга, проценты, комиссии, итоговое списание и остаток задолженности после каждой строки.</caption><thead><tr><th rowSpan={2}>№ п/п</th><th rowSpan={2}>Дата</th><th colSpan={showFees ? 4 : 3}>Сумма платежа</th><th rowSpan={2}>Остаток задолженности</th>{showDeferred && <><th rowSpan={2}>Отложенные проценты</th><th rowSpan={2}>Общая задолженность</th></>}</tr><tr><th>По кредиту</th><th>По процентам</th>{showFees && <th>Комиссия</th>}<th>Итого</th></tr></thead><tbody>{rows.flatMap(row => [<tr id={`schedule-row-${row.number}`} key={`${row.number}-${row.date}`} className={row.event ? 'recalc-row' : ''}><td>{row.audit ? <button className="audit-toggle" onClick={() => toggleRow(row.number)} aria-label={`${expandedRows.has(row.number) ? 'Скрыть' : 'Показать'} формулу строки ${row.number}`} aria-expanded={expandedRows.has(row.number)} aria-controls={`audit-row-${row.number}`}>{expandedRows.has(row.number) ? '−' : '+'}</button> : <span className="audit-spacer" aria-hidden="true"/>}{row.number}</td><td>{shortDate(row.date)}</td><td>{money(row.principalPaid ?? row.principal)}</td><td>{money(row.interestPaid ?? row.interest)}</td>{showFees && <td>{money(rowFee(row))}</td>}<td>{money(rowTotal(row))}</td><td><b>{money(row.closingBalance)}</b></td>{showDeferred && <><td>{money(rowDeferredInterest(row))}</td><td><b>{money(rowTotalDebt(row))}</b></td></>}</tr>, ...(row.audit && expandedRows.has(row.number) ? [<AuditDetails row={row} colSpan={colSpan} money={money} key={`audit-${row.number}-${row.date}`}/>] : [])])}</tbody></table>
}

const collapsedColumnCount = (showFees: boolean, showDeferred: boolean) => 7 + (showFees ? 1 : 0) + (showDeferred ? 2 : 0)

export function Schedule({ schedule, baseSchedule, repayments, config, gracePeriods, currency, displayDecimals, rows, setRows }: ScheduleProps) {
  const { money } = createMoneyFormatter(currency, displayDecimals)
  const [jump, setJump] = useState('')
  const [jumpError, setJumpError] = useState('')
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
  const financialClosingRow = useMemo(() => [...schedule].reverse().find(isFinancialClosingRow), [schedule])
  const closingRow = financialClosingRow ?? schedule.at(-1)
  const closingDate = closingRow?.date
  const savedRows = closingDate ? baseSchedule.filter(row => rowTotal(row) > 0 && row.date > closingDate) : []
  const savedRowsPage = useBoundedPage(savedRows, SAVED_ROWS_PAGE_SIZE)
  const savedTotals = savedRows.reduce((sum, row) => ({ principal: sum.principal + (row.principalPaid ?? row.principal), interest: sum.interest + (row.interestPaid ?? row.interest), fee: sum.fee + rowFee(row), total: sum.total + rowTotal(row) }), { principal: 0, interest: 0, fee: 0, total: 0 })
  const today = format(new Date(), 'yyyy-MM-dd')
  const nextRow = schedule.find(row => row.date >= today) ?? schedule.at(-1)
  const nextEarly = repayments.find(item => item.date >= today)
  const currentDebt = calculateDebtAtDate(config, schedule, gracePeriods, today)
  const currentBalance = today < config.issueDate ? config.principal : currentDebt.total
  const years = useMemo(() => [...new Set(schedule.map(row => row.date.slice(0, 4)))], [schedule])
  const amount = parseAmount(amountSearch)
  const filteredSchedule = useMemo(() => schedule.filter(row => (yearFilter === 'all' || row.date.startsWith(yearFilter)) && (amount === null || matchesAmount(row, amount))), [schedule, yearFilter, amount])
  const pageOffset = Math.min(rows, Math.max(0, Math.floor(Math.max(0, filteredSchedule.length - 1) / SCHEDULE_PAGE_SIZE) * SCHEDULE_PAGE_SIZE))
  const visibleRows = filteredSchedule.slice(pageOffset, pageOffset + SCHEDULE_PAGE_SIZE)
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
    if (!query) {
      setJumpError('')
      return
    }
    const index = schedule.findIndex(row => row.date === query || row.date.startsWith(`${query}-`) || row.date.startsWith(query))
    if (index < 0) {
      setJumpError('Дата/месяц не найден')
      return
    }
    setJumpError('')
    setRows(Math.floor(index / SCHEDULE_PAGE_SIZE) * SCHEDULE_PAGE_SIZE)
    setYearFilter('all')
    setAmountSearch('')
    setMonthsCollapsed(false)
    setPendingRow(schedule[index].number)
  }
  const quickJump = (query: string) => {
    const index = schedule.findIndex(row => row.date === query || row.date.startsWith(query))
    if (index < 0) return
    setRows(Math.floor(index / SCHEDULE_PAGE_SIZE) * SCHEDULE_PAGE_SIZE)
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
      target?.scrollIntoView({ behavior: getScheduleScrollBehavior(), block: 'center' })
      setPendingRow(null)
    }, 80)
    return () => window.clearTimeout(timer)
  }, [pendingRow, rows])

  return <section className="panel table-panel">
    <div className="panel-head schedule-head"><div><h3>График платежей</h3><p>{schedule.length} строк · показано {visibleRows.length} · закрытие {closingDate ? shortDate(closingDate) : '—'}</p></div><div className="schedule-tools"><input value={jump} onChange={event => { setJump(event.target.value); if (jumpError) setJumpError('') }} onKeyDown={event => { if (event.key === 'Enter') jumpTo() }} placeholder="Дата, месяц или год" aria-label="Дата или месяц для перехода по графику" aria-describedby={jumpError ? 'schedule-jump-error' : undefined}/><button className="ghost" onClick={jumpTo}>Перейти</button>{jumpError && <p id="schedule-jump-error" className="inline-error schedule-jump-error" role="status">{jumpError}</p>}</div></div>
    <div className="mobile-schedule-bar"><div><span>Общая текущая задолженность</span><b>{money(currentBalance)}</b><small>Основной долг + начисленные и отложенные проценты</small></div><div className="mobile-quick-actions"><button className="ghost compact" onClick={() => quickJump(today.slice(0,4))}>Текущий год</button>{nextRow && <button className="ghost compact" onClick={() => quickJump(nextRow.date)}>Следующий платёж</button>}{nextEarly && <button className="ghost compact" onClick={() => quickJump(nextEarly.date)}>Досрочные</button>}<button className="ghost compact" onClick={() => setMobileTableMode(value => !value)}>{mobileTableMode ? 'Карточки' : 'Таблица'}</button></div></div>
    <div className="schedule-filters"><label><span>Год</span><select value={yearFilter} onChange={event => setYearFilter(event.target.value)}><option value="all">Все годы</option>{years.map(year => <option value={year} key={year}>{year}</option>)}</select></label><label><span>Поиск суммы</span><input inputMode="decimal" value={amountSearch} onChange={event => setAmountSearch(event.target.value)} placeholder="Например 35479,81"/></label><button className="ghost" onClick={() => { setYearFilter('all'); setAmountSearch(''); setMonthsCollapsed(false); setOpenMonths(new Set()) }}>Сбросить</button><label className="schedule-collapse-toggle"><input type="checkbox" checked={monthsCollapsed} onChange={event => setMonthsCollapsed(event.target.checked)}/><span>Свернуть месяцы</span></label></div>
    <div className={mobileTableMode ? 'table-wrap force-mobile-table' : 'table-wrap'}>
      {monthsCollapsed ? <table className="bank-schedule"><caption className="sr-only">Свёрнутый график платежей по месяцам: количество строк, суммы погашения, проценты, комиссии, итог и задолженность на конец месяца.</caption><thead><tr><th>Месяц</th><th>Строк</th><th>По кредиту</th><th>По процентам</th>{showFees && <th>Комиссия</th>}<th>Итого</th><th>Остаток задолженности</th>{showDeferred && <><th>Отложенные проценты</th><th>Общая задолженность</th></>}<th>Действие</th></tr></thead><tbody>{groupedRows.map(group => {
        const groupRow = <tr key={group.key} className="month-row"><td>{group.title}</td><td>{group.rows.length}</td><td>{money(group.totals.principal)}</td><td>{money(group.totals.interest)}</td>{showFees && <td>{money(group.totals.fee)}</td>}<td>{money(group.totals.total)}</td><td>{money(group.totals.closing)}</td>{showDeferred && <><td>{money(group.totals.deferred)}</td><td>{money(group.totals.debt)}</td></>}<td><button className="ghost compact" onClick={() => toggleMonth(group.key)}>{openMonths.has(group.key) ? 'Свернуть' : 'Открыть'}</button></td></tr>
        if (!openMonths.has(group.key)) return [groupRow]
        const colSpan = collapsedColumnCount(showFees, showDeferred)
        return [groupRow, ...group.rows.flatMap(item => [<tr id={`schedule-row-${item.number}`} key={`${item.number}-${item.date}`} className={item.event ? 'recalc-row detail-row' : 'detail-row'}><td>{item.audit ? <button className="audit-toggle" onClick={() => toggleRow(item.number)} aria-label={`${expandedRows.has(item.number) ? 'Скрыть' : 'Показать'} формулу строки ${item.number}`} aria-expanded={expandedRows.has(item.number)} aria-controls={`audit-row-${item.number}`}>{expandedRows.has(item.number) ? '−' : '+'}</button> : <span className="audit-spacer" aria-hidden="true"/>}{shortDate(item.date)}</td><td>№ {item.number}</td><td>{money(item.principalPaid ?? item.principal)}</td><td>{money(item.interestPaid ?? item.interest)}</td>{showFees && <td>{money(rowFee(item))}</td>}<td>{money(rowTotal(item))}</td><td>{money(item.closingBalance)}</td>{showDeferred && <><td>{money(rowDeferredInterest(item))}</td><td>{money(rowTotalDebt(item))}</td></>}<td></td></tr>, ...(item.audit && expandedRows.has(item.number) ? [<AuditDetails row={item} colSpan={colSpan} money={money} key={`audit-${item.number}-${item.date}`}/>] : [])])]
      }).flat()}</tbody></table> : <ScheduleTable rows={visibleRows} expandedRows={expandedRows} toggleRow={toggleRow} showFees={showFees} showDeferred={showDeferred} money={money}/>}
    </div>
    {!mobileTableMode && !monthsCollapsed && <div className="mobile-schedule-cards">{visibleRows.map(row => <article id={`mobile-schedule-row-${row.number}`} key={`card-${row.number}-${row.date}`} className={row.event ? 'schedule-card recalc-row' : 'schedule-card'}><div><span>№ {row.number}</span><b>{shortDate(row.date)}</b></div><dl><div><dt>По кредиту</dt><dd>{money(row.principalPaid ?? row.principal)}</dd></div><div><dt>Проценты</dt><dd>{money(row.interestPaid ?? row.interest)}</dd></div>{showFees && <div><dt>Комиссия</dt><dd>{money(rowFee(row))}</dd></div>}<div><dt>Итого</dt><dd>{money(rowTotal(row))}</dd></div><div><dt>Остаток</dt><dd>{money(row.closingBalance)}</dd></div>{showDeferred && <><div><dt>Отложенные проценты</dt><dd>{money(rowDeferredInterest(row))}</dd></div><div><dt>Общая задолженность</dt><dd>{money(rowTotalDebt(row))}</dd></div></>}</dl>{row.audit && <button className="ghost compact" onClick={() => toggleRow(row.number)} aria-expanded={expandedRows.has(row.number)} aria-controls={`mobile-audit-${row.number}`}>{expandedRows.has(row.number) ? 'Скрыть формулу' : 'Показать формулу'}</button>}{expandedRows.has(row.number) && <div id={`mobile-audit-${row.number}`} className="mobile-audit"><AuditCard row={row} money={money}/></div>}</article>)}</div>}
    {!monthsCollapsed && <table className="schedule-totals bank-schedule"><tfoot><tr><td colSpan={2}>Итого за весь срок</td><td>{money(totals.principal)}</td><td>{money(totals.interest)}</td>{showFees && <td>{money(totals.fee)}</td>}<td>{money(totals.total)}</td><td>{money(closingRow?.closingBalance ?? 0)}</td>{showDeferred && <><td>{money(closingRow?.deferredInterestClosing ?? 0)}</td><td>{money(closingRow ? rowTotalDebt(closingRow) : 0)}</td></>}</tr></tfoot></table>}
    {filteredSchedule.length > SCHEDULE_PAGE_SIZE && <nav className="schedule-pagination" aria-label="Страницы графика"><button className="ghost" disabled={pageOffset === 0} onClick={() => setRows(Math.max(0, pageOffset - SCHEDULE_PAGE_SIZE))}>Назад</button><span>Строки {pageOffset + 1}–{Math.min(pageOffset + SCHEDULE_PAGE_SIZE, filteredSchedule.length)} из {filteredSchedule.length}</span><button className="ghost" disabled={pageOffset + SCHEDULE_PAGE_SIZE >= filteredSchedule.length} onClick={() => setRows(pageOffset + SCHEDULE_PAGE_SIZE)}>Далее <ChevronDown/></button></nav>}
    {savedRows.length > 0 && <div className="saved-period"><div className="saved-period-head"><div><span className="eyebrow">Сокращённый срок</span><h4>Платежи исходного графика, которые больше не нужны</h4><p>Это хвост первоначального графика после даты закрытия выбранного сценария. Сумма “Итого” показывает платежи, которые исчезли из исходного графика, но не является чистой экономией: часть “по кредиту” — это основной долг, погашенный раньше. Экономия денег считается по процентам.</p></div><b>{savedRows.length} {plural(savedRows.length, 'платёж', 'платежа', 'платежей')}</b></div><div className="table-wrap"><table className="bank-schedule saved-schedule"><caption className="sr-only">Платежи исходного графика после даты закрытия выбранного сценария, которые больше не потребуются.</caption><thead><tr><th rowSpan={2}>№ п/п</th><th rowSpan={2}>Дата</th><th colSpan={showFees ? 4 : 3}>Сумма платежа по исходному графику</th><th rowSpan={2}>Остаток задолженности</th></tr><tr><th>По кредиту</th><th>По процентам</th>{showFees && <th>Комиссия</th>}<th>Итого</th></tr></thead><tbody>{savedRowsPage.visibleItems.map(row => <tr key={`saved-${row.number}-${row.date}`}><td>{row.number}</td><td>{shortDate(row.date)}</td><td>{money(row.principalPaid ?? row.principal)}</td><td>{money(row.interestPaid ?? row.interest)}</td>{showFees && <td>{money(rowFee(row))}</td>}<td>{money(rowTotal(row))}</td><td><b>{money(row.closingBalance)}</b></td></tr>)}</tbody><tfoot><tr><td colSpan={2}>Исчезнувшие платежи исходного графика</td><td>{money(savedTotals.principal)}</td><td>{money(savedTotals.interest)}</td>{showFees && <td>{money(savedTotals.fee)}</td>}<td>{money(savedTotals.total)}</td><td>—</td></tr></tfoot></table></div>{savedRowsPage.total > SAVED_ROWS_PAGE_SIZE && <nav className="schedule-pagination" aria-label="Страницы исчезнувших платежей"><button className="ghost" disabled={!savedRowsPage.hasPrevious} onClick={savedRowsPage.previous}>Назад</button><span>{savedRowsPage.start}–{savedRowsPage.end} из {savedRowsPage.total}</span><button className="ghost" disabled={!savedRowsPage.hasNext} onClick={savedRowsPage.next}>Следующие исчезнувшие платежи</button></nav>}<div className="saved-period-note"><CircleHelp/> Чистая финансовая экономия — это снижение процентов по всему кредиту, а не сумма всех исчезнувших строк исходного графика.</div></div>}
  </section>
}
