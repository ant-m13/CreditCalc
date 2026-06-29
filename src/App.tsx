import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { addMonths, differenceInCalendarMonths, format, parseISO } from 'date-fns'
import { ru } from 'date-fns/locale'
import { ArrowDownToLine, CalendarDays, Check, CircleHelp, Clock3, FileJson, Landmark, Link2, Menu, Pencil, Plus, Printer, ReceiptText, Settings2, ShieldCheck, Sparkles, Target, Trash2, TrendingDown, Upload, WalletCards, X } from 'lucide-react'
import { calculateInterest, compareScenarios, validateScenario, type EarlyRepayment, type GracePeriod, type LoanConfig, type PaymentScheduleItem } from './loanEngine'
import { parseLoanBackup, type LoanBackupData } from './importExport'
import { useLoanStore } from './store'
import { Schedule } from './components/Schedule'
import { FontControls } from './components/FontControls'
import { configureFormatters, currencySymbol, fmtMonths, fmtMonthsFull, money, plural, shortDate } from './formatters'
import { buildShareUrl, createLoanSnapshot, decodeSharedCalculation, readSharedCalculationFromLocation } from './shareCalculation'
import { expandRepaymentRules, type RepaymentRule } from './repaymentRules'
const todayISO = () => format(new Date(), 'yyyy-MM-dd')
const currentDebt = (schedule: PaymentScheduleItem[], config: LoanConfig, today = todayISO()) => {
  if (!schedule.length || today < config.issueDate) return { date: today, principal: 0, interest: 0, total: 0, fromDate: config.issueDate }
  const paidRows = schedule.filter(row => row.date <= today)
  const lastRow = paidRows.at(-1) ?? schedule[0]
  const principal = Math.max(0, lastRow.closingBalance)
  const interest = principal > 0 && lastRow.date < today ? calculateInterest(principal, config.annualRate, lastRow.date, today, config.interest).toDecimalPlaces(2).toNumber() : 0
  return { date: today, principal, interest, total: principal + interest, fromDate: lastRow.date }
}
const repaymentStrategyName = (strategy: EarlyRepayment['strategy']) => strategy === 'reduceTerm' ? 'сокращение срока' : strategy === 'reducePayment' ? 'уменьшение платежа' : strategy === 'full' ? 'полное погашение' : 'комбинированная'

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <label className="field"><span>{label}{hint && <span title={hint}><CircleHelp size={13}/></span>}</span>{children}</label>
}

function NumberInput({ value, onCommit, ...props }: { value: number; onCommit: (value: number) => void } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])
  const commit = (rawValue = draft) => {
    if (rawValue.trim() === '') return
    const parsed = Number(rawValue)
    if (!Number.isFinite(parsed)) { setDraft(String(value)); return }
    onCommit(parsed)
    setDraft(String(parsed))
  }
  return <input {...props} type="number" value={draft} onChange={event => setDraft(event.target.value)} onBlur={event => commit(event.currentTarget.value)} onKeyDown={event => {
    if (event.key === 'Enter') event.currentTarget.blur()
    if (event.key === 'Escape') { setDraft(String(value)); event.currentTarget.blur() }
  }}/>
}

function App() {
  const store = useLoanStore()
  configureFormatters(store.displayDecimals, store.config.currency)
  const [section, setSection] = useState('overview')
  const [showEarly, setShowEarly] = useState(false)
  const [editingEarly, setEditingEarly] = useState<EarlyRepayment | null>(null)
  const [showGrace, setShowGrace] = useState(false)
  const [mobileNav, setMobileNav] = useState(false)
  const [rows, setRows] = useState(18)
  const [importStatus, setImportStatus] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [sharedCalculation, setSharedCalculation] = useState<LoanBackupData | null>(null)
  // Keep typing responsive: the form updates immediately, while the four full
  // schedules are recalculated as a lower-priority render.
  const calculationConfig = useDeferredValue(store.config)
  const calculationRepayments = useDeferredValue(store.repayments)
  const calculationRepaymentRules = useDeferredValue(store.repaymentRules)
  const calculationGracePeriods = useDeferredValue(store.gracePeriods)
  const generatedRepayments = useMemo(() => expandRepaymentRules(calculationConfig, calculationRepaymentRules), [calculationConfig, calculationRepaymentRules])
  const allRepayments = useMemo(() => [...calculationRepayments, ...generatedRepayments].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)), [calculationRepayments, generatedRepayments])
  const comparison = useMemo(() => compareScenarios(calculationConfig, allRepayments, calculationGracePeriods), [calculationConfig, allRepayments, calculationGracePeriods])
  const selected = comparison.scenarios.find(s => s.id === store.selectedScenario) ?? comparison.scenarios[1]
  const base = comparison.scenarios[0]
  const errors = validateScenario(store.config, allRepayments, store.gracePeriods)
  const overviewChartData = useMemo(() => {
    const baseStep = Math.max(1, Math.floor(base.schedule.length / 48))
    const dates = new Set(base.schedule.filter((_, i) => i % baseStep === 0).map(row => row.date))
    if (base.schedule.at(-1)) dates.add(base.schedule.at(-1)!.date)
    if (selected.schedule.at(-1)) dates.add(selected.schedule.at(-1)!.date)
    const balanceAt = (schedule: PaymentScheduleItem[], date: string) => {
      let balance = schedule[0]?.closingBalance ?? 0
      for (const row of schedule) {
        if (row.date > date) break
        balance = row.closingBalance
      }
      return balance
    }
    const selectedClosingDate = selected.schedule.at(-1)?.date ?? ''
    return [...dates].sort().map(date => ({ date: format(parseISO(date), 'MMM yy', { locale: ru }), base: balanceAt(base.schedule, date), balance: date <= selectedClosingDate ? balanceAt(selected.schedule, date) : null }))
  }, [selected, base])

  const download = (kind: 'csv' | 'json' | 'xls') => {
    const schedule = selected.schedule
    let body = '', type = '', ext = kind
    if (kind === 'json') { body = JSON.stringify({ ...createLoanSnapshot({ config: store.config, repayments: store.repayments, repaymentRules: store.repaymentRules, gracePeriods: store.gracePeriods, selectedScenario: store.selectedScenario, termUnit: store.termUnit, displayDecimals: store.displayDecimals, appFontSize: store.appFontSize, scheduleFontSize: store.scheduleFontSize, theme: store.theme }), exportedAt: new Date().toISOString() }, null, 2); type = 'application/json' }
    else {
      const table = [['№ п/п','Дата','По кредиту','По процентам','Итого','Остаток задолженности'], ...schedule.map(r => [r.number,r.date,r.principal,r.interest,r.payment + r.earlyPayment,r.closingBalance])]
      body = kind === 'csv' ? '\ufeff' + table.map(r => r.join(';')).join('\n') : `<table>${table.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</table>`
      type = kind === 'csv' ? 'text/csv;charset=utf-8' : 'application/vnd.ms-excel'; ext = kind
    }
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([body], { type })); a.download = `ipoteka-${selected.id}.${ext}`; a.click(); URL.revokeObjectURL(a.href)
  }

  const importJson = async (file: File) => {
    try {
      const data = parseLoanBackup(await file.text())
      store.replaceData(data)
      setRows(18)
      setImportStatus({ kind: 'success', text: `Данные из «${file.name}» успешно загружены` })
    } catch (error) {
      setImportStatus({ kind: 'error', text: error instanceof Error ? error.message : 'Не удалось загрузить файл' })
    }
  }

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      const textarea = document.createElement('textarea')
      textarea.value = text
      textarea.setAttribute('readonly', '')
      textarea.style.position = 'fixed'
      textarea.style.left = '-9999px'
      document.body.appendChild(textarea)
      textarea.select()
      const copied = document.execCommand('copy')
      textarea.remove()
      if (!copied) throw new Error('Не удалось скопировать ссылку')
    }
  }

  const copyShareLink = async () => {
    try {
      const snapshot = createLoanSnapshot({ config: store.config, repayments: store.repayments, repaymentRules: store.repaymentRules, gracePeriods: store.gracePeriods, selectedScenario: store.selectedScenario, termUnit: store.termUnit, displayDecimals: store.displayDecimals, appFontSize: store.appFontSize, scheduleFontSize: store.scheduleFontSize, theme: store.theme })
      const url = await buildShareUrl(snapshot, window.location.href)
      await copyText(url)
      setImportStatus({ kind: 'success', text: 'Ссылка на расчёт скопирована' })
    } catch (error) {
      setImportStatus({ kind: 'error', text: error instanceof Error ? error.message : 'Не удалось сформировать ссылку на расчёт' })
    }
  }

  useEffect(() => {
    const payload = readSharedCalculationFromLocation(window.location)
    if (!payload) return
    let cancelled = false
    decodeSharedCalculation(payload).then(data => {
      if (cancelled) return
      setSharedCalculation(data)
    }).catch(error => {
      if (cancelled) return
      setImportStatus({ kind: 'error', text: error instanceof Error ? error.message : 'Ссылка повреждена. Проверьте ссылку или используйте JSON-файл' })
    })
    return () => { cancelled = true }
  }, [])

  const clearSharedHash = () => {
    const url = new URL(window.location.href)
    url.hash = ''
    window.history.replaceState(null, '', `${url.pathname}${url.search}`)
  }

  const restoreSharedCalculation = () => {
    if (!sharedCalculation) return
    store.replaceData(sharedCalculation)
    setRows(18)
    setSharedCalculation(null)
    setImportStatus({ kind: 'success', text: 'Расчёт загружен из ссылки' })
    clearSharedHash()
  }

  const declineSharedCalculation = () => {
    setSharedCalculation(null)
    setImportStatus({ kind: 'error', text: 'Загрузка из ссылки отменена. Локальные данные сохранены' })
    clearSharedHash()
  }

  const nav = [
    ['overview', Landmark, 'Обзор'], ['settings', Settings2, 'Параметры'], ['early', TrendingDown, 'Досрочные'],
    ['grace', CalendarDays, 'Льготные периоды'], ['schedule', ReceiptText, 'График платежей'], ['export', ArrowDownToLine, 'Импорт/экспорт']
  ] as const
  const openEarly = (repayment: EarlyRepayment | null = null) => { setEditingEarly(repayment); setShowEarly(true) }
  const closeEarly = () => { setShowEarly(false); setEditingEarly(null) }

  return <div className="app-shell" data-theme={store.theme} data-ui-font={store.appFontSize} data-schedule-font={store.scheduleFontSize}>
    <aside className={mobileNav ? 'sidebar open' : 'sidebar'}>
      <div className="brand"><div className="brand-mark"><Landmark size={22}/></div><div><b>Ипотека</b><span>умный калькулятор</span></div><button className="icon-btn close-nav" onClick={() => setMobileNav(false)}><X/></button></div>
      <nav>{nav.map(([id, Icon, label]) => <button key={id} className={section === id ? 'active' : ''} onClick={() => { setSection(id); setMobileNav(false) }}><Icon size={18}/><span>{label}</span>{id === 'early' && store.repayments.length > 0 && <em>{store.repayments.length}</em>}</button>)}</nav>
      <div className="sidebar-note"><ShieldCheck size={20}/><div><b>Расчёт локально</b><span>Ваши данные не покидают устройство</span></div></div>
    </aside>
    <main>
      <header><button className="icon-btn menu-btn" onClick={() => setMobileNav(true)}><Menu/></button><div className="header-title"><p>Финансовый план</p><h1>{section === 'overview' ? 'Ваша ипотека' : nav.find(x => x[0] === section)?.[2]}</h1></div><FontControls appFontSize={store.appFontSize} scheduleFontSize={store.scheduleFontSize} setAppFontSize={store.setAppFontSize} setScheduleFontSize={store.setScheduleFontSize}/><div className="header-actions"><span className="status-dot"><i/> Данные сохранены</span><button className="ghost print-action" onClick={() => window.print()}><Printer size={16}/> Печать</button><button className="primary add-payment-action" onClick={() => openEarly()}><Plus size={17}/> Досрочный платёж</button></div></header>
      <div className="content">
        {errors.length > 0 && <div className="alert">{errors.join(' · ')}</div>}
        {section === 'overview' && <Overview config={store.config} repayments={allRepayments} comparison={comparison} selected={selected} chartData={overviewChartData} onSelect={store.selectScenario} onOpen={() => openEarly()}/>}
        {section === 'settings' && <Settings config={store.config} update={store.updateConfig} updateInterest={store.updateInterest} termUnit={store.termUnit} setTermUnit={store.setTermUnit} displayDecimals={store.displayDecimals} setDisplayDecimals={store.setDisplayDecimals} appFontSize={store.appFontSize} setAppFontSize={store.setAppFontSize} scheduleFontSize={store.scheduleFontSize} setScheduleFontSize={store.setScheduleFontSize} theme={store.theme} setTheme={store.setTheme}/>}
        {section === 'early' && <EarlyList items={store.repayments} rules={store.repaymentRules} generated={generatedRepayments} remove={store.removeRepayment} edit={openEarly} open={() => openEarly()} addRule={store.addRepaymentRule} updateRule={store.updateRepaymentRule} removeRule={store.removeRepaymentRule} defaultStart={store.config.firstPaymentDate}/>}
        {section === 'grace' && <GraceList items={store.gracePeriods} remove={store.removeGrace} open={() => setShowGrace(true)}/>} 
        {section === 'schedule' && <Schedule schedule={selected.schedule} baseSchedule={base.schedule} rows={rows} setRows={setRows} more={() => setRows(r => r + 24)}/>}
        {section === 'export' && <ExportPanel download={download} importJson={importJson} copyShareLink={copyShareLink} status={importStatus}/>}
      </div>
    </main>
    <PrintReport config={store.config} repayments={allRepayments} comparison={comparison} selected={selected}/>
    {sharedCalculation && <SharedCalculationModal data={sharedCalculation} restore={restoreSharedCalculation} decline={declineSharedCalculation}/>}
    {showEarly && <EarlyModal close={closeEarly} save={editingEarly ? store.updateRepayment : store.addRepayment} initial={editingEarly} defaultDate={format(addMonths(parseISO(store.config.firstPaymentDate), 1), 'yyyy-MM-dd')}/>}
    {showGrace && <GraceModal close={() => setShowGrace(false)} add={store.addGrace}/>} 
  </div>
}

function Overview({ config, repayments, comparison, selected, chartData, onSelect, onOpen }: any) {
  const base = comparison.scenarios[0]
  const debt = currentDebt(selected.schedule, config)
  const earlyTotal = repayments.reduce((sum: number, item: EarlyRepayment) => sum + item.amount, 0)
  const today = todayISO()
  const currentRow = selected.schedule.filter((row: PaymentScheduleItem) => row.date <= today).at(-1)
  const principalPaidPercent = Math.min(100, Math.max(0, (config.principal - debt.principal) / Math.max(1, config.principal) * 100))
  const elapsedMonths = Math.max(0, differenceInCalendarMonths(parseISO(today), parseISO(config.issueDate)))
  const termPassedPercent = Math.min(100, elapsedMonths / Math.max(1, selected.termMonths) * 100)
  const interestPaidPercent = Math.min(100, (currentRow?.cumulativeInterest ?? 0) / Math.max(1, selected.totalInterest) * 100)
  const remainingMonths = Math.max(0, differenceInCalendarMonths(parseISO(selected.closingDate), parseISO(today)))
  const milestones = [
    { title: 'Остаток ниже 75%', done: debt.principal <= config.principal * .75 },
    { title: 'Половина кредита погашена', done: debt.principal <= config.principal * .5 },
    { title: 'Последний миллион', done: debt.principal <= 1_000_000 },
    { title: 'Последний год', done: remainingMonths <= 12 },
    { title: 'Полное закрытие', done: debt.principal <= 0 }
  ]
  return <>
    <section className="hero-card"><div><span className="eyebrow">Сумма кредита</span><strong>{money(base.schedule[0]?.openingBalance ?? 0)}</strong><div className="hero-meta"><span><WalletCards/>Платёж <b>{money(selected.monthlyPayment)}</b></span><span><CalendarDays/>Закрытие <b>{shortDate(selected.closingDate)}</b></span><span><Clock3/>Срок сценария <b>{fmtMonths(selected.termMonths)}</b></span></div></div><div className="hero-ring"><svg viewBox="0 0 42 42"><circle cx="21" cy="21" r="16"/><circle className="progress" cx="21" cy="21" r="16" strokeDasharray={`${Math.max(2, Math.round(selected.monthsSaved / Math.max(1, base.termMonths) * 100))} 100`}/></svg><div><b>−{selected.monthsSaved}</b><span>{fmtMonthsFull(selected.monthsSaved)}</span></div></div></section>
    <section className="current-debt-grid">
      <div className="current-debt main"><span>Остаток долга на {shortDate(debt.date)}</span><b>{money(debt.total)}</b><small>Тело кредита + начисленные проценты после {shortDate(debt.fromDate)}</small></div>
      <div className="current-debt"><span>Тело кредита</span><b>{money(debt.principal)}</b><small>Остаток основного долга</small></div>
      <div className="current-debt"><span>Проценты</span><b>{money(debt.interest)}</b><small>Начислено к сегодняшнему дню</small></div>
      <div className="current-debt"><span>Досрочно добавлено</span><b>{money(earlyTotal)}</b><small>{repayments.length ? `${repayments.length} ${plural(repayments.length, 'операция', 'операции', 'операций')}` : 'Операций нет'}</small></div>
    </section>
    <section className="panel progress-panel"><div className="panel-head"><div><h3>Прогресс погашения</h3><p>Наглядно показывает, где вы сейчас относительно выбранного сценария</p></div><b>До закрытия: {fmtMonthsFull(remainingMonths)}</b></div><div className="progress-grid"><ProgressBar title="Погашено основного долга" value={principalPaidPercent}/><ProgressBar title="Прошло срока" value={termPassedPercent}/><ProgressBar title="Выплачено процентов" value={interestPaidPercent}/></div><div className="milestone-list">{milestones.map(item => <span key={item.title} className={item.done ? 'done' : ''}>{item.done ? '✓' : '○'} {item.title}</span>)}</div></section>
    <div className="section-heading"><div><span className="eyebrow">Сценарии досрочного погашения</span><h2>Как применять добавленные досрочные платежи</h2></div><p>Выберите вариант сравнения. “По операциям” использует стратегию, указанную в каждой операции.</p></div>
    <div className="scenario-grid">{comparison.scenarios.slice(1).map((s: any, i: number) => <button key={s.id} className={selected.id === s.id ? 'scenario selected' : 'scenario'} onClick={() => onSelect(s.id)}><span className={`scenario-icon c${i}`} >{i === 0 ? <Target/> : i === 1 ? <WalletCards/> : <Sparkles/>}</span><span className="scenario-title">{s.name}{i === 0 && <em>Выгоднее</em>}</span><b>{money(s.monthlyPayment)} <small>/ мес</small></b><span className="scenario-stats"><i>Экономия <strong>{money(s.interestSavings, true)}</strong></i><i>Срок <strong>−{fmtMonthsFull(s.monthsSaved)}</strong></i></span><span className="radio">{selected.id === s.id && <Check size={14}/>}</span></button>)}</div>
    <section className="insight"><div className="insight-icon"><Sparkles/></div><div><span className="eyebrow">Пояснение</span><h3>Сейчас выбран сценарий «{selected.name}»</h3><p>В нём досрочные платежи пересчитывают график как <b>{selected.strategy === 'combined' ? 'указано в каждой операции' : selected.strategy === 'base' ? 'без досрочных платежей' : repaymentStrategyName(selected.strategy)}</b>. Сокращение срока: <b>{fmtMonthsFull(selected.monthsSaved)}</b>, экономия процентов: <b>{money(selected.interestSavings, true)}</b>.</p></div><button className="ghost" onClick={onOpen}>Добавить платёж</button></section>
    <section className="panel chart-panel"><div className="panel-head"><div><h3>Как меняется ваш долг</h3><p>Остаток основного долга по выбранной стратегии</p></div><span className="chart-legend"><i/> Ваш сценарий <i/> Базовый</span></div><ResponsiveContainer width="100%" height={280}><AreaChart data={chartData}><defs><linearGradient id="area" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--green)" stopOpacity={.32}/><stop offset="100%" stopColor="var(--green)" stopOpacity={0}/></linearGradient></defs><CartesianGrid stroke="#dce8e4" vertical={false}/><XAxis dataKey="date" tickLine={false} axisLine={false}/><YAxis tickFormatter={v => `${Math.round(v/1000000)}м`} tickLine={false} axisLine={false}/><Tooltip formatter={(v: unknown, name: unknown) => [money(Number(v ?? 0)), String(name)]}/><Area dataKey="base" name="Базовый график" stroke="#afc2bd" fill="none" strokeDasharray="5 5"/><Area dataKey="balance" name="Ваш сценарий" stroke="var(--green)" strokeWidth={3} fill="url(#area)"/></AreaChart></ResponsiveContainer></section>
  </>
}

function ProgressBar({ title, value }: { title: string; value: number }) {
  return <div className="progress-item"><div><span>{title}</span><b>{Math.round(value)}%</b></div><i><em style={{ width: `${Math.min(100, Math.max(0, value))}%` }}/></i></div>
}

function Settings({ config, update, updateInterest, termUnit, setTermUnit, displayDecimals, setDisplayDecimals, appFontSize, setAppFontSize, scheduleFontSize, setScheduleFontSize, theme, setTheme }: any) {
  return <div className="settings-layout"><section className="panel form-panel"><div className="panel-head"><div><h3>Параметры кредита</h3><p>Основные условия из кредитного договора</p></div></div><div className="form-grid">
    <Field label="Сумма кредита"><NumberInput value={config.principal} min="0" onCommit={principal => update({ principal })}/></Field><Field label="Годовая ставка"><div className="with-suffix"><NumberInput value={config.annualRate} min="0" step="0.1" onCommit={annualRate => update({ annualRate })}/><i>%</i></div></Field>
    <Field label="Дата выдачи"><input type="date" value={config.issueDate} onChange={e => update({ issueDate: e.target.value })}/></Field><Field label="Первый платёж"><input type="date" value={config.firstPaymentDate} onChange={e => update({ firstPaymentDate: e.target.value })}/></Field>
    <label className="toggle-row"><div><b>Первый платёж — только проценты</b><span>Как в графике банка: без погашения основного долга</span></div><input type="checkbox" checked={config.firstPaymentInterestOnly !== false} onChange={e => update({ firstPaymentInterestOnly: e.target.checked })}/></label>
    <Field label="Срок кредита"><div className="term-control"><NumberInput min="1" step={termUnit === 'years' ? .25 : 1} value={termUnit === 'years' ? Number((config.termMonths / 12).toFixed(2)) : config.termMonths} onCommit={value => update({ termMonths: Math.max(1, Math.round(value * (termUnit === 'years' ? 12 : 1))) })}/><select aria-label="Единица срока" value={termUnit} onChange={e => setTermUnit(e.target.value)}><option value="months">месяцев</option><option value="years">лет</option></select></div></Field><Field label="День платежа"><NumberInput min="1" max="31" value={config.paymentDay} onCommit={paymentDay => update({ paymentDay })}/></Field>
    <Field label="Тип платежа"><select value={config.paymentType} onChange={e => update({ paymentType: e.target.value })}><option value="annuity">Аннуитетный</option><option value="differentiated">Дифференцированный</option></select></Field><Field label="Периодичность"><select value={config.frequency} onChange={e => update({ frequency: e.target.value })}><option value="monthly">Ежемесячно</option><option value="biweekly">Раз в 2 недели</option><option value="quarterly">Ежеквартально</option></select></Field><Field label="Валюта"><select value={config.currency} onChange={e => update({ currency: e.target.value })}><option value="RUB">Российский рубль (₽)</option><option value="USD">Доллар США ($)</option><option value="EUR">Евро (€)</option><option value="CNY">Китайский юань (¥)</option></select></Field>
  </div></section><section className="panel form-panel"><div className="panel-head"><div><h3>Начисление процентов</h3><p>Настройте точное правило вашего банка</p></div></div><div className="form-grid">
    <Field label="Метод"><select value={config.interest.method} onChange={e => updateInterest({ method: e.target.value })}><option value="daily">По фактическим дням</option><option value="annuity">Номинальная ставка / период</option></select></Field><Field label="База года"><select value={config.interest.dayCountBasis} onChange={e => updateInterest({ dayCountBasis: e.target.value })}><option value="actualActual">Actual / Actual</option><option value="actual365">Actual / 365</option><option value="365">365 дней</option><option value="366">366 дней</option><option value="360">360 дней</option></select></Field>
    <Field label="Округление"><select value={config.rounding} onChange={e => update({ rounding: e.target.value })}><option value="kopecks">До копеек</option><option value="rubles">До рублей</option><option value="bank">Банковское</option></select></Field><Field label="Порог закрытия"><div className="with-suffix"><NumberInput min="0" value={config.closeThreshold} onCommit={closeThreshold => update({ closeThreshold })}/><i>₽</i></div></Field>
    <label className="toggle-row"><div><b>Включать дату платежа</b><span>В расчёт процентного периода</span></div><input type="checkbox" checked={config.interest.includePaymentDate} onChange={e => updateInterest({ includePaymentDate: e.target.checked })}/></label><Field label="Остаток для начисления"><select value={config.interest.balanceMoment} onChange={e => updateInterest({ balanceMoment: e.target.value })}><option value="startOfDay">На начало дня</option><option value="endOfDay">На конец дня</option></select></Field>
  </div></section><section className="panel form-panel"><div className="panel-head"><div><h3>Комиссии</h3><p>Необязательные расходы по договору</p></div></div><div className="form-grid"><Field label="Единовременная"><NumberInput min="0" value={config.oneTimeFee} onCommit={oneTimeFee => update({ oneTimeFee })}/></Field><Field label="Ежемесячная"><NumberInput min="0" value={config.monthlyFee} onCommit={monthlyFee => update({ monthlyFee })}/></Field><Field label="За досрочное погашение"><div className="with-suffix"><NumberInput min="0" value={config.earlyRepaymentFeePercent} onCommit={earlyRepaymentFeePercent => update({ earlyRepaymentFeePercent })}/><i>%</i></div></Field></div></section><section className="panel form-panel appearance-panel"><div className="panel-head"><div><h3>Интерфейс</h3><p>Внешний вид, размер текста и формат отображения сумм</p></div></div><div className="form-grid"><Field label="Цветовая схема"><select value={theme} onChange={e => setTheme(e.target.value)}><option value="emerald">Изумрудная</option><option value="ocean">Океан</option><option value="violet">Фиолетовая</option><option value="graphite">Графитовая</option></select></Field><Field label="Точность денежных сумм"><select value={displayDecimals} onChange={e => setDisplayDecimals(+e.target.value)}><option value="2">До копеек — 0,00 ₽</option><option value="0">До рублей — 0 ₽</option></select></Field><Field label="Размер текста в приложении"><select value={appFontSize} onChange={e => setAppFontSize(e.target.value)}><option value="normal">Обычный</option><option value="large">Крупнее</option><option value="xlarge">Максимальный</option></select></Field><Field label="Размер текста в графике"><select value={scheduleFontSize} onChange={e => setScheduleFontSize(e.target.value)}><option value="normal">Обычный</option><option value="large">Крупнее</option><option value="xlarge">Максимальный</option></select></Field></div></section></div>
}

function EarlyList({ items, rules, generated, remove, edit, open, addRule, updateRule, removeRule, defaultStart }: { items: EarlyRepayment[]; rules: RepaymentRule[]; generated: EarlyRepayment[]; remove: (id: string) => void; edit: (item: EarlyRepayment) => void; open: () => void; addRule: (rule: RepaymentRule) => void; updateRule: (rule: RepaymentRule) => void; removeRule: (id: string) => void; defaultStart: string }) { return <><section className="panel list-panel"><div className="panel-head"><div><h3>Досрочные платежи</h3><p>Разовые операции вводятся вручную, правила создают операции автоматически</p></div><button className="primary" onClick={open}><Plus/> Добавить</button></div>{items.length ? <div className="event-list">{items.map(x => <div className="event" key={x.id}><div className="date-tile"><b>{format(parseISO(x.date),'dd')}</b><span>{format(parseISO(x.date),'MMM yy',{locale:ru})}</span></div><div><b>{money(x.amount)}</b><span>{x.strategy === 'reduceTerm' ? 'Сокращение срока' : x.strategy === 'reducePayment' ? 'Уменьшение платежа' : 'Полное погашение'} · {x.amountMode === 'total' ? 'общая сумма из графика' : 'досрочная часть'} · {x.source === 'own' ? 'Собственные средства' : 'Целевой источник'}</span>{x.comment && <small>{x.comment}</small>}</div><div className="event-actions"><button className="icon-btn" aria-label={`Редактировать платёж ${shortDate(x.date)}`} onClick={() => edit(x)}><Pencil/></button><button className="icon-btn danger" aria-label={`Удалить платёж ${shortDate(x.date)}`} onClick={() => remove(x.id)}><Trash2/></button></div></div>)}</div> : <Empty icon={<TrendingDown/>} title="Пока нет разовых досрочных платежей" action={open}/>}<div className="tip"><CircleHelp/> Правила ниже разворачиваются в обычные досрочные платежи перед расчётом. Сейчас создано {generated.length} автоматических операций.</div></section><RepaymentRulesPanel rules={rules} addRule={addRule} updateRule={updateRule} removeRule={removeRule} defaultStart={defaultStart}/></> }

function RepaymentRulesPanel({ rules, addRule, updateRule, removeRule, defaultStart }: { rules: RepaymentRule[]; addRule: (rule: RepaymentRule) => void; updateRule: (rule: RepaymentRule) => void; removeRule: (id: string) => void; defaultStart: string }) {
  const [type,setType]=useState<RepaymentRule['type']>('monthlyFixed'), [start,setStart]=useState(defaultStart), [end,setEnd]=useState(format(addMonths(parseISO(defaultStart), 12), 'yyyy-MM-dd')), [amount,setAmount]=useState('20000'), [percent,setPercent]=useState('10'), [skip,setSkip]=useState('')
  const [strategy,setStrategy]=useState<EarlyRepayment['strategy']>('reduceTerm'), [source,setSource]=useState<EarlyRepayment['source']>('own'), [sameDayOrder,setSameDayOrder]=useState<EarlyRepayment['sameDayOrder']>('regularFirst')
  const [editingRule,setEditingRule]=useState<RepaymentRule|null>(null)
  const reset=()=>{setEditingRule(null);setType('monthlyFixed');setStart(defaultStart);setEnd(format(addMonths(parseISO(defaultStart),12),'yyyy-MM-dd'));setAmount('20000');setPercent('10');setSkip('');setStrategy('reduceTerm');setSource('own');setSameDayOrder('regularFirst')}
  const startEdit=(rule:RepaymentRule)=>{setEditingRule(rule);setType(rule.type);setStart(rule.startDate);setEnd(rule.endDate);setAmount(String(rule.amount??20000));setPercent(String(rule.percent??10));setSkip(rule.skipMonths.join(', '));setStrategy(rule.strategy);setSource(rule.source);setSameDayOrder(rule.sameDayOrder)}
  const submit=()=>{ const value=Number(type==='paymentPercent'?percent:amount); if(!Number.isFinite(value)||value<=0||start>end)return; const skipMonths=skip.split(/[,\s;]+/).map(x=>x.trim()).filter(Boolean); const rule={id:editingRule?.id??crypto.randomUUID(),name:type==='monthlyFixed'?'Ежемесячное пополнение':type==='annualBonus'?'Ежегодная премия':'Процент от платежа',type,startDate:start,endDate:end,amount:type==='paymentPercent'?undefined:value,percent:type==='paymentPercent'?value:undefined,strategy,source,sameDayOrder,interestFirst:true,skipMonths,comment:type==='paymentPercent'?`${value}% от регулярного платежа`:undefined}; editingRule?updateRule(rule):addRule(rule); reset() }
  return <section className="panel list-panel rule-panel"><div className="panel-head"><div><h3>Правила досрочных платежей</h3><p>{editingRule?'Редактирование выбранного правила':'Автоматически создают операции до заданной даты'}</p></div></div><div className="rule-form form-grid"><Field label="Тип правила"><select value={type} onChange={e=>setType(e.target.value as RepaymentRule['type'])}><option value="monthlyFixed">Каждый месяц фиксированная сумма</option><option value="annualBonus">Ежегодно вносить премию</option><option value="paymentPercent">Процент от регулярного платежа</option></select></Field><Field label={type==='paymentPercent'?'Процент':'Сумма'}>{type==='paymentPercent'?<div className="with-suffix"><input type="number" min="0" value={percent} onChange={e=>setPercent(e.target.value)}/><i>%</i></div>:<div className="with-suffix"><input type="number" min="0" value={amount} onChange={e=>setAmount(e.target.value)}/><i>{currencySymbol()}</i></div>}</Field><Field label="Начать с"><input type="date" value={start} onChange={e=>setStart(e.target.value)}/></Field><Field label="Применять до"><input type="date" value={end} onChange={e=>setEnd(e.target.value)}/></Field><Field label="Стратегия"><select value={strategy} onChange={e=>setStrategy(e.target.value as EarlyRepayment['strategy'])}><option value="reduceTerm">Уменьшить срок</option><option value="reducePayment">Уменьшить платёж</option><option value="full">Закрыть полностью</option><option value="custom">Комбинированная</option></select></Field><Field label="Источник"><select value={source} onChange={e=>setSource(e.target.value as EarlyRepayment['source'])}><option value="own">Собственные средства</option><option value="subsidy">Маткапитал / субсидия</option><option value="insurance">Страховое возмещение</option><option value="other">Прочее</option></select></Field><Field label="Порядок в дату платежа"><select value={sameDayOrder} onChange={e=>setSameDayOrder(e.target.value as EarlyRepayment['sameDayOrder'])}><option value="regularFirst">Сначала регулярный платёж</option><option value="earlyFirst">Сначала досрочный платёж</option></select></Field><Field label="Пропустить месяцы"><input value={skip} onChange={e=>setSkip(e.target.value)} placeholder="2027-01, 2027-05"/></Field></div><div className="rule-actions"><button className="primary rule-add" onClick={submit}><Plus/> {editingRule?'Сохранить изменения':'Добавить правило'}</button>{editingRule&&<button className="ghost" onClick={reset}>Отмена</button>}</div>{rules.length ? <div className="event-list rule-list">{rules.map(rule => <div className="event" key={rule.id}><div className="date-tile"><CalendarDays/></div><div><b>{rule.name}</b><span>{rule.type==='paymentPercent'?`${rule.percent}% от регулярного платежа`:money(rule.amount ?? 0)} · {shortDate(rule.startDate)} — {shortDate(rule.endDate)} · пропусков: {rule.skipMonths.length}</span></div><div className="event-actions"><button className="icon-btn" aria-label={`Редактировать правило ${rule.name}`} onClick={()=>startEdit(rule)}><Pencil/></button><button className="icon-btn danger" aria-label={`Удалить правило ${rule.name}`} onClick={()=>removeRule(rule.id)}><Trash2/></button></div></div>)}</div> : <div className="tip"><CircleHelp/> Например: +20 000 ₽ каждый месяц до 2030 года, премия раз в год или 10% от регулярного платежа.</div>}</section>
}
function GraceList({ items, remove, open }: { items: GracePeriod[]; remove: (id: string) => void; open: () => void }) { return <section className="panel list-panel"><div className="panel-head"><div><h3>Льготные периоды</h3><p>Отсрочка, проценты или индивидуальный платёж</p></div><button className="primary" onClick={open}><Plus/> Добавить</button></div>{items.length ? <div className="event-list">{items.map(x => <div className="event" key={x.id}><div className="date-tile"><CalendarDays/></div><div><b>{shortDate(x.startDate)} — {shortDate(x.endDate)}</b><span>{x.type === 'full' ? 'Полная отсрочка' : x.type === 'interestOnly' ? 'Только проценты' : 'Особый платёж'} · {x.extendTerm ? 'с продлением срока' : 'без продления'}</span></div><button className="icon-btn danger" onClick={() => remove(x.id)}><Trash2/></button></div>)}</div> : <Empty icon={<CalendarDays/>} title="Льготные периоды не добавлены" action={open}/>}<div className="tip"><CircleHelp/> После льготного периода сначала могут погашаться отложенные платежи и проценты.</div></section> }

function ExportPanel({ download, importJson, copyShareLink, status }: { download: (x: 'csv'|'json'|'xls') => void; importJson: (file: File) => void; copyShareLink: () => void; status: { kind: 'success' | 'error'; text: string } | null }) {
  const inputRef = useRef<HTMLInputElement>(null)
  return <section className="panel export-panel"><div className="panel-head"><div><h3>Экспорт и импорт расчёта</h3><p>Сохраните резервную копию, передайте ссылку или восстановите расчёт из JSON</p></div></div><div className="export-grid"><button onClick={() => download('csv')}><span className="export-icon green"><ReceiptText/></span><b>CSV</b><small>График для таблиц</small><ArrowDownToLine/></button><button onClick={() => download('xls')}><span className="export-icon emerald"><Landmark/></span><b>Excel</b><small>Совместимо с .xls</small><ArrowDownToLine/></button><button onClick={() => download('json')}><span className="export-icon violet"><FileJson/></span><b>Сохранить JSON</b><small>Резервная копия всех настроек</small><ArrowDownToLine/></button><button onClick={() => inputRef.current?.click()}><span className="export-icon import"><Upload/></span><b>Загрузить JSON</b><small>Восстановить сохранённый расчёт</small><Upload/></button><button onClick={copyShareLink}><span className="export-icon link"><Link2/></span><b>Ссылка на расчёт</b><small>Передать параметры кредита и досрочные платежи</small><Link2/></button><button onClick={() => window.print()}><span className="export-icon amber"><Printer/></span><b>PDF / печать</b><small>Печатная версия</small><ArrowDownToLine/></button></div><input ref={inputRef} className="file-input" type="file" accept="application/json,.json" onChange={event => { const file = event.target.files?.[0]; if (file) importJson(file); event.currentTarget.value = '' }}/>{status && <div className={`import-status ${status.kind}`} role="status" aria-live="polite">{status.kind === 'success' ? <Check/> : <CircleHelp/>}{status.text}</div>}</section>
}

function SharedCalculationModal({ data, restore, decline }: { data: LoanBackupData; restore: () => void; decline: () => void }) {
  return <div className="modal-backdrop"><div className="modal shared-modal"><div className="modal-head"><div><span className="eyebrow">Ссылка на расчёт</span><h2>Восстановить расчёт из ссылки?</h2></div><button className="icon-btn" onClick={decline}><X/></button></div><div className="modal-body"><p className="share-warning">Ссылка содержит параметры кредита, досрочные платежи и льготные периоды. Если восстановить расчёт, текущие локальные данные будут заменены.</p><dl className="share-summary"><div><dt>Сумма кредита</dt><dd>{money(data.config.principal)}</dd></div><div><dt>Ставка</dt><dd>{data.config.annualRate}%</dd></div><div><dt>Дата выдачи</dt><dd>{shortDate(data.config.issueDate)}</dd></div><div><dt>Первый платёж</dt><dd>{shortDate(data.config.firstPaymentDate)}</dd></div><div><dt>Срок</dt><dd>{fmtMonthsFull(data.config.termMonths)}</dd></div><div><dt>Досрочные платежи</dt><dd>{data.repayments.length}</dd></div><div><dt>Льготные периоды</dt><dd>{data.gracePeriods.length}</dd></div><div><dt>Сценарий</dt><dd>{data.selectedScenario}</dd></div></dl></div><div className="modal-actions"><button className="ghost" onClick={decline}>Отказаться</button><button className="primary" onClick={restore}>Восстановить настройки</button></div></div></div>
}

function PrintReport({ config, repayments, comparison, selected }: any) {
  const generated = format(new Date(), 'dd.MM.yyyy HH:mm')
  return <article className="print-report">
    <div className="print-title"><div><span>Ипотечный калькулятор</span><h1>Расчёт ипотечного кредита</h1><p>Сформировано {generated} · сценарий «{selected.name}»</p></div><Landmark/></div>
    <section className="print-summary"><div><span>Сумма кредита</span><b>{money(config.principal)}</b></div><div><span>Ежемесячный платёж</span><b>{money(selected.monthlyPayment)}</b></div><div><span>Дата закрытия</span><b>{shortDate(selected.closingDate)}</b></div><div><span>Переплата</span><b>{money(selected.overpayment)}</b></div></section>
    <h2>Параметры кредита</h2>
    <dl className="print-params"><div><dt>Ставка</dt><dd>{config.annualRate}% годовых</dd></div><div><dt>Срок</dt><dd>{fmtMonths(config.termMonths)} ({config.termMonths} мес.)</dd></div><div><dt>Дата выдачи</dt><dd>{shortDate(config.issueDate)}</dd></div><div><dt>Первый платёж</dt><dd>{shortDate(config.firstPaymentDate)}</dd></div><div><dt>Тип платежа</dt><dd>{config.paymentType === 'annuity' ? 'Аннуитетный' : 'Дифференцированный'}</dd></div><div><dt>Начисление</dt><dd>{config.interest.method === 'daily' ? 'По фактическим дням' : 'По периодам'}, {config.interest.dayCountBasis}</dd></div></dl>
    <h2>Сравнение сценариев</h2>
    <table className="print-comparison"><thead><tr><th>Сценарий</th><th>Платёж</th><th>Дата закрытия</th><th>Проценты</th><th>Экономия</th></tr></thead><tbody>{comparison.scenarios.map((s: any) => <tr key={s.id} className={s.id === selected.id ? 'chosen' : ''}><td>{s.name}</td><td>{money(s.monthlyPayment)}</td><td>{shortDate(s.closingDate)}</td><td>{money(s.totalInterest)}</td><td>{money(s.interestSavings)}</td></tr>)}</tbody></table>
    <h2>Досрочные платежи</h2>
    {repayments.length ? <table><thead><tr><th>Дата</th><th>Сумма</th><th>Стратегия</th><th>Комментарий</th></tr></thead><tbody>{repayments.map((r: EarlyRepayment) => <tr key={r.id}><td>{shortDate(r.date)}</td><td>{money(r.amount)}</td><td>{r.strategy === 'reduceTerm' ? 'Сократить срок' : r.strategy === 'reducePayment' ? 'Снизить платёж' : r.strategy === 'full' ? 'Полное погашение' : 'Комбинированная'}</td><td>{r.comment || '—'}</td></tr>)}</tbody></table> : <p className="print-muted">Досрочные платежи не добавлены.</p>}
    <h2 className="page-break">График платежей — {selected.name}</h2>
    <table className="print-schedule"><thead><tr><th rowSpan={2}>№ п/п</th><th rowSpan={2}>Дата</th><th colSpan={3}>Сумма платежа</th><th rowSpan={2}>Остаток задолженности</th></tr><tr><th>По кредиту</th><th>По процентам</th><th>Итого</th></tr></thead><tbody>{selected.schedule.map((r: PaymentScheduleItem) => <tr key={`${r.number}-${r.date}`} className={r.event ? 'print-event' : ''}><td>{r.number}</td><td>{shortDate(r.date)}</td><td>{money(r.principal)}</td><td>{money(r.interest)}</td><td>{money(r.payment + r.earlyPayment)}</td><td>{money(r.closingBalance)}</td></tr>)}</tbody></table>
    <footer>Расчёт носит информационный характер. Фактический график определяется условиями кредитного договора и правилами банка.</footer>
  </article>
}

function Empty({ icon, title, action }: any) { return <div className="empty"><span>{icon}</span><h3>{title}</h3><p>Добавьте событие, и мы сразу покажем его влияние на ипотеку.</p><button className="ghost" onClick={action}><Plus/> Добавить</button></div> }

function EarlyModal({ close, save, initial, defaultDate }: { close:()=>void; save:(x:EarlyRepayment)=>void; initial:EarlyRepayment|null; defaultDate:string }) {
  const [date,setDate]=useState(initial?.date ?? defaultDate), [amount,setAmount]=useState(initial ? String(initial.amount) : '100000'), [strategy,setStrategy]=useState<EarlyRepayment['strategy']>(initial?.strategy ?? 'reduceTerm'), [source,setSource]=useState<EarlyRepayment['source']>(initial?.source ?? 'own'), [comment,setComment]=useState(initial?.comment ?? '')
  const [amountMode,setAmountMode]=useState<NonNullable<EarlyRepayment['amountMode']>>(initial?.amountMode ?? 'extra')
  const [sameDayOrder,setSameDayOrder]=useState<EarlyRepayment['sameDayOrder']>(initial?.sameDayOrder ?? 'regularFirst'), [interestFirst,setInterestFirst]=useState(initial?.interestFirst ?? true)
  const submit=()=>{ const parsed=Number(amount); if(!Number.isFinite(parsed)||parsed<=0)return; save({id:initial?.id ?? crypto.randomUUID(),date,amount:parsed,amountMode,strategy,source,sameDayOrder:amountMode==='total'?'regularFirst':sameDayOrder,interestFirst,comment}); close() }
  return <div className="modal-backdrop" onMouseDown={e => e.target===e.currentTarget&&close()}><div className="modal"><div className="modal-head"><div><span className="eyebrow">{initial ? 'Редактирование события' : 'Новое событие'}</span><h2>Досрочный платёж</h2></div><button className="icon-btn" onClick={close}><X/></button></div><div className="modal-body"><div className="form-grid"><Field label="Дата"><input type="date" value={date} onChange={e=>setDate(e.target.value)}/></Field><Field label="Сумма"><div className="with-suffix"><input autoFocus type="number" value={amount} onChange={e=>setAmount(e.target.value)}/><i>{currencySymbol()}</i></div></Field><Field label="Как указана сумма"><select value={amountMode} onChange={e=>setAmountMode(e.target.value as NonNullable<EarlyRepayment['amountMode']>)}><option value="extra">Только досрочная часть</option><option value="total">Общая сумма из графика банка</option></select></Field><Field label="Стратегия"><select value={strategy} onChange={e=>setStrategy(e.target.value as any)}><option value="reduceTerm">Уменьшить срок</option><option value="reducePayment">Уменьшить платёж</option><option value="full">Закрыть полностью</option><option value="custom">Комбинированная</option></select></Field><Field label="Источник"><select value={source} onChange={e=>setSource(e.target.value as any)}><option value="own">Собственные средства</option><option value="subsidy">Маткапитал / субсидия</option><option value="insurance">Страховое возмещение</option><option value="other">Прочее</option></select></Field>{amountMode === 'extra' && <Field label="Порядок в дату платежа"><select value={sameDayOrder} onChange={e=>setSameDayOrder(e.target.value as EarlyRepayment['sameDayOrder'])}><option value="regularFirst">Сначала регулярный платёж</option><option value="earlyFirst">Сначала досрочный платёж</option></select></Field>}<label className="toggle-row"><div><b>Сначала погасить проценты</b><span>Остаток направить в основной долг</span></div><input type="checkbox" checked={interestFirst} onChange={e=>setInterestFirst(e.target.checked)}/></label></div><Field label="Комментарий"><input value={comment} onChange={e=>setComment(e.target.value)} placeholder="Например, премия за год"/></Field><div className="modal-tip"><Sparkles/> Для банковского примера 26.01.2026 укажите досрочную часть 8 704,99 ₽. Итог строки станет 44 184,80 ₽.</div></div><div className="modal-actions"><button className="ghost" onClick={close}>Отмена</button><button className="primary" onClick={submit}>{initial ? 'Сохранить изменения' : 'Добавить и пересчитать'}</button></div></div></div>
}

function GraceModal({ close, add }: { close:()=>void; add:(x:GracePeriod)=>void }) {
 const [start,setStart]=useState('2027-03-01'),[end,setEnd]=useState('2027-05-31'),[type,setType]=useState<GracePeriod['type']>('interestOnly'),[extend,setExtend]=useState(true)
 const save=()=>{add({id:crypto.randomUUID(),startDate:start,endDate:end,type,extendTerm:extend,accrueInterest:true,capitalizeInterest:false});close()}
 return <div className="modal-backdrop"><div className="modal"><div className="modal-head"><div><span className="eyebrow">Условия договора</span><h2>Льготный период</h2></div><button className="icon-btn" onClick={close}><X/></button></div><div className="modal-body"><div className="form-grid"><Field label="Начало"><input type="date" value={start} onChange={e=>setStart(e.target.value)}/></Field><Field label="Окончание"><input type="date" value={end} onChange={e=>setEnd(e.target.value)}/></Field><Field label="Режим"><select value={type} onChange={e=>setType(e.target.value as any)}><option value="full">Полная отсрочка</option><option value="interestOnly">Только проценты</option><option value="reduced">Уменьшенный платёж</option><option value="custom">Индивидуальный</option></select></Field><label className="toggle-row"><div><b>Продлить срок</b><span>На период действия льготы</span></div><input type="checkbox" checked={extend} onChange={e=>setExtend(e.target.checked)}/></label></div></div><div className="modal-actions"><button className="ghost" onClick={close}>Отмена</button><button className="primary" onClick={save}>Добавить период</button></div></div></div>
}

export default App
