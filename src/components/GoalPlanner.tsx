import { useEffect, useMemo, useRef, useState } from 'react'
import { format } from 'date-fns'
import { CalendarCheck, Check, ChevronDown, ChevronUp, Eye, Scale, Target, X } from 'lucide-react'
import { scheduledPaymentDates, type EarlyRepayment, type GracePeriod, type LoanConfig } from '../loanEngine'
import type { RepaymentRule } from '../repaymentRules'
import { createMoneyFormatter, shortDate } from '../formatters'
import type { ApplyGoalPlanRequest } from '../store'
import {
  GoalPlannerRunner,
  type GoalPlannerEnvelope,
  type GoalPlannerSnapshot,
  type GoalPlanPreviewEnvelope
} from '../goalPlannerRunner'
import {
  GOAL_TERM_REDUCTION_MONTHS,
  type GoalPlannerGoal,
  type GoalPlanVariant,
  type GoalTermReductionMonths
} from '../goalPlanner'
import { useModalDialog } from '../hooks/useModalDialog'
import { Schedule } from './Schedule'

interface GoalPlannerProps {
  loanId: string
  sourceRevision: string
  config: LoanConfig
  repayments: EarlyRepayment[]
  repaymentRules: RepaymentRule[]
  gracePeriods: GracePeriod[]
  selectedScenario: string
  displayDecimals: 0 | 2
  disabled?: boolean
  applyGoalPlan: (request: ApplyGoalPlanRequest) => void
}

const parseAmount = (value: string) => {
  const amount = Number(value.replace(/\s/g, '').replace(',', '.'))
  return Number.isFinite(amount) ? amount : 0
}

const termReductionLabels: Record<GoalTermReductionMonths, string> = {
  6: 'На 6 месяцев',
  12: 'На 1 год',
  24: 'На 2 года',
  36: 'На 3 года',
  60: 'На 5 лет',
  120: 'На 10 лет'
}

const defaultDates = (config: LoanConfig, gracePeriods: GracePeriod[]) => {
  const today = format(new Date(), 'yyyy-MM-dd')
  const firstPossible = today < config.issueDate ? config.issueDate : today
  try {
    const paymentDate = scheduledPaymentDates(config, gracePeriods).find(date => date >= firstPossible)
    return { planStartDate: paymentDate ?? config.firstPaymentDate, oneTimeDate: firstPossible }
  } catch {
    return { planStartDate: config.firstPaymentDate, oneTimeDate: firstPossible }
  }
}

const recommendation = (variant: GoalPlanVariant, money: (value: number) => string) => {
  if (variant.kind === 'monthlyExtra') return `Доплачивайте сверх обязательного платежа ${money(variant.monthlyExtra ?? 0)} каждый месяц`
  if (variant.kind === 'monthlyTotalPayment') return `Переводите банку всего ${money(variant.totalMonthlyPayment ?? 0)} в платёжную дату`
  if (variant.kind === 'oneTime') return `Внесите разово ${money(variant.oneTimePayment ?? 0)}`
  const parts = [
    variant.oneTimePayment ? `внесите ${money(variant.oneTimePayment)} разово` : '',
    variant.monthlyExtra ? `доплачивайте ${money(variant.monthlyExtra)} сверх обязательного платежа ежемесячно` : '',
    variant.totalMonthlyPayment ? `переводите банку всего ${money(variant.totalMonthlyPayment)} в платёжную дату` : ''
  ].filter(Boolean)
  return parts.length ? `${parts.join(', затем ')}`.replace(/^./, letter => letter.toUpperCase()) : 'Комбинированный план'
}

const variantDescriptions: Record<GoalPlanVariant['kind'], string> = {
  monthlyExtra: 'Обязательный платёж сохраняется, указанная сумма добавляется к нему каждый месяц.',
  monthlyTotalPayment: 'Указана вся сумма перевода в платёжную дату: обязательная часть уже включена.',
  oneTime: 'Один досрочный взнос в выбранную дату без нового регулярного правила.',
  combined: 'Доступный разовый взнос сочетается с минимальной регулярной суммой, необходимой для цели.'
}

function GoalPlanPreviewModal({ envelope, repayments, displayDecimals, close }: { envelope: GoalPlanPreviewEnvelope; repayments: EarlyRepayment[]; displayDecimals: 0 | 2; close: () => void }) {
  const { dialogRef, titleId } = useModalDialog(close)
  const [rows, setRows] = useState(0)
  return <div className="modal-backdrop"><div className="modal goal-preview-modal" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
    <div className="modal-head"><div><span className="eyebrow">Планировщик цели</span><h2 id={titleId}>Новый график платежей</h2></div><button className="icon-btn" aria-label="Закрыть новый график" onClick={close}><X/></button></div>
    <div className="goal-preview-body"><Schedule schedule={envelope.result.planned.schedule} baseSchedule={envelope.result.current.schedule} repayments={repayments} config={envelope.snapshot.config} gracePeriods={envelope.snapshot.gracePeriods} currency={envelope.snapshot.config.currency} displayDecimals={displayDecimals} rows={rows} setRows={setRows}/></div>
    <div className="modal-actions"><button className="ghost" onClick={close}>Закрыть</button></div>
  </div></div>
}

export function GoalPlanner({ loanId, sourceRevision, config, repayments, repaymentRules, gracePeriods, selectedScenario, displayDecimals, disabled = false, applyGoalPlan }: GoalPlannerProps) {
  const initialDates = useMemo(() => defaultDates(config, gracePeriods), [config, gracePeriods])
  const [goalType, setGoalType] = useState<GoalPlannerGoal['type']>('monthsEarlier')
  const [months, setMonths] = useState<GoalTermReductionMonths>(12)
  const [targetDate, setTargetDate] = useState(config.firstPaymentDate)
  const [monthlyBudget, setMonthlyBudget] = useState('50000')
  const [maxOverpayment, setMaxOverpayment] = useState('100000')
  const [planStartDate, setPlanStartDate] = useState(initialDates.planStartDate)
  const [oneTimeDate, setOneTimeDate] = useState(initialDates.oneTimeDate)
  const [availableNow, setAvailableNow] = useState('100000')
  const [envelope, setEnvelope] = useState<GoalPlannerEnvelope | null>(null)
  const [preview, setPreview] = useState<GoalPlanPreviewEnvelope | null>(null)
  const [loading, setLoading] = useState(false)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [showResults, setShowResults] = useState(true)
  const [showComparison, setShowComparison] = useState(false)
  const runnerRef = useRef<GoalPlannerRunner | null>(null)
  const { money } = createMoneyFormatter(config.currency, displayDecimals)

  const signature = JSON.stringify([sourceRevision, loanId, goalType, months, targetDate, monthlyBudget, maxOverpayment, planStartDate, oneTimeDate, availableNow])
  const resultIsCurrent = envelope?.revision === signature && !disabled && envelope.snapshot.config === config && envelope.snapshot.repayments === repayments && envelope.snapshot.repaymentRules === repaymentRules && envelope.snapshot.gracePeriods === gracePeriods
  const result = resultIsCurrent ? envelope.result : null

  useEffect(() => {
    runnerRef.current?.cancel()
    setLoading(false)
    setPreviewLoading(false)
    setPreview(null)
    setError('')
    setShowComparison(false)
  }, [signature, config, repayments, repaymentRules, gracePeriods])

  useEffect(() => () => runnerRef.current?.dispose(), [])

  const goal = (): GoalPlannerGoal => {
    if (goalType === 'monthsEarlier') return { type: goalType, months }
    if (goalType === 'targetDate') return { type: goalType, targetDate }
    if (goalType === 'monthlyBudget') return { type: goalType, amount: parseAmount(monthlyBudget) }
    return { type: goalType, amount: parseAmount(maxOverpayment) }
  }

  const snapshot = (): GoalPlannerSnapshot => ({
    revision: signature,
    loanId,
    config,
    repayments,
    repaymentRules,
    gracePeriods,
    selectedScenario,
    goal: goal(),
    planStartDate,
    oneTimeDate,
    availableNow: parseAmount(availableNow)
  })

  const calculate = () => {
    setError('')
    setStatus('')
    setPreview(null)
    setShowResults(true)
    setShowComparison(false)
    setLoading(true)
    runnerRef.current ??= new GoalPlannerRunner()
    runnerRef.current.calculate(snapshot(), next => {
      setEnvelope(next)
      setLoading(false)
    }, message => {
      setError(message)
      setLoading(false)
    })
  }

  const cancel = () => {
    runnerRef.current?.cancel()
    setLoading(false)
    setPreviewLoading(false)
    setStatus('Расчёт отменён')
  }

  const openPreview = (variant: GoalPlanVariant) => {
    if (!envelope || !resultIsCurrent || variant.status !== 'achieved') return
    setError('')
    setPreviewLoading(true)
    runnerRef.current ??= new GoalPlannerRunner()
    runnerRef.current.preview(envelope.snapshot, variant.operations, next => {
      setPreview(next)
      setPreviewLoading(false)
    }, message => {
      setError(message)
      setPreviewLoading(false)
    })
  }

  const apply = (variant: GoalPlanVariant) => {
    if (!envelope || !resultIsCurrent || variant.status !== 'achieved') return
    try {
      applyGoalPlan({
        expectedLoanId: envelope.snapshot.loanId ?? '',
        expectedConfig: envelope.snapshot.config,
        expectedRepayments: envelope.snapshot.repayments,
        expectedRepaymentRules: envelope.snapshot.repaymentRules,
        expectedGracePeriods: envelope.snapshot.gracePeriods,
        operations: variant.operations
      })
      setStatus(`План «${variant.title}» добавлен в кредит`)
      setError('')
    } catch (applyError) {
      setError(applyError instanceof Error ? applyError.message : 'Не удалось добавить план в кредит')
    }
  }

  const toggleResults = () => {
    if (showResults) setShowComparison(false)
    setShowResults(value => !value)
  }

  return <div className="goal-planner-layout">
    <section className="panel form-panel goal-form-panel">
      <div className="panel-head">
        <div><span className="eyebrow">Планировщик цели</span><h3>Какого результата вы хотите достичь?</h3><p>Расчёт использует текущий график, комиссии, льготы, изменения ставки и уже добавленные операции.</p></div>
        <Target/>
      </div>
      <div className="form-grid">
        <label className="field"><span>Цель</span><select value={goalType} onChange={event => setGoalType(event.target.value as GoalPlannerGoal['type'])}><option value="monthsEarlier">Закрыть раньше</option><option value="targetDate">Закрыть к дате</option><option value="monthlyBudget">Уложиться в бюджет</option><option value="maxOverpayment">Ограничить переплату</option></select></label>
        {goalType === 'monthsEarlier' && <label className="field"><span>Сократить срок</span><select value={months} onChange={event => setMonths(Number(event.target.value) as GoalTermReductionMonths)}>{GOAL_TERM_REDUCTION_MONTHS.map(value => <option value={value} key={value}>{termReductionLabels[value]}</option>)}</select></label>}
        {goalType === 'targetDate' && <label className="field"><span>Закрыть не позже</span><input type="date" value={targetDate} onChange={event => setTargetDate(event.target.value)}/></label>}
        {goalType === 'monthlyBudget' && <label className="field"><span>Ежемесячный бюджет</span><input inputMode="decimal" value={monthlyBudget} onChange={event => setMonthlyBudget(event.target.value)}/></label>}
        {goalType === 'maxOverpayment' && <label className="field"><span>Переплата, проценты + комиссии</span><input inputMode="decimal" value={maxOverpayment} onChange={event => setMaxOverpayment(event.target.value)}/></label>}
        <label className="field"><span>Начать регулярный план</span><input type="date" value={planStartDate} onChange={event => setPlanStartDate(event.target.value)}/></label>
        <label className="field"><span>Дата разового взноса</span><input type="date" value={oneTimeDate} onChange={event => setOneTimeDate(event.target.value)}/></label>
        <label className="field"><span>Можно внести разово</span><input inputMode="decimal" value={availableNow} onChange={event => setAvailableNow(event.target.value)}/></label>
      </div>
      <p className="goal-form-note">Комбинированный вариант фиксирует доступный разовый взнос и подбирает минимальную регулярную доплату. Разовый взнос и его комиссия показываются отдельно.</p>
      <div className="goal-form-actions">
        <button className="primary" disabled={disabled || loading} onClick={calculate}><Target/> {loading ? 'Подбираем варианты…' : 'Рассчитать план'}</button>
        {loading && <button className="ghost" onClick={cancel}>Отменить</button>}
        {result && <button className="ghost" aria-controls="goal-planner-results" aria-expanded={showResults} onClick={toggleResults}>{showResults ? <ChevronUp/> : <ChevronDown/>} {showResults ? 'Скрыть результаты' : 'Показать результаты'}</button>}
        {result && showResults && result.variants.some(item => item.status === 'achieved') && <button className="ghost" aria-controls="goal-planner-comparison" aria-expanded={showComparison} onClick={() => setShowComparison(value => !value)}><Scale/> {showComparison ? 'Скрыть сравнение' : 'Сравнить варианты'}</button>}
      </div>
      {disabled && <p className="inline-error" role="status">Дождитесь актуального расчёта кредита и исправьте ошибки перед запуском планировщика.</p>}
      {(loading || previewLoading) && <div className="alert goal-progress" role="status" aria-live="polite">{previewLoading ? 'Строим выбранный график…' : 'Подбираем минимальные суммы в отдельном Worker…'}</div>}
      {error && <div className="alert" role="alert">{error}</div>}
      {status && <div className="alert ready-notice" role="status"><Check/> {status}</div>}
      {!resultIsCurrent && envelope && <div className="alert" role="status">Параметры изменились. Пересчитайте план, чтобы применить актуальный результат.</div>}

      {result && showResults && <section className="goal-results goal-results-inline" id="goal-planner-results" aria-live="polite">
        <div className="section-heading"><div><span className="eyebrow">Результат</span><h2>{result.status === 'alreadyAchieved' ? 'Цель уже достигнута текущим планом' : result.status === 'infeasible' ? 'Цель пока недостижима' : 'Варианты достижения цели'}</h2></div></div>
        {result.message && <div className="alert ready-notice">{result.message}</div>}
        {showComparison && <div className="table-wrap force-mobile-table goal-comparison" id="goal-planner-comparison"><table><caption className="sr-only">Сравнение рассчитанных вариантов достижения цели.</caption><thead><tr><th>Вариант</th><th>Закрытие</th><th>Проценты</th><th>Комиссии</th><th>Доп. вложения</th><th>Всего банку</th></tr></thead><tbody>{result.variants.filter(item => item.status === 'achieved').map(variant => <tr key={`compare-${variant.kind}`}><td>{variant.title}</td><td>{shortDate(variant.summary!.closingDate)}</td><td>{money(variant.summary!.total.interest)}</td><td>{money(variant.summary!.total.fees)}</td><td>{money(variant.summary!.plannerContribution.additionalInvestment)}</td><td>{money(variant.summary!.total.bankTransfer)}</td></tr>)}</tbody></table></div>}
        <div className="goal-current"><span>Текущий план</span><b>Закрытие {shortDate(result.current.closingDate)}</b><small>Переплата {money(result.current.overpayment)} · процентов {money(result.current.totalInterest)}</small></div>
        <div className="goal-variant-grid">{result.variants.map(variant => <article className={variant.status === 'achieved' ? 'goal-variant' : 'goal-variant infeasible'} key={variant.kind}>
          <div className="goal-variant-head"><span>{variant.status === 'achieved' ? <CalendarCheck/> : <X/>}</span><div><small>{variant.status === 'achieved' ? 'Цель выполнима' : 'Недоступно'}</small><h3>{variant.title}</h3></div></div>
          <p className="goal-variant-description">{variantDescriptions[variant.kind]}</p>
          {variant.status === 'infeasible' ? <p className="goal-reason">{variant.reason}</p> : <>
            <strong>{recommendation(variant, money)}</strong>
            <dl className="goal-metrics"><div><dt>Дата закрытия</dt><dd>{shortDate(variant.summary!.closingDate)}</dd></div><div><dt>Экономия процентов</dt><dd>{money(variant.summary!.interestSavings)}</dd></div><div><dt>Дополнительные вложения</dt><dd>{money(variant.summary!.plannerContribution.additionalInvestment)}</dd></div><div><dt>По операциям плана банку</dt><dd>{money(variant.summary!.plannerContribution.bankTransfer)}</dd></div><div><dt>Обязательная часть в операциях</dt><dd>{money(variant.summary!.plannerContribution.regularPayment)}</dd></div><div><dt>Досрочно в тело</dt><dd>{money(variant.summary!.plannerContribution.principal)}</dd></div><div><dt>Проценты в операциях</dt><dd>{money(variant.summary!.plannerContribution.interest)}</dd></div><div><dt>Комиссия плана</dt><dd>{money(variant.summary!.plannerContribution.fees)}</dd></div>{variant.summary!.plannerContribution.unused > 0 && <div><dt>Не потребуется из указанного</dt><dd>{money(variant.summary!.plannerContribution.unused)}</dd></div>}<div><dt>Всего банку за кредит</dt><dd>{money(variant.summary!.total.bankTransfer)}</dd></div></dl>
            <div className="goal-card-actions"><button className="ghost" disabled={previewLoading} onClick={() => openPreview(variant)}><Eye/> Посмотреть новый график</button><button className="primary" onClick={() => apply(variant)}>Добавить этот план в кредит</button></div>
          </>}
        </article>)}</div>
      </section>}
    </section>
    {preview && <GoalPlanPreviewModal envelope={preview} repayments={preview.result.repayments} displayDecimals={displayDecimals} close={() => setPreview(null)}/>}
  </div>
}
