import { lazy, Suspense, useCallback, useState, type CSSProperties } from 'react'
import { ArrowDownToLine, CalendarDays, CircleHelp, History, Landmark, Menu, Moon, Plus, Printer, ReceiptText, Settings2, ShieldCheck, Sun, Trash2, TrendingDown, X } from 'lucide-react'
import { compareScenarios, isRegularPaymentDate, validateScenario, type EarlyRepayment, type GracePeriod } from './loanEngine'
import { useLoanStore } from './store'
import { FontControls } from './components/FontControls'
import { LoanSwitcher } from './components/LoanSwitcher'
import { SharedCalculationModal } from './components/SharedCalculationModal'
import { PrintReport } from './components/PrintReport'
import { Changelog, WhatsNewModal } from './components/Changelog'
import { OnboardingModal } from './components/OnboardingModal'
import { EarlyModal } from './components/EarlyModal'
import { GraceModal } from './components/GraceModal'
import { configureFormatters, shortDate } from './formatters'
import { APP_VERSION } from './version'
import { graceTypeName } from './labels'
import { useLoanCalculation } from './hooks/useLoanCalculation'
import { useLoanExport } from './hooks/useLoanExport'
import { useLoanImport } from './hooks/useLoanImport'
import { useSharedCalculation } from './hooks/useSharedCalculation'
import { useStorageStatus } from './hooks/useStorageStatus'
import { expandRepaymentRules } from './repaymentRules'

const Overview = lazy(() => import('./components/Overview').then(module => ({ default: module.Overview })))
const Settings = lazy(() => import('./components/Settings').then(module => ({ default: module.Settings })))
const EarlyList = lazy(() => import('./components/EarlyList').then(module => ({ default: module.EarlyList })))
const Schedule = lazy(() => import('./components/Schedule').then(module => ({ default: module.Schedule })))
const ExportPanel = lazy(() => import('./components/ExportPanel').then(module => ({ default: module.ExportPanel })))

function App() {
  const store = useLoanStore()
  const [section, setSection] = useState('overview')
  const [showEarly, setShowEarly] = useState(false)
  const [editingEarly, setEditingEarly] = useState<EarlyRepayment | null>(null)
  const [earlyError, setEarlyError] = useState('')
  const [showGrace, setShowGrace] = useState(false)
  const [mobileNav, setMobileNav] = useState(false)
  const [rows, setRows] = useState(18)
  const resetRows = useCallback(() => setRows(18), [])
  const {
    generatedRepayments,
    allRepayments,
    errors,
    comparison,
    selected,
    base,
    overviewChartData,
    defaultEarlyDate,
    calculationSnapshot,
    isStale
  } = useLoanCalculation({
    config: store.config,
    repayments: store.repayments,
    repaymentRules: store.repaymentRules,
    gracePeriods: store.gracePeriods,
    selectedScenario: store.selectedScenario,
    displayDecimals: store.displayDecimals,
    loanId: store.activeLoanId
  })
  configureFormatters(calculationSnapshot.displayDecimals, calculationSnapshot.config.currency)
  const {
    importStatus,
    setImportStatus,
    createLoanFromData,
    replaceActiveWithData
  } = useLoanImport({
    addLoanFromData: store.addLoanFromData,
    replaceData: store.replaceData,
    resetRows
  })
  const {
    download,
    print,
    copyShareLink,
    createParameterCode,
    decodeParameterCode,
    looksLikeParameterLink
  } = useLoanExport({
    loans: store.loans,
    activeLoanId: store.activeLoanId,
    setImportStatus
  })
  const {
    sharedCalculation,
    createLoanFromSharedCalculation,
    replaceActiveWithSharedCalculation,
    declineSharedCalculation
  } = useSharedCalculation({
    createLoanFromData,
    replaceActiveWithData,
    setImportStatus
  })
  const {
    showWhatsNew,
    showOnboarding,
    lastLightTheme,
    storageWarning,
    storageStatus,
    closeWhatsNew,
    finishOnboarding
  } = useStorageStatus(store.theme)

  const nav = [
    ['overview', Landmark, 'Обзор'], ['settings', Settings2, 'Параметры'], ['early', TrendingDown, 'Досрочные'],
    ['grace', CalendarDays, 'Льготные периоды'], ['schedule', ReceiptText, 'График платежей'], ['export', ArrowDownToLine, 'Импорт/экспорт'], ['changes', History, 'Что изменилось']
  ] as const
  const openEarly = (repayment: EarlyRepayment | null = null, error = '') => { setEditingEarly(repayment); setEarlyError(error); setShowEarly(true) }
  const closeEarly = () => { setShowEarly(false); setEditingEarly(null); setEarlyError('') }
  const toggleEarlyRepayment = (repayment: EarlyRepayment) => {
    const currentlyEnabled = repayment.enabled !== false && repayment.amount > 0
    const nextEnabled = !currentlyEnabled
    if (nextEnabled) {
      if (repayment.amount <= 0) {
        const message = 'Укажите сумму досрочного платежа перед включением'
        setImportStatus({ kind: 'error', text: message })
        openEarly(repayment, message)
        return
      }
      if (repayment.amountMode === 'total' && !isRegularPaymentDate(repayment.date, store.config)) {
        const message = 'Общую сумму можно включить только в дату регулярного платежа'
        setImportStatus({ kind: 'error', text: message })
        openEarly(repayment, message)
        return
      }
    }
    if (nextEnabled) {
      try {
        const candidateManual = store.repayments.map(item => item.id === repayment.id ? { ...repayment, enabled: true } : item)
        const generated = expandRepaymentRules(store.config, store.repaymentRules, store.gracePeriods)
        const candidateRepayments = [...candidateManual.filter(item => item.enabled !== false && item.amount > 0), ...generated]
        const validationErrors = validateScenario(store.config, candidateRepayments, store.gracePeriods)
        if (validationErrors.length) throw new Error(validationErrors.join(' · '))
        compareScenarios(store.config, candidateRepayments, store.gracePeriods)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Платёж нельзя включить без исправления параметров'
        setImportStatus({ kind: 'error', text: message })
        openEarly(repayment, message)
        return
      }
    }
    store.updateRepayment({ ...repayment, enabled: nextEnabled })
  }
  const toggleNightTheme = () => store.setTheme(store.theme === 'night' ? lastLightTheme : 'night')

  const accentStyle = store.useCustomAccentColor ? ({ '--green': store.customAccentColor } as CSSProperties) : undefined

  return <div className="app-shell" data-theme={store.theme} data-ui-font={store.appFontSize} data-schedule-font={store.scheduleFontSize} style={accentStyle}>
    <aside className={mobileNav ? 'sidebar open' : 'sidebar'}>
      <div className="brand"><div className="brand-mark"><Landmark size={22}/></div><div><b>Кредитный калькулятор</b><span>версия {APP_VERSION}</span></div><button className="icon-btn close-nav" aria-label="Закрыть меню" onClick={() => setMobileNav(false)}><X/></button></div>
      <nav>{nav.map(([id, Icon, label]) => <button key={id} className={section === id ? 'active' : ''} onClick={() => { setSection(id); setMobileNav(false) }}><Icon size={18}/><span>{label}</span>{id === 'early' && store.repayments.length > 0 && <em>{store.repayments.length}</em>}</button>)}</nav>
      <div className="sidebar-note"><ShieldCheck size={20}/><div><b>Расчёт локально</b><span>Ваши данные не покидают устройство</span></div></div>
    </aside>
    <main>
      <header><button className="icon-btn menu-btn" aria-label="Открыть меню" onClick={() => setMobileNav(true)}><Menu/></button><div className="header-title"><p>Финансовый план · v{APP_VERSION}</p><h1>{section === 'overview' ? 'Ваш кредит' : nav.find(x => x[0] === section)?.[2]}</h1></div><LoanSwitcher loans={store.loans} activeLoanId={store.activeLoanId} switchLoan={store.switchLoan} createLoan={store.createLoan} renameLoan={store.renameLoan} removeLoan={store.removeLoan}/><button className="icon-btn theme-toggle" onClick={toggleNightTheme} title={store.theme === 'night' ? 'Вернуть светлую тему' : 'Включить ночной режим'} aria-label={store.theme === 'night' ? 'Вернуть светлую тему' : 'Включить ночной режим'}>{store.theme === 'night' ? <Sun/> : <Moon/>}</button><FontControls fontSize={store.appFontSize} setFontSize={store.setAppFontSize}/><div className="header-actions"><span className={storageStatus.kind === 'saved' ? 'status-dot' : 'status-dot warning'}><i/> {storageStatus.kind === 'failed' ? 'Сохранение не удалось' : storageStatus.kind === 'nearQuota' ? 'Мало места' : 'Данные сохранены'}</span><button className="ghost print-action" onClick={print}><Printer size={16}/> Печать</button><button className="primary add-payment-action" onClick={() => openEarly()}><Plus size={17}/> Досрочный платёж</button></div></header>
      <div className="content">
        {storageWarning && <div className="alert">{storageWarning}</div>}
        {isStale && <div className="alert">Пересчитываем график. На экране пока показан предыдущий согласованный расчёт.</div>}
        {errors.length > 0 && <div className="alert">{errors.join(' · ')}</div>}
        <Suspense fallback={<SectionLoading/>}>
          {section === 'overview' && comparison && selected && <Overview config={calculationSnapshot.config} repayments={allRepayments} gracePeriods={calculationSnapshot.gracePeriods} comparison={comparison} selected={selected} chartData={overviewChartData} onSelect={store.selectScenario} onOpen={() => openEarly()}/>}
          {section === 'overview' && (!comparison || !selected) && <section className="panel list-panel"><div className="panel-head"><div><h3>Расчёт временно остановлен</h3><p>Исправьте параметры кредита или правила досрочных платежей, чтобы построить график.</p></div></div></section>}
          {section === 'settings' && <Settings config={store.config} update={store.updateConfig} updateInterest={store.updateInterest} termUnit={store.termUnit} setTermUnit={store.setTermUnit} displayDecimals={store.displayDecimals} setDisplayDecimals={store.setDisplayDecimals} appFontSize={store.appFontSize} setAppFontSize={store.setAppFontSize} theme={store.theme} setTheme={store.setTheme} customAccentColor={store.customAccentColor} useCustomAccentColor={store.useCustomAccentColor} setCustomAccentColor={store.setCustomAccentColor} setUseCustomAccentColor={store.setUseCustomAccentColor} resetCustomAccentColor={store.resetCustomAccentColor}/>}
          {section === 'early' && <EarlyList items={store.repayments} rules={store.repaymentRules} generated={generatedRepayments} remove={store.removeRepayment} edit={openEarly} toggle={toggleEarlyRepayment} open={() => openEarly()} addRule={store.addRepaymentRule} updateRule={store.updateRepaymentRule} removeRule={store.removeRepaymentRule} defaultStart={store.config.firstPaymentDate}/>}
          {section === 'grace' && <GraceList items={store.gracePeriods} remove={store.removeGrace} open={() => setShowGrace(true)}/>}
          {section === 'schedule' && selected && base && <Schedule schedule={selected.schedule} baseSchedule={base.schedule} repayments={allRepayments} rows={rows} setRows={setRows} more={() => setRows(r => r + 24)}/>}
          {section === 'schedule' && (!selected || !base) && <section className="panel list-panel"><div className="panel-head"><div><h3>График недоступен</h3><p>Сначала исправьте ошибки в параметрах расчёта.</p></div></div></section>}
          {section === 'export' && <ExportPanel download={download} print={print} createImported={createLoanFromData} replaceImported={replaceActiveWithData} copyShareLink={copyShareLink} createParameterCode={createParameterCode} decodeParameterCode={decodeParameterCode} looksLikeParameterLink={looksLikeParameterLink} status={importStatus}/>}
          {section === 'changes' && <Changelog/>}
        </Suspense>
      </div>
    </main>
    {comparison && selected && <PrintReport config={calculationSnapshot.config} repayments={allRepayments} comparison={comparison} selected={selected}/>}
    {showOnboarding ? <OnboardingModal close={finishOnboarding} showExample={() => { store.loadExampleLoan(); finishOnboarding(); setSection('overview') }} startSettings={() => { finishOnboarding(); setSection('settings') }}/> :
      showWhatsNew ? <WhatsNewModal close={closeWhatsNew} openChanges={() => { closeWhatsNew(); setSection('changes') }}/> :
        sharedCalculation ? <SharedCalculationModal data={sharedCalculation} createNew={createLoanFromSharedCalculation} replaceCurrent={replaceActiveWithSharedCalculation} decline={declineSharedCalculation}/> :
          showEarly ? <EarlyModal close={closeEarly} save={editingEarly ? store.updateRepayment : store.addRepayment} initial={editingEarly} initialError={earlyError} defaultDate={defaultEarlyDate} isRegularPaymentDate={(date) => isRegularPaymentDate(date, store.config)}/> :
            showGrace ? <GraceModal close={() => setShowGrace(false)} add={store.addGrace}/> : null}
  </div>
}

function GraceList({ items, remove, open }: { items: GracePeriod[]; remove: (id: string) => void; open: () => void }) { return <section className="panel list-panel"><div className="panel-head"><div><h3>Льготные периоды</h3><p>Отсрочка, проценты или индивидуальный платёж</p></div><button className="primary" onClick={open}><Plus/> Добавить</button></div>{items.length ? <div className="event-list">{items.map(x => <div className="event" key={x.id}><div className="date-tile"><CalendarDays/></div><div><b>{shortDate(x.startDate)} — {shortDate(x.endDate)}</b><span>{graceTypeName(x.type)} · {x.extendTerm ? 'с продлением срока' : 'без продления'}</span></div><button className="icon-btn danger" aria-label={`Удалить льготный период ${shortDate(x.startDate)} — ${shortDate(x.endDate)}`} onClick={() => remove(x.id)}><Trash2/></button></div>)}</div> : <Empty title="Льготные периоды не добавлены" action={open}/>}<div className="tip"><CircleHelp/> После льготного периода сначала могут погашаться отложенные платежи и проценты.</div></section> }

function Empty({ title, action }: { title: string; action: () => void }) { return <div className="empty"><span><CalendarDays/></span><h3>{title}</h3><p>Добавьте событие, и мы сразу покажем его влияние на кредит.</p><button className="ghost" onClick={action}><Plus/> Добавить</button></div> }

function SectionLoading() { return <section className="panel list-panel"><div className="panel-head"><div><h3>Загружаем раздел</h3><p>Подготавливаем интерфейс и расчётные данные.</p></div></div></section> }

export default App
