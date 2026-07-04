import { useMemo, useState } from 'react'
import { addMonths, format, parseISO } from 'date-fns'
import { ru } from 'date-fns/locale'
import { CalendarDays, CircleHelp, ListChecks, Pencil, Plus, Power, PowerOff, Trash2, TrendingDown } from 'lucide-react'
import { sortRepaymentsByApplicationOrder, type EarlyRepayment } from '../loanEngine'
import { currencySymbol, money, shortDate } from '../formatters'
import { ruleTypeName, scenarioName, sourceName } from '../labels'
import type { RepaymentRule } from '../repaymentRules'
import { createId } from '../utils/createId'
import { isISODate, isISOYearMonth } from '../utils/dateValidation'
import { Field } from './ui'

function Empty({ title, action }: { title: string; action: () => void }) {
  return <div className="empty"><span><TrendingDown/></span><h3>{title}</h3><p>Добавьте событие, и мы сразу покажем его влияние на кредит.</p><button className="ghost" onClick={action}><Plus/> Добавить</button></div>
}

const repaymentDisabled = (item: EarlyRepayment) => item.enabled === false || item.amount <= 0
const ruleHasNoAmount = (rule: RepaymentRule) => rule.type === 'paymentPercent' ? (rule.percent ?? 0) <= 0 : (rule.amount ?? 0) <= 0
const ruleDisabled = (rule: RepaymentRule) => rule.enabled === false || ruleHasNoAmount(rule)
const ruleValueLabel = (rule: RepaymentRule) =>
  rule.type === 'paymentPercent' ? `${rule.percent ?? 0}% от первоначального регулярного платежа` :
  rule.type === 'monthlyTotalPayment' ? `итого ${money(rule.amount ?? 0)}` :
  money(rule.amount ?? 0)
const ruleName = (type: RepaymentRule['type']) =>
  type === 'weeklyFixed' ? 'Еженедельное пополнение' :
  type === 'monthlyFixed' ? 'Ежемесячное пополнение' :
  type === 'bimonthlyFixed' ? 'Пополнение раз в 2 месяца' :
  type === 'quarterlyFixed' ? 'Квартальное пополнение' :
  type === 'semiannualFixed' ? 'Пополнение раз в полгода' :
  type === 'annualFixed' ? 'Ежегодное пополнение' :
  type === 'annualBonus' ? 'Ежегодная премия' :
  type === 'monthlyTotalPayment' ? 'Общий ежемесячный платёж' :
  'Процент от платежа'
const disabledClass = (disabled: boolean) => disabled ? ' disabled-event' : ''

function RepaymentToggleButton({ item, toggle }: { item: EarlyRepayment; toggle: (item: EarlyRepayment) => void }) {
  const enabled = !repaymentDisabled(item)
  const label = `${enabled ? 'Выключить' : 'Включить'} платёж ${shortDate(item.date)}`

  return <button type="button" className={`icon-btn toggle-payment${enabled ? '' : ' is-off'}`} aria-label={label} aria-pressed={enabled} title={enabled ? 'Выключить платёж' : 'Включить платёж'} onClick={() => toggle(item)}>{enabled ? <Power/> : <PowerOff/>}</button>
}

function RepaymentRulesPanel({ rules, addRule, updateRule, removeRule, defaultStart }: { rules: RepaymentRule[]; addRule: (rule: RepaymentRule) => void; updateRule: (rule: RepaymentRule) => void; removeRule: (id: string) => void; defaultStart: string }) {
  const [editingRule, setEditingRule] = useState<RepaymentRule | null>(null)
  const safeDefaultStart = isISODate(defaultStart) ? defaultStart : format(new Date(), 'yyyy-MM-dd')
  const defaultEnd = () => format(addMonths(parseISO(safeDefaultStart), 12), 'yyyy-MM-dd')
  const [type, setType] = useState<RepaymentRule['type']>('monthlyFixed')
  const [start, setStart] = useState(safeDefaultStart)
  const [end, setEnd] = useState(defaultEnd())
  const [amount, setAmount] = useState('20000')
  const [percent, setPercent] = useState('10')
  const [enabled, setEnabled] = useState(true)
  const [skip, setSkip] = useState('')
  const [error, setError] = useState('')
  const [strategy, setStrategy] = useState<EarlyRepayment['strategy']>('reduceTerm')
  const [source, setSource] = useState<EarlyRepayment['source']>('own')
  const [sameDayOrder, setSameDayOrder] = useState<EarlyRepayment['sameDayOrder']>('regularFirst')
  const amountFieldLabel = type === 'paymentPercent' ? 'Процент' : type === 'monthlyTotalPayment' ? 'Общий платёж' : 'Сумма'

  const reset = () => {
    setEditingRule(null)
    setType('monthlyFixed')
    setStart(safeDefaultStart)
    setEnd(defaultEnd())
    setAmount('20000')
    setPercent('10')
    setEnabled(true)
    setSkip('')
    setError('')
    setStrategy('reduceTerm')
    setSource('own')
    setSameDayOrder('regularFirst')
  }

  const startEdit = (rule: RepaymentRule) => {
    setEditingRule(rule)
    setType(rule.type)
    setStart(rule.startDate)
    setEnd(rule.endDate)
    setAmount(String(rule.amount ?? 20000))
    setPercent(String(rule.percent ?? 10))
    setEnabled(rule.enabled ?? true)
    setSkip(rule.skipMonths.join(', '))
    setStrategy(rule.strategy === 'custom' ? 'reduceTerm' : rule.strategy)
    setSource(rule.source)
    setSameDayOrder(rule.sameDayOrder)
  }

  const submit = () => {
    const value = Number(type === 'paymentPercent' ? percent : amount)
    const skipMonths = skip.split(/[,\s;]+/).map(x => x.trim()).filter(Boolean)
    if (!Number.isFinite(value) || value < 0) { setError('Сумма или процент не могут быть отрицательными'); return }
    if (!isISODate(start) || !isISODate(end)) { setError('Укажите корректные даты регулярного платежа'); return }
    if (start > end) { setError('Дата окончания не может быть раньше даты начала'); return }
    if (!skipMonths.every(isISOYearMonth)) { setError('Месяцы пропуска должны иметь формат ГГГГ-ММ'); return }
    const rule: RepaymentRule = {
      id: editingRule?.id ?? createId('rule'),
      name: ruleName(type),
      type,
      startDate: start,
      endDate: end,
      amount: type === 'paymentPercent' ? undefined : value,
      percent: type === 'paymentPercent' ? value : undefined,
      enabled,
      strategy,
      source,
      sameDayOrder: type === 'monthlyTotalPayment' ? 'regularFirst' : sameDayOrder,
      interestFirst: true,
      skipMonths,
      comment: type === 'paymentPercent' ? `${value}% от первоначального регулярного платежа` : type === 'monthlyTotalPayment' ? `Итого к списанию ${money(value)}` : undefined
    }
    try {
      if (editingRule) updateRule(rule)
      else addRule(rule)
      reset()
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Не удалось сохранить регулярный платёж')
    }
  }

  return <section className="panel list-panel rule-panel early-card">
    <div className="panel-head"><div><h3>Регулярные досрочные платежи</h3><p>{editingRule ? 'Редактирование регулярного платежа' : 'Повторяющиеся операции до заданной даты'}</p></div><span className="early-counter">{rules.length}</span></div>
    <div className="rule-form form-grid">
      <Field label="Тип регулярного платежа"><select value={type} onChange={event => setType(event.target.value as RepaymentRule['type'])}><option value="weeklyFixed">Раз в неделю фиксированная сумма</option><option value="monthlyFixed">Каждый месяц фиксированная сумма</option><option value="bimonthlyFixed">Раз в 2 месяца фиксированная сумма</option><option value="quarterlyFixed">Раз в квартал фиксированная сумма</option><option value="semiannualFixed">Раз в полгода фиксированная сумма</option><option value="annualFixed">Раз в год фиксированная сумма</option><option value="annualBonus">Ежегодная премия</option><option value="monthlyTotalPayment">Общий ежемесячный платёж</option><option value="paymentPercent">Процент от первоначального регулярного платежа</option></select></Field>
      <Field label={amountFieldLabel}>{type === 'paymentPercent' ? <div className="with-suffix"><input type="number" min="0" value={percent} onChange={event => setPercent(event.target.value)}/><i>%</i></div> : <div className="with-suffix"><input type="number" min="0" value={amount} onChange={event => setAmount(event.target.value)}/><i>{currencySymbol()}</i></div>}</Field>
      <Field label="Начать с"><input type="date" value={start} onChange={event => setStart(event.target.value)}/></Field>
      <Field label="Применять до"><input type="date" value={end} onChange={event => setEnd(event.target.value)}/></Field>
      <Field label="Стратегия"><select value={strategy} onChange={event => setStrategy(event.target.value as EarlyRepayment['strategy'])}><option value="reduceTerm">Уменьшить срок</option><option value="reducePayment">Уменьшить платёж</option><option value="full">Закрыть полностью</option></select></Field>
      <Field label="Источник"><select value={source} onChange={event => setSource(event.target.value as EarlyRepayment['source'])}><option value="own">Собственные средства</option><option value="subsidy">Маткапитал / субсидия</option><option value="insurance">Страховое возмещение</option><option value="other">Прочее</option></select></Field>
      <Field label="Порядок в дату платежа"><select value={type === 'monthlyTotalPayment' ? 'regularFirst' : sameDayOrder} disabled={type === 'monthlyTotalPayment'} onChange={event => setSameDayOrder(event.target.value as EarlyRepayment['sameDayOrder'])}><option value="regularFirst">Сначала регулярный платёж</option><option value="earlyFirst">Сначала досрочный платёж</option></select></Field>
      <Field label="Пропустить месяцы"><input value={skip} onChange={event => setSkip(event.target.value)} placeholder="2027-01, 2027-05"/></Field>
      <label className="toggle-row"><div><b>Правило включено</b><span>Выключенное правило сохранится, но не создаст операции</span></div><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)}/></label>
    </div>
    {error && <div className="alert modal-alert">{error}</div>}
    <div className="rule-actions"><button className="primary rule-add" onClick={submit}><Plus/> {editingRule ? 'Сохранить изменения' : 'Добавить регулярный платёж'}</button>{editingRule && <button className="ghost" onClick={reset}>Отмена</button>}</div>
    {rules.length ? <div className="event-list rule-list">{rules.map(rule => {
      const disabled = ruleDisabled(rule)
      return <div className={`event compact-event${disabledClass(disabled)}`} key={rule.id}>
        <div className="date-tile"><CalendarDays/></div>
        <div><b>{rule.name}</b><span>{ruleTypeName(rule.type)} · {ruleValueLabel(rule)} · {shortDate(rule.startDate)} — {shortDate(rule.endDate)}</span><small>{disabled ? 'Временно отключено' : `${scenarioName(rule.strategy)} · ${sourceName(rule.source)} · пропусков: ${rule.skipMonths.length}`}</small></div>
        <div className="event-actions"><button className="icon-btn" aria-label={`Редактировать регулярный платёж ${rule.name}`} onClick={() => startEdit(rule)}><Pencil/></button><button className="icon-btn danger" aria-label={`Удалить регулярный платёж ${rule.name}`} onClick={() => removeRule(rule.id)}><Trash2/></button></div>
      </div>
    })}</div> : <div className="tip"><CircleHelp/> Например: +20 000 ₽ каждый месяц, общий платёж 60 000 ₽ в дату списания или премия раз в год.</div>}
  </section>
}

export function EarlyList({ items, rules, generated, remove, edit, toggle, open, addRule, updateRule, removeRule, defaultStart }: { items: EarlyRepayment[]; rules: RepaymentRule[]; generated: EarlyRepayment[]; remove: (id: string) => void; edit: (item: EarlyRepayment) => void; toggle: (item: EarlyRepayment) => void; open: () => void; addRule: (rule: RepaymentRule) => void; updateRule: (rule: RepaymentRule) => void; removeRule: (id: string) => void; defaultStart: string }) {
  const ruleNames = useMemo(() => new Map(rules.map(rule => [rule.id, rule.name])), [rules])
  const activeItems = useMemo(() => items.filter(item => !repaymentDisabled(item)), [items])
  const combined = useMemo(() => sortRepaymentsByApplicationOrder([
    ...items,
    ...generated
  ]).map(item => {
    const manual = items.some(manualItem => manualItem.id === item.id)
    if (manual) return { item, kind: 'manual' as const, label: 'Разовый платёж' }
      const ruleId = item.id.startsWith('rule-') ? item.id.slice(5, -11) : ''
    return { item, kind: 'rule' as const, label: ruleNames.get(ruleId) ?? 'Регулярный платёж' }
  }), [items, generated, ruleNames])
  const manualTotal = activeItems.reduce((sum, item) => sum + item.amount, 0)
  const generatedTotal = generated.reduce((sum, item) => sum + item.amount, 0)

  return <>
    <div className="early-layout">
      <section className="panel list-panel early-card">
        <div className="panel-head"><div><h3>Разовые платежи</h3><p>Операции, введённые вручную</p></div><button className="primary" onClick={open}><Plus/> Добавить</button></div>
        <div className="early-summary"><div><span>Операций</span><b>{items.length}</b></div><div><span>Сумма</span><b>{money(manualTotal)}</b></div></div>
        {items.length ? <div className="event-list">{items.map(item => {
          const disabled = repaymentDisabled(item)
          return <div className={`event${disabledClass(disabled)}`} key={item.id}>
            <div className="date-tile"><b>{format(parseISO(item.date), 'dd')}</b><span>{format(parseISO(item.date), 'MMM yy', { locale: ru })}</span></div>
            <div><b>{money(item.amount)}</b><span>{disabled ? 'Временно отключено' : `${scenarioName(item.strategy)} · ${item.amountMode === 'total' ? 'тело и проценты без комиссий' : 'сумма списания'} · ${sourceName(item.source)}`}</span>{item.comment && <small>{item.comment}</small>}</div>
            <div className="event-actions"><RepaymentToggleButton item={item} toggle={toggle}/><button className="icon-btn" aria-label={`Редактировать платёж ${shortDate(item.date)}`} onClick={() => edit(item)}><Pencil/></button><button className="icon-btn danger" aria-label={`Удалить платёж ${shortDate(item.date)}`} onClick={() => remove(item.id)}><Trash2/></button></div>
          </div>
        })}</div> : <Empty title="Пока нет разовых платежей" action={open}/>}
      </section>
      <RepaymentRulesPanel rules={rules} addRule={addRule} updateRule={updateRule} removeRule={removeRule} defaultStart={defaultStart}/>
    </div>
    <section className="panel list-panel early-calendar">
      <div className="panel-head"><div><h3>Календарь досрочных платежей</h3><p>Разовые и регулярные досрочные платежи</p></div><div className="early-summary inline"><div><span>Всего</span><b>{combined.length}</b></div><div><span>Регулярные</span><b>{money(generatedTotal)}</b></div></div></div>
      {combined.length ? <div className="event-list">{combined.map(({ item, kind, label }) => {
        const disabled = kind === 'manual' && repaymentDisabled(item)
        return <div className={`event combined-event${kind === 'rule' ? ' generated-event' : ''}${disabledClass(disabled)}`} key={`${kind}-${item.id}`}><div className="date-tile">{kind === 'rule' ? <ListChecks/> : <><b>{format(parseISO(item.date), 'dd')}</b><span>{format(parseISO(item.date), 'MMM yy', { locale: ru })}</span></>}</div><div><b>{money(item.amount)}</b><span><em className={`event-badge ${kind === 'rule' ? 'rule' : ''}`}>{kind === 'rule' ? 'Регулярный' : 'Разовый'}</em> {disabled ? `Временно отключено · ${label}` : label} · {shortDate(item.date)} · {scenarioName(item.strategy)} · {sourceName(item.source)}</span>{item.comment && <small>{item.comment}</small>}</div>{kind === 'manual' ? <div className="event-actions"><RepaymentToggleButton item={item} toggle={toggle}/><button className="icon-btn" aria-label={`Редактировать платёж ${shortDate(item.date)}`} onClick={() => edit(item)}><Pencil/></button><button className="icon-btn danger" aria-label={`Удалить платёж ${shortDate(item.date)}`} onClick={() => remove(item.id)}><Trash2/></button></div> : <span className="generated-note">авто</span>}</div>
      })}</div> : <div className="tip"><CircleHelp/> Добавьте разовый или регулярный платёж, чтобы увидеть общий календарь досрочных операций.</div>}
    </section>
  </>
}
