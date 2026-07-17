import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { ArrowDownToLine, CalendarDays, History, Landmark, Menu, Moon, PanelLeftClose, PanelLeftOpen, Plus, Printer, ReceiptText, Settings2, ShieldCheck, Sun, Target, TrendingDown, X } from 'lucide-react'
import { ISO_DATE_LENGTH, JSON_INDENT_SPACES } from './constants'
import { isRegularPaymentDate, validateScenario, type EarlyRepayment } from './loanEngine'
import { useLoanStore } from './store'
import { GraceList } from './components/GraceList'
import { LoanSwitcher, type LoanSwitcherHandle } from './components/LoanSwitcher'
import { SharedCalculationModal } from './components/SharedCalculationModal'
import { PrintReport, StalePrintReport } from './components/PrintReport'
import { SectionErrorBoundary } from './components/SectionErrorBoundary'
import { accentPresentation } from './accentColor'
import { WhatsNewModal } from './components/WhatsNewModal'
import { OnboardingModal } from './components/OnboardingModal'
import { EarlyModal } from './components/EarlyModal'
import { GraceModal } from './components/GraceModal'
import { APP_VERSION } from './version'
import { useLoanCalculation } from './hooks/useLoanCalculation'
import { useLoanExport } from './hooks/useLoanExport'
import { useLoanImport } from './hooks/useLoanImport'
import { useSharedCalculation } from './hooks/useSharedCalculation'
import { useStorageStatus } from './hooks/useStorageStatus'
import { createQuarantineExport } from './quarantineExport'
import { saveBlob } from './download'
import { PwaNotices } from './components/PwaNotices'
import { usePwaStatus } from './pwa/usePwaStatus'
import { BrandMark } from './components/BrandMark'
import { isNativeApp, setSystemBarsForTheme } from './platform'

const Overview = lazy(() => import('./components/Overview').then(module => ({ default: module.Overview })))
const Settings = lazy(() => import('./components/Settings').then(module => ({ default: module.Settings })))
const EarlyList = lazy(() => import('./components/EarlyList').then(module => ({ default: module.EarlyList })))
const Schedule = lazy(() => import('./components/Schedule').then(module => ({ default: module.Schedule })))
const ExportPanel = lazy(() => import('./components/ExportPanel').then(module => ({ default: module.ExportPanel })))
const Changelog = lazy(() => import('./components/Changelog').then(module => ({ default: module.Changelog })))
const GoalPlanner = lazy(() => import('./components/GoalPlanner').then(module => ({ default: module.GoalPlanner })))

const STALE_EXPORT_MESSAGE = 'Дождитесь окончания пересчёта, чтобы экспортировать актуальный график'
const drawerFocusableSelector = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
const MOBILE_LAYOUT_MEDIA_QUERY = '(max-width: 950px)'

function App() {
  const store = useLoanStore()
  const [section, setSection] = useState('overview')
  const [showEarly, setShowEarly] = useState(false)
  const [editingEarly, setEditingEarly] = useState<EarlyRepayment | null>(null)
  const [earlyError, setEarlyError] = useState('')
  const [showGrace, setShowGrace] = useState(false)
  const [mobileNav, setMobileNav] = useState(false)
  const [mobileViewport, setMobileViewport] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [printReportVisible, setPrintReportVisible] = useState(false)
  const [rows, setRows] = useState(0)
  const pwaStatus = usePwaStatus()
  const shellRef = useRef<HTMLDivElement>(null)
  const sidebarRef = useRef<HTMLElement>(null)
  const loanSwitcherRef = useRef<LoanSwitcherHandle>(null)
  const resetRows = useCallback(() => setRows(0), [])
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
  const calculatedResultsUnavailable = isStale || errors.length > 0 || !comparison || !selected
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
    downloadRecovery,
    print,
    copyShareLink,
    createParameterCode,
    decodeParameterCode,
    looksLikeParameterLink
  } = useLoanExport({
    loans: store.loans,
    activeLoanId: store.activeLoanId,
    calculatedSchedule: selected?.schedule ?? null,
    calculatedExportsReady: !calculatedResultsUnavailable,
    calculationErrors: errors,
    readyCalculationSnapshot: calculatedResultsUnavailable ? null : calculationSnapshot,
    setImportStatus
  })
  const {
    showWhatsNew,
    showOnboarding,
    lastLightTheme,
    storageWarning,
    storageStatus,
    storageConflict,
    clearStorageConflict,
    closeWhatsNew,
    finishOnboarding
  } = useStorageStatus(store.theme)
  const acceptSharedCalculation = useCallback(() => {
    if (showOnboarding) finishOnboarding()
  }, [finishOnboarding, showOnboarding])
  const {
    sharedCalculation,
    createLoanFromSharedCalculation,
    replaceActiveWithSharedCalculation,
    declineSharedCalculation
  } = useSharedCalculation({
    createLoanFromData,
    replaceActiveWithData,
    setImportStatus,
    onAccept: acceptSharedCalculation
  })

  useEffect(() => {
    const media = window.matchMedia(MOBILE_LAYOUT_MEDIA_QUERY)
    const updateViewport = () => setMobileViewport(media.matches)
    updateViewport()
    media.addEventListener?.('change', updateViewport)
    return () => media.removeEventListener?.('change', updateViewport)
  }, [])

  useEffect(() => {
    if (!mobileViewport || !mobileNav) return
    const drawer = sidebarRef.current
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    const focusable = () => Array.from(drawer?.querySelectorAll<HTMLElement>(drawerFocusableSelector) ?? [])
      .filter(element => !element.classList.contains('sidebar-collapse'))
    document.body.style.overflow = 'hidden'
    const timer = window.setTimeout(() => (drawer?.querySelector<HTMLElement>('.close-nav') ?? focusable()[0] ?? drawer)?.focus(), 0)
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setMobileNav(false)
        return
      }
      if (event.key !== 'Tab') return
      const elements = focusable()
      if (!elements.length) {
        event.preventDefault()
        drawer?.focus()
        return
      }
      const first = elements[0]
      const last = elements.at(-1)!
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = previousOverflow
      previousFocus?.focus()
    }
  }, [mobileNav, mobileViewport])

  useEffect(() => {
    setShowEarly(false)
    setEditingEarly(null)
    setEarlyError('')
    setShowGrace(false)
    setPrintReportVisible(false)
    resetRows()
  }, [store.activeLoanId, resetRows])

  useEffect(() => {
    const shell = shellRef.current
    if (!shell) return
    if (store.useCustomAccentColor) {
      const presentation = accentPresentation(store.customAccentColor, store.theme === 'night')
      shell.style.setProperty('--green', presentation.accent)
      shell.style.setProperty('--theme-accent', presentation.accent)
      shell.style.setProperty('--theme-accent-text', presentation.text)
      shell.style.setProperty('--theme-accent-contrast', presentation.contrast)
      return
    }
    shell.style.removeProperty('--green')
    shell.style.removeProperty('--theme-accent')
    shell.style.removeProperty('--theme-accent-text')
    shell.style.removeProperty('--theme-accent-contrast')
  }, [store.customAccentColor, store.theme, store.useCustomAccentColor])

  useLayoutEffect(() => {
    const darkTheme = store.theme === 'night'
    const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    document.documentElement.dataset.appTheme = store.theme
    themeColor?.setAttribute('content', darkTheme ? '#08111f' : '#071a17')
    void setSystemBarsForTheme(darkTheme)
    return () => {
      delete document.documentElement.dataset.appTheme
      themeColor?.setAttribute('content', '#071a17')
    }
  }, [store.theme])

  const nav = [
    ['overview', Landmark, 'Обзор'], ['settings', Settings2, 'Параметры'], ['early', TrendingDown, 'Досрочные'],
    ['planner', Target, 'Планировщик цели'], ['grace', CalendarDays, 'Льготные периоды'], ['schedule', ReceiptText, 'График платежей'], ['export', ArrowDownToLine, 'Импорт/экспорт'], ['changes', History, 'Что изменилось']
  ] as const
  const openEarly = (repayment: EarlyRepayment | null = null, error = '') => { setEditingEarly(repayment); setEarlyError(error); setShowEarly(true) }
  const closeEarly = () => { setShowEarly(false); setEditingEarly(null); setEarlyError('') }

  useEffect(() => {
    if (!isNativeApp()) return
    let cancelled = false
    let removeListener: (() => Promise<void>) | undefined
    void import('@capacitor/app')
      .then(({ App: NativeApp }) => NativeApp.addListener('backButton', () => {
        if (sharedCalculation) declineSharedCalculation()
        else if (showOnboarding) finishOnboarding()
        else if (showWhatsNew) closeWhatsNew()
        else if (loanSwitcherRef.current?.closeDialog()) return
        else if (mobileNav) setMobileNav(false)
        else if (showEarly) {
          setShowEarly(false)
          setEditingEarly(null)
          setEarlyError('')
        }
        else if (showGrace) setShowGrace(false)
        else if (section !== 'overview') setSection('overview')
        else void NativeApp.minimizeApp()
      }))
      .then(handle => {
        if (cancelled) void handle.remove()
        else removeListener = () => handle.remove()
      })
      .catch(() => {
        // Android keeps its default back behavior if the App plugin is unavailable.
      })
    return () => {
      cancelled = true
      if (removeListener) void removeListener()
    }
  }, [closeWhatsNew, declineSharedCalculation, finishOnboarding, mobileNav, section, sharedCalculation, showEarly, showGrace, showOnboarding, showWhatsNew])

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
      if (repayment.amountMode === 'totalWithFee' && !isRegularPaymentDate(repayment.date, store.config)) {
        const message = 'Общую сумму можно включить только в дату регулярного платежа'
        setImportStatus({ kind: 'error', text: message })
        openEarly(repayment, message)
        return
      }
    }
    if (nextEnabled) {
      try {
        const candidateManual = store.repayments.map(item => item.id === repayment.id ? { ...repayment, enabled: true } : item)
        const validationErrors = validateScenario(store.config, candidateManual, store.gracePeriods)
        if (validationErrors.length) throw new Error(validationErrors.join(' · '))
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
  const showPrintReport = useCallback(() => {
    flushSync(() => setPrintReportVisible(true))
  }, [])
  const hidePrintReport = useCallback(() => setPrintReportVisible(false), [])
  useEffect(() => {
    const beforePrint = () => {
      if (isStale || (comparison && selected)) showPrintReport()
    }
    window.addEventListener('beforeprint', beforePrint)
    window.addEventListener('afterprint', hidePrintReport)
    return () => {
      window.removeEventListener('beforeprint', beforePrint)
      window.removeEventListener('afterprint', hidePrintReport)
    }
  }, [comparison, hidePrintReport, isStale, selected, showPrintReport])
  const guardCalculatedExport = useCallback((action: () => void) => {
    if (calculatedResultsUnavailable) {
      setImportStatus({ kind: 'error', text: isStale ? STALE_EXPORT_MESSAGE : errors.join(' · ') || 'Нет корректного готового расчёта для экспорта' })
      return
    }
    action()
  }, [calculatedResultsUnavailable, errors, isStale, setImportStatus])
  const printCalculated = useCallback(() => guardCalculatedExport(() => {
    showPrintReport()
    print()
  }), [guardCalculatedExport, print, showPrintReport])
  const downloadExport = useCallback((kind: 'csv' | 'json' | 'xls') => {
    if (kind === 'json') {
      download(kind)
      return
    }
    guardCalculatedExport(() => download(kind))
  }, [download, guardCalculatedExport])
  const downloadQuarantinedLoans = useCallback(() => {
    try {
      const body = JSON.stringify(createQuarantineExport(store.quarantinedLoansRaw), null, JSON_INDENT_SPACES)
      void saveBlob(new Blob([body], { type: 'application/json' }), `credit-quarantine-${new Date().toISOString().slice(0, ISO_DATE_LENGTH)}.json`)
        .then(() => setImportStatus({ kind: 'success', text: 'Ограниченная копия данных карантина для восстановления подготовлена' }))
        .catch(error => setImportStatus({ kind: 'error', text: error instanceof Error ? error.message : 'Не удалось сохранить повреждённые данные' }))
    } catch (error) {
      setImportStatus({ kind: 'error', text: error instanceof Error ? error.message : 'Не удалось скачать повреждённые данные' })
    }
  }, [setImportStatus, store.quarantinedLoansRaw])
  const deleteQuarantinedLoans = useCallback(() => {
    if (!window.confirm('Удалить исходные данные карантина без возможности восстановления? Сначала скачайте резервную копию, если она может понадобиться.')) return
    store.deleteQuarantinedLoans()
    setImportStatus({ kind: 'success', text: 'Исходные данные карантина удалены' })
  }, [setImportStatus, store])

  return <div ref={shellRef} className={sidebarCollapsed ? 'app-shell sidebar-collapsed' : 'app-shell'} data-theme={store.theme}>
    <aside ref={sidebarRef} id="primary-sidebar" className={mobileNav ? 'sidebar open' : 'sidebar'} inert={mobileViewport && !mobileNav ? true : undefined} aria-hidden={mobileViewport && !mobileNav ? true : undefined} role={mobileViewport && mobileNav ? 'dialog' : undefined} aria-modal={mobileViewport && mobileNav ? true : undefined} aria-label={mobileViewport && mobileNav ? 'Основное меню' : undefined} tabIndex={mobileViewport && mobileNav ? -1 : undefined}>
      <div className="brand"><div className="brand-mark"><BrandMark/></div><div className="brand-copy"><b>CreditCalc</b><span>кредитный график</span></div><button className="icon-btn sidebar-collapse" aria-label={sidebarCollapsed ? 'Развернуть меню' : 'Свернуть меню'} aria-controls="primary-sidebar" aria-expanded={!sidebarCollapsed} onClick={() => setSidebarCollapsed(value => !value)}>{sidebarCollapsed ? <PanelLeftOpen/> : <PanelLeftClose/>}</button><button className="icon-btn close-nav" aria-label="Закрыть меню" onClick={() => setMobileNav(false)}><X/></button></div>
      <nav aria-label="Основная навигация">{nav.map(([id, Icon, label]) => <button key={id} className={section === id ? 'active' : ''} aria-label={label} aria-current={section === id ? 'page' : undefined} title={sidebarCollapsed ? label : undefined} onClick={() => { setSection(id); setMobileNav(false) }}><Icon size={18}/><span>{label}</span>{id === 'early' && store.repayments.length > 0 && <em>{store.repayments.length}</em>}</button>)}</nav>
      <div className="sidebar-note"><ShieldCheck size={20}/><div><b>Расчёт локально</b><span>Ваши данные не покидают устройство</span></div></div>
    </aside>
    <main inert={mobileViewport && mobileNav ? true : undefined} aria-hidden={mobileViewport && mobileNav ? true : undefined}>
      <header><button className="icon-btn menu-btn" aria-label="Открыть меню" onClick={() => setMobileNav(true)}><Menu/></button><div className="header-title"><p>Финансовый план · v{APP_VERSION}</p><h1>{section === 'overview' ? 'Ваш кредит' : nav.find(x => x[0] === section)?.[2]}</h1></div><LoanSwitcher ref={loanSwitcherRef} loans={store.loans} activeLoanId={store.activeLoanId} switchLoan={store.switchLoan} createLoan={store.createLoan} renameLoan={store.renameLoan} removeLoan={store.removeLoan}/><button className="icon-btn theme-toggle" onClick={toggleNightTheme} title={store.theme === 'night' ? 'Вернуть светлую тему' : 'Включить ночной режим'} aria-label={store.theme === 'night' ? 'Вернуть светлую тему' : 'Включить ночной режим'}>{store.theme === 'night' ? <Sun/> : <Moon/>}</button><div className="header-actions"><span className={storageStatus.kind === 'saved' ? 'status-dot' : 'status-dot warning'}><i/> {storageStatus.kind === 'failed' ? 'Сохранение не удалось' : storageStatus.kind === 'nearQuota' ? 'Мало места' : storageStatus.kind === 'conflict' ? 'Конфликт сохранения' : storageStatus.kind === 'memoryOnly' ? 'Только в памяти' : 'Данные сохранены'}</span><button className="ghost print-action" onClick={printCalculated} disabled={calculatedResultsUnavailable} title={calculatedResultsUnavailable ? (isStale ? STALE_EXPORT_MESSAGE : 'Исправьте ошибки расчёта перед печатью') : undefined}><Printer size={16}/> Печать</button><button className="primary add-payment-action" onClick={() => openEarly()}><Plus size={17}/> Досрочный платёж</button></div></header>
      <div className="content">
        <PwaNotices status={pwaStatus} storageAtRisk={storageStatus.kind !== 'saved'} downloadBackup={() => download('json')}/>
        {importStatus?.kind === 'error' && section !== 'export' && <div className="alert alert-with-actions" role="alert"><span>{importStatus.text}</span><button className="ghost compact" onClick={() => setSection('export')}>Открыть импорт/экспорт</button></div>}
        {storageWarning && <div className="alert alert-with-actions"><span>{storageWarning}</span><button className="ghost compact" onClick={() => download('json')}>Скачать JSON</button>{storageStatus.kind === 'failed' && <button className="ghost compact" onClick={store.retryStorageSave}>Повторить</button>}</div>}
        {storageConflict && <div className="alert alert-with-actions" role="alert"><span>{storageConflict.kind === 'deleted' ? 'В другой вкладке сохранённые данные были удалены или сброшены' : storageConflict.kind === 'race' ? 'Обнаружена одновременная запись данных из другой вкладки' : 'В другой вкладке сохранена более новая версия данных'}{storageConflict.updatedAt ? ` (${new Date(storageConflict.updatedAt).toLocaleString('ru-RU')})` : ''}. Автоматическое объединение финансовых данных отключено.</span><button className="ghost compact" onClick={() => window.location.reload()}>Загрузить внешнее состояние</button><button className="ghost compact danger" onClick={() => { store.overwriteExternalStorageChanges(); clearStorageConflict() }}>Перезаписать из этой вкладки</button></div>}
        {!store.storageRecoveryDismissed && (store.storageRecoveryReport.length > 0 || store.quarantinedLoansRaw.length > 0) && <div className="alert alert-with-actions"><span>{store.storageRecoveryReport.length > 0 ? store.storageRecoveryReport.join(' · ') : `В карантине ${store.quarantinedLoansRaw.length} повреждённых записей локального хранилища браузера.`} Скачиваемая копия для восстановления ограничена и может содержать маркеры усечения.</span>{store.quarantinedLoansRaw.length > 0 && <><button className="ghost compact" onClick={downloadQuarantinedLoans}>Скачать ограниченную копию для восстановления</button><button className="ghost compact danger" onClick={deleteQuarantinedLoans}>Удалить данные</button></>}<button className="ghost compact" onClick={store.dismissStorageRecoveryReport}>Скрыть уведомление</button></div>}
        {store.storageRecoveryDismissed && store.quarantinedLoansRaw.length > 0 && <button className="ghost compact" onClick={store.showStorageRecoveryReport}>Показать карантин ({store.quarantinedLoansRaw.length})</button>}
        {isStale && <div className="alert" role="status" aria-live="polite" aria-atomic="true">Пересчитываем график. На экране пока показан предыдущий согласованный расчёт.</div>}
        {errors.length > 0 && <div className="alert" role="alert" aria-live="assertive" aria-atomic="true">{errors.join(' · ')}</div>}
        <SectionErrorBoundary resetKey={`${section}:${store.activeLoanId}`}>
          <Suspense fallback={<SectionLoading/>}>
            {section === 'overview' && comparison && selected && <Overview config={calculationSnapshot.config} displayDecimals={calculationSnapshot.displayDecimals} repayments={allRepayments} gracePeriods={calculationSnapshot.gracePeriods} comparison={comparison} selected={selected} chartData={overviewChartData} onSelect={store.selectScenario} onOpen={() => openEarly()}/>}
            {section === 'overview' && (!comparison || !selected) && <section className="panel list-panel" role="status" aria-live="polite"><div className="panel-head"><div><h3>Расчёт временно остановлен</h3><p>Исправьте параметры кредита или правила досрочных платежей, чтобы построить график.</p></div></div></section>}
            {section === 'settings' && <Settings key={`settings-${store.activeLoanId}`} config={store.config} update={store.updateConfig} updateInterest={store.updateInterest} termUnit={store.termUnit} setTermUnit={store.setTermUnit} displayDecimals={store.displayDecimals} setDisplayDecimals={store.setDisplayDecimals} theme={store.theme} setTheme={store.setTheme} customAccentColor={store.customAccentColor} useCustomAccentColor={store.useCustomAccentColor} setCustomAccentColor={store.setCustomAccentColor} setUseCustomAccentColor={store.setUseCustomAccentColor} resetCustomAccentColor={store.resetCustomAccentColor} persistentStorageEnabled={store.persistentStorageEnabled} setPersistentStorageEnabled={store.setPersistentStorageEnabled} browserPersistence={pwaStatus.browserPersistence} requestBrowserPersistence={pwaStatus.requestBrowserPersistence} installAvailable={pwaStatus.installAvailable} iosInstallHint={pwaStatus.iosInstallHint} install={pwaStatus.install}/>}
            {section === 'early' && <EarlyList key={`early-${store.activeLoanId}`} items={store.repayments} rules={store.repaymentRules} generated={generatedRepayments} currency={store.config.currency} displayDecimals={store.displayDecimals} remove={store.removeRepayment} edit={openEarly} toggle={toggleEarlyRepayment} open={() => openEarly()} addRule={store.addRepaymentRule} updateRule={store.updateRepaymentRule} removeRule={store.removeRepaymentRule} defaultStart={store.config.firstPaymentDate}/>}
            {section === 'planner' && <GoalPlanner key={`planner-${store.activeLoanId}`} loanId={store.activeLoanId} sourceRevision={calculationSnapshot.revision} config={store.config} repayments={store.repayments} repaymentRules={store.repaymentRules} gracePeriods={store.gracePeriods} selectedScenario={store.selectedScenario} displayDecimals={store.displayDecimals} disabled={calculatedResultsUnavailable} applyGoalPlan={store.applyGoalPlan}/>}
            {section === 'grace' && <GraceList items={store.gracePeriods} remove={store.removeGrace} open={() => setShowGrace(true)}/>}
            {section === 'schedule' && selected && base && <Schedule schedule={selected.schedule} baseSchedule={base.schedule} repayments={allRepayments} config={calculationSnapshot.config} gracePeriods={calculationSnapshot.gracePeriods} currency={calculationSnapshot.config.currency} displayDecimals={calculationSnapshot.displayDecimals} rows={rows} setRows={setRows}/>}
            {section === 'schedule' && (!selected || !base) && <section className="panel list-panel"><div className="panel-head"><div><h3>График недоступен</h3><p>Сначала исправьте ошибки в параметрах расчёта.</p></div></div></section>}
            {section === 'export' && <ExportPanel download={downloadExport} downloadRecovery={downloadRecovery} print={printCalculated} calculatedExportsDisabled={calculatedResultsUnavailable} createImported={createLoanFromData} replaceImported={replaceActiveWithData} copyShareLink={copyShareLink} createParameterCode={createParameterCode} decodeParameterCode={decodeParameterCode} looksLikeParameterLink={looksLikeParameterLink} status={importStatus}/>}
            {section === 'changes' && <Changelog/>}
          </Suspense>
        </SectionErrorBoundary>
      </div>
    </main>
    {printReportVisible && (isStale ? <StalePrintReport/> : comparison && selected && <PrintReport config={calculationSnapshot.config} displayDecimals={calculationSnapshot.displayDecimals} repayments={calculationSnapshot.repayments} repaymentRules={calculationSnapshot.repaymentRules} gracePeriods={calculationSnapshot.gracePeriods} comparison={comparison} selected={selected}/>)}
    {sharedCalculation ? <SharedCalculationModal data={sharedCalculation} createNew={createLoanFromSharedCalculation} replaceCurrent={replaceActiveWithSharedCalculation} decline={declineSharedCalculation}/> :
      showOnboarding ? <OnboardingModal close={finishOnboarding} disablePersistence={() => { store.setPersistentStorageEnabled(false); finishOnboarding() }} showExample={() => { store.loadExampleLoan(); finishOnboarding(); setSection('overview') }} startSettings={() => { finishOnboarding(); setSection('settings') }}/> :
        showWhatsNew ? <WhatsNewModal close={closeWhatsNew} openChanges={() => { closeWhatsNew(); setSection('changes') }}/> :
          showEarly ? <EarlyModal key={`early-modal-${store.activeLoanId}-${editingEarly?.id ?? 'new'}`} close={closeEarly} save={editingEarly ? store.updateRepayment : store.addRepayment} initial={editingEarly} initialError={earlyError} defaultDate={defaultEarlyDate} currency={store.config.currency} isRegularPaymentDate={(date) => isRegularPaymentDate(date, store.config)}/> :
            showGrace ? <GraceModal key={`grace-${store.activeLoanId}`} close={() => setShowGrace(false)} add={store.addGrace} config={store.config} currency={store.config.currency}/> : null}
  </div>
}

function SectionLoading() { return <section className="panel list-panel"><div className="panel-head"><div><h3>Загружаем раздел</h3><p>Подготавливаем интерфейс и расчётные данные.</p></div></div></section> }

export default App
