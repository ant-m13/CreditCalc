import { useDeferredValue, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { addMonths, format, parseISO } from 'date-fns'
import { ru } from 'date-fns/locale'
import { ArrowDownToLine, CalendarDays, CircleHelp, History, Landmark, Menu, Moon, Plus, Printer, ReceiptText, Settings2, ShieldCheck, Sun, Trash2, TrendingDown, X } from 'lucide-react'
import { compareScenarios, validateScenario, type EarlyRepayment, type GracePeriod, type PaymentScheduleItem } from './loanEngine'
import type { LoanBackupData } from './importExport'
import { loanToBackupData, useLoanStore, type LoanProfile } from './store'
import { Schedule } from './components/Schedule'
import { FontControls } from './components/FontControls'
import { Overview } from './components/Overview'
import { Settings } from './components/Settings'
import { LoanSwitcher } from './components/LoanSwitcher'
import { EarlyList } from './components/EarlyList'
import { ExportPanel } from './components/ExportPanel'
import { SharedCalculationModal } from './components/SharedCalculationModal'
import { PrintReport } from './components/PrintReport'
import { Changelog, WhatsNewModal } from './components/Changelog'
import { OnboardingModal } from './components/OnboardingModal'
import { EarlyModal } from './components/EarlyModal'
import { GraceModal } from './components/GraceModal'
import { configureFormatters, money, shortDate } from './formatters'
import { buildShareUrl, createLoanSnapshot, decodeSharedCalculation, readSharedCalculationFromLocation } from './shareCalculation'
import { expandRepaymentRules } from './repaymentRules'
import { APP_VERSION } from './version'
import { graceTypeName } from './labels'

const buildLoanCalculation = (loan: LoanProfile) => {
  const generated = expandRepaymentRules(loan.config, loan.repaymentRules)
  const repayments = [...loan.repayments, ...generated].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
  const comparison = compareScenarios(loan.config, repayments, loan.gracePeriods)
  const selected = comparison.scenarios.find(s => s.id === loan.selectedScenario) ?? comparison.scenarios[1]
  return { generated, repayments, comparison, selected }
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
  const [exportLoanId, setExportLoanId] = useState(store.activeLoanId)
  const [importStatus, setImportStatus] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [sharedCalculation, setSharedCalculation] = useState<LoanBackupData | null>(null)
  const [showWhatsNew, setShowWhatsNew] = useState(false)
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [lastLightTheme, setLastLightTheme] = useState<'emerald' | 'ocean' | 'violet' | 'graphite' | 'warm'>('emerald')
  useEffect(() => { if (!store.loans.some(loan => loan.id === exportLoanId)) setExportLoanId(store.activeLoanId) }, [store.loans, store.activeLoanId, exportLoanId])

  const calculationConfig = useDeferredValue(store.config)
  const calculationRepayments = useDeferredValue(store.repayments)
  const calculationRepaymentRules = useDeferredValue(store.repaymentRules)
  const calculationGracePeriods = useDeferredValue(store.gracePeriods)
  const validationErrors = useMemo(() => validateScenario(calculationConfig, calculationRepayments, calculationGracePeriods), [calculationConfig, calculationRepayments, calculationGracePeriods])
  const generatedResult = useMemo(() => {
    if (validationErrors.length > 0) return { items: [] as EarlyRepayment[], error: null as string | null }
    try {
      return { items: expandRepaymentRules(calculationConfig, calculationRepaymentRules), error: null as string | null }
    } catch (error) {
      return { items: [] as EarlyRepayment[], error: error instanceof Error ? error.message : 'Не удалось создать операции по правилам досрочных платежей' }
    }
  }, [calculationConfig, calculationRepaymentRules, validationErrors])
  const generatedRepayments = generatedResult.items
  const allRepayments = useMemo(() => [...calculationRepayments, ...generatedRepayments].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)), [calculationRepayments, generatedRepayments])
  const errors = useMemo(() => generatedResult.error ? [...validationErrors, generatedResult.error] : validationErrors, [validationErrors, generatedResult.error])
  const comparison = useMemo(() => errors.length === 0 ? compareScenarios(calculationConfig, allRepayments, calculationGracePeriods) : null, [calculationConfig, allRepayments, calculationGracePeriods, errors])
  const selected = comparison?.scenarios.find(s => s.id === store.selectedScenario) ?? comparison?.scenarios[1] ?? null
  const base = comparison?.scenarios[0] ?? null
  const overviewChartData = useMemo(() => {
    if (!base || !selected) return []
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

  const download = (kind: 'csv' | 'json' | 'xls', loanId = exportLoanId) => {
    const loan = store.loans.find(item => item.id === loanId) ?? store.loans.find(item => item.id === store.activeLoanId) ?? store.loans[0]
    const calculation = buildLoanCalculation(loan)
    const schedule = calculation.selected.schedule
    let body = '', type = '', ext = kind
    if (kind === 'json') { body = JSON.stringify({ ...createLoanSnapshot(loanToBackupData(loan)), exportedAt: new Date().toISOString() }, null, 2); type = 'application/json' }
    else {
      const table = [['№ п/п','Дата','По кредиту','По процентам','Итого','Остаток задолженности'], ...schedule.map(r => [r.number,r.date,r.principal,r.interest,r.payment + r.earlyPayment,r.closingBalance])]
      body = kind === 'csv' ? '\ufeff' + table.map(r => r.join(';')).join('\n') : `<table>${table.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</table>`
      type = kind === 'csv' ? 'text/csv;charset=utf-8' : 'application/vnd.ms-excel'; ext = kind
    }
    const safeName = loan.name.toLowerCase().replace(/[^a-zа-яё0-9]+/gi, '-').replace(/^-|-$/g, '') || 'credit'
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([body], { type })); a.download = `credit-${safeName}.${ext}`; a.click(); URL.revokeObjectURL(a.href)
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
      const loan = store.loans.find(item => item.id === exportLoanId) ?? store.loans.find(item => item.id === store.activeLoanId) ?? store.loans[0]
      const snapshot = createLoanSnapshot(loanToBackupData(loan))
      const url = await buildShareUrl(snapshot, window.location.href)
      await copyText(url)
      setImportStatus({ kind: 'success', text: `Ссылка на кредит «${loan.name}» скопирована` })
    } catch (error) {
      setImportStatus({ kind: 'error', text: error instanceof Error ? error.message : 'Не удалось сформировать ссылку на расчёт' })
    }
  }

  useEffect(() => {
    const payload = readSharedCalculationFromLocation(window.location)
    if (!payload) return
    let cancelled = false
    decodeSharedCalculation(payload).then(data => {
      if (!cancelled) setSharedCalculation(data)
    }).catch(error => {
      if (!cancelled) setImportStatus({ kind: 'error', text: error instanceof Error ? error.message : 'Ссылка повреждена. Проверьте ссылку или используйте JSON-файл' })
    })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const onboardingDone = localStorage.getItem('credit-calculator-onboarding-done') === 'yes'
    if (!onboardingDone) { setShowOnboarding(true); return }
    const seenVersion = localStorage.getItem('credit-calculator-seen-version')
    if (seenVersion !== APP_VERSION) setShowWhatsNew(true)
  }, [])

  useEffect(() => {
    if (store.theme !== 'night') setLastLightTheme(store.theme)
  }, [store.theme])

  const closeWhatsNew = () => {
    localStorage.setItem('credit-calculator-seen-version', APP_VERSION)
    setShowWhatsNew(false)
  }
  const finishOnboarding = () => {
    localStorage.setItem('credit-calculator-onboarding-done', 'yes')
    localStorage.setItem('credit-calculator-seen-version', APP_VERSION)
    setShowOnboarding(false)
  }

  const clearSharedHash = () => {
    const url = new URL(window.location.href)
    url.hash = ''
    window.history.replaceState(null, '', `${url.pathname}${url.search}`)
  }

  const createLoanFromData = (data: LoanBackupData, source = 'данных') => {
    store.addLoanFromData(data)
    setRows(18)
    setImportStatus({ kind: 'success', text: `Создан новый кредит из ${source}` })
  }

  const replaceActiveWithData = (data: LoanBackupData, source = 'данных') => {
    store.replaceData(data)
    setRows(18)
    setImportStatus({ kind: 'success', text: `Текущий кредит заменён данными из ${source}` })
  }

  const createLoanFromSharedCalculation = () => {
    if (!sharedCalculation) return
    createLoanFromData(sharedCalculation, 'ссылки')
    setSharedCalculation(null)
    clearSharedHash()
  }

  const replaceActiveWithSharedCalculation = () => {
    if (!sharedCalculation) return
    replaceActiveWithData(sharedCalculation, 'ссылки')
    setSharedCalculation(null)
    clearSharedHash()
  }

  const declineSharedCalculation = () => {
    setSharedCalculation(null)
    setImportStatus({ kind: 'error', text: 'Загрузка из ссылки отменена. Локальные данные сохранены' })
    clearSharedHash()
  }

  const nav = [
    ['overview', Landmark, 'Обзор'], ['settings', Settings2, 'Параметры'], ['early', TrendingDown, 'Досрочные'],
    ['grace', CalendarDays, 'Льготные периоды'], ['schedule', ReceiptText, 'График платежей'], ['export', ArrowDownToLine, 'Импорт/экспорт'], ['changes', History, 'Что изменилось']
  ] as const
  const openEarly = (repayment: EarlyRepayment | null = null) => { setEditingEarly(repayment); setShowEarly(true) }
  const closeEarly = () => { setShowEarly(false); setEditingEarly(null) }
  const toggleNightTheme = () => store.setTheme(store.theme === 'night' ? lastLightTheme : 'night')

  const accentStyle = store.useCustomAccentColor ? ({ '--green': store.customAccentColor } as CSSProperties) : undefined

  return <div className="app-shell" data-theme={store.theme} data-ui-font={store.appFontSize} data-schedule-font={store.appFontSize} style={accentStyle}>
    <aside className={mobileNav ? 'sidebar open' : 'sidebar'}>
      <div className="brand"><div className="brand-mark"><Landmark size={22}/></div><div><b>Кредитный калькулятор</b><span>версия {APP_VERSION}</span></div><button className="icon-btn close-nav" aria-label="Закрыть меню" onClick={() => setMobileNav(false)}><X/></button></div>
      <nav>{nav.map(([id, Icon, label]) => <button key={id} className={section === id ? 'active' : ''} onClick={() => { setSection(id); setMobileNav(false) }}><Icon size={18}/><span>{label}</span>{id === 'early' && store.repayments.length > 0 && <em>{store.repayments.length}</em>}</button>)}</nav>
      <div className="sidebar-note"><ShieldCheck size={20}/><div><b>Расчёт локально</b><span>Ваши данные не покидают устройство</span></div></div>
    </aside>
    <main>
      <header><button className="icon-btn menu-btn" aria-label="Открыть меню" onClick={() => setMobileNav(true)}><Menu/></button><div className="header-title"><p>Финансовый план · v{APP_VERSION}</p><h1>{section === 'overview' ? 'Ваш кредит' : nav.find(x => x[0] === section)?.[2]}</h1></div><LoanSwitcher loans={store.loans} activeLoanId={store.activeLoanId} switchLoan={store.switchLoan} createLoan={store.createLoan} renameLoan={store.renameLoan} removeLoan={store.removeLoan}/><button className="icon-btn theme-toggle" onClick={toggleNightTheme} title={store.theme === 'night' ? 'Вернуть светлую тему' : 'Включить ночной режим'} aria-label={store.theme === 'night' ? 'Вернуть светлую тему' : 'Включить ночной режим'}>{store.theme === 'night' ? <Sun/> : <Moon/>}</button><FontControls fontSize={store.appFontSize} setFontSize={store.setAppFontSize}/><div className="header-actions"><span className="status-dot"><i/> Данные сохранены</span><button className="ghost print-action" onClick={() => window.print()}><Printer size={16}/> Печать</button><button className="primary add-payment-action" onClick={() => openEarly()}><Plus size={17}/> Досрочный платёж</button></div></header>
      <div className="content">
        {errors.length > 0 && <div className="alert">{errors.join(' · ')}</div>}
        {section === 'overview' && comparison && selected && <Overview config={store.config} repayments={allRepayments} comparison={comparison} selected={selected} chartData={overviewChartData} onSelect={store.selectScenario} onOpen={() => openEarly()}/>}
        {section === 'overview' && (!comparison || !selected) && <section className="panel list-panel"><div className="panel-head"><div><h3>Расчёт временно остановлен</h3><p>Исправьте параметры кредита или правила досрочных платежей, чтобы построить график.</p></div></div></section>}
        {section === 'settings' && <Settings config={store.config} update={store.updateConfig} updateInterest={store.updateInterest} termUnit={store.termUnit} setTermUnit={store.setTermUnit} displayDecimals={store.displayDecimals} setDisplayDecimals={store.setDisplayDecimals} appFontSize={store.appFontSize} setAppFontSize={store.setAppFontSize} theme={store.theme} setTheme={store.setTheme} customAccentColor={store.customAccentColor} useCustomAccentColor={store.useCustomAccentColor} setCustomAccentColor={store.setCustomAccentColor} setUseCustomAccentColor={store.setUseCustomAccentColor} resetCustomAccentColor={store.resetCustomAccentColor}/>}
        {section === 'early' && <EarlyList items={store.repayments} rules={store.repaymentRules} generated={generatedRepayments} remove={store.removeRepayment} edit={openEarly} open={() => openEarly()} addRule={store.addRepaymentRule} updateRule={store.updateRepaymentRule} removeRule={store.removeRepaymentRule} defaultStart={store.config.firstPaymentDate}/>}
        {section === 'grace' && <GraceList items={store.gracePeriods} remove={store.removeGrace} open={() => setShowGrace(true)}/>} 
        {section === 'schedule' && selected && base && <Schedule schedule={selected.schedule} baseSchedule={base.schedule} repayments={allRepayments} rows={rows} setRows={setRows} more={() => setRows(r => r + 24)}/>}
        {section === 'schedule' && (!selected || !base) && <section className="panel list-panel"><div className="panel-head"><div><h3>График недоступен</h3><p>Сначала исправьте ошибки в параметрах расчёта.</p></div></div></section>}
        {section === 'export' && <ExportPanel loans={store.loans} exportLoanId={exportLoanId} setExportLoanId={setExportLoanId} download={download} createFromJson={(data, fileName) => createLoanFromData(data, `файла «${fileName}»`)} replaceFromJson={(data, fileName) => replaceActiveWithData(data, `файла «${fileName}»`)} copyShareLink={copyShareLink} status={importStatus}/>}
        {section === 'changes' && <Changelog/>}
      </div>
    </main>
    {comparison && selected && <PrintReport config={store.config} repayments={allRepayments} comparison={comparison} selected={selected}/>}
    {showOnboarding && <OnboardingModal close={finishOnboarding} showExample={() => { finishOnboarding(); setSection('overview') }} startSettings={() => { finishOnboarding(); setSection('settings') }}/>}
    {showWhatsNew && <WhatsNewModal close={closeWhatsNew} openChanges={() => { closeWhatsNew(); setSection('changes') }}/>}
    {sharedCalculation && <SharedCalculationModal data={sharedCalculation} createNew={createLoanFromSharedCalculation} replaceCurrent={replaceActiveWithSharedCalculation} decline={declineSharedCalculation}/>}
    {showEarly && <EarlyModal close={closeEarly} save={editingEarly ? store.updateRepayment : store.addRepayment} initial={editingEarly} defaultDate={format(addMonths(parseISO(store.config.firstPaymentDate), 1), 'yyyy-MM-dd')}/>}
    {showGrace && <GraceModal close={() => setShowGrace(false)} add={store.addGrace}/>} 
  </div>
}

function GraceList({ items, remove, open }: { items: GracePeriod[]; remove: (id: string) => void; open: () => void }) { return <section className="panel list-panel"><div className="panel-head"><div><h3>Льготные периоды</h3><p>Отсрочка, проценты или индивидуальный платёж</p></div><button className="primary" onClick={open}><Plus/> Добавить</button></div>{items.length ? <div className="event-list">{items.map(x => <div className="event" key={x.id}><div className="date-tile"><CalendarDays/></div><div><b>{shortDate(x.startDate)} — {shortDate(x.endDate)}</b><span>{graceTypeName(x.type)} · {x.extendTerm ? 'с продлением срока' : 'без продления'}</span></div><button className="icon-btn danger" aria-label={`Удалить льготный период ${shortDate(x.startDate)} — ${shortDate(x.endDate)}`} onClick={() => remove(x.id)}><Trash2/></button></div>)}</div> : <Empty title="Льготные периоды не добавлены" action={open}/>}<div className="tip"><CircleHelp/> После льготного периода сначала могут погашаться отложенные платежи и проценты.</div></section> }

function Empty({ title, action }: { title: string; action: () => void }) { return <div className="empty"><span><CalendarDays/></span><h3>{title}</h3><p>Добавьте событие, и мы сразу покажем его влияние на кредит.</p><button className="ghost" onClick={action}><Plus/> Добавить</button></div> }

export default App
