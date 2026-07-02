import { useState } from 'react'
import { Sparkles, X } from 'lucide-react'
import type { EarlyRepayment } from '../loanEngine'
import { currencySymbol } from '../formatters'
import { createId } from '../utils/createId'
import { isISODate } from '../utils/dateValidation'
import { Field } from './ui'

interface EarlyModalProps {
  close: () => void
  save: (repayment: EarlyRepayment) => void
  initial: EarlyRepayment | null
  defaultDate: string
  isRegularPaymentDate: (date: string) => boolean
}

export function EarlyModal({ close, save, initial, defaultDate, isRegularPaymentDate }: EarlyModalProps) {
  const [date, setDate] = useState(initial?.date ?? defaultDate)
  const [amount, setAmount] = useState(initial ? String(initial.amount) : '100000')
  const [enabled, setEnabled] = useState(initial?.enabled ?? true)
  const [strategy, setStrategy] = useState<EarlyRepayment['strategy']>(initial?.strategy === 'custom' ? 'reduceTerm' : initial?.strategy ?? 'reduceTerm')
  const [source, setSource] = useState<EarlyRepayment['source']>(initial?.source ?? 'own')
  const [comment, setComment] = useState(initial?.comment ?? '')
  const [amountMode, setAmountMode] = useState<NonNullable<EarlyRepayment['amountMode']>>(initial?.amountMode ?? 'extra')
  const [sameDayOrder, setSameDayOrder] = useState<EarlyRepayment['sameDayOrder']>(initial?.sameDayOrder ?? 'regularFirst')
  const [interestFirst, setInterestFirst] = useState(initial?.interestFirst ?? true)
  const [error, setError] = useState('')

  const submit = () => {
    const parsed = Number(amount)
    const active = enabled && parsed > 0
    if (!isISODate(date)) { setError('Укажите корректную дату досрочного платежа'); return }
    if (!Number.isFinite(parsed) || parsed < 0) { setError('Сумма не может быть отрицательной'); return }
    if (active && amountMode === 'total' && !isRegularPaymentDate(date)) { setError('Общую сумму по телу и процентам без комиссий можно указать только в дату регулярного платежа'); return }
    try {
      save({
        id: initial?.id ?? createId('early'),
        date,
        amount: parsed,
        enabled,
        amountMode,
        strategy,
        source,
        sameDayOrder: amountMode === 'total' ? 'regularFirst' : sameDayOrder,
        interestFirst,
        comment
      })
      close()
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Не удалось сохранить досрочный платёж')
    }
  }

  return <div className="modal-backdrop" onMouseDown={event => event.target === event.currentTarget && close()}>
    <div className="modal">
      <div className="modal-head">
        <div><span className="eyebrow">{initial ? 'Редактирование события' : 'Новое событие'}</span><h2>Досрочный платёж</h2></div>
        <button className="icon-btn" aria-label="Закрыть окно досрочного платежа" onClick={close}><X/></button>
      </div>
      <div className="modal-body">
        <div className="form-grid">
          <Field label="Дата"><input type="date" value={date} onChange={event => setDate(event.target.value)}/></Field>
          <Field label="Сумма"><div className="with-suffix"><input autoFocus type="number" min="0" value={amount} onChange={event => setAmount(event.target.value)}/><i>{currencySymbol()}</i></div></Field>
          <Field label="Как указана сумма"><select value={amountMode} onChange={event => setAmountMode(event.target.value as NonNullable<EarlyRepayment['amountMode']>)}><option value="extra">Сумма списания сверх платежа</option><option value="total">Итого по телу и процентам без комиссий</option></select></Field>
          <Field label="Стратегия"><select value={strategy} onChange={event => setStrategy(event.target.value as EarlyRepayment['strategy'])}><option value="reduceTerm">Уменьшить срок</option><option value="reducePayment">Уменьшить платёж</option><option value="full">Закрыть полностью</option></select></Field>
          <Field label="Источник"><select value={source} onChange={event => setSource(event.target.value as EarlyRepayment['source'])}><option value="own">Собственные средства</option><option value="subsidy">Маткапитал / субсидия</option><option value="insurance">Страховое возмещение</option><option value="other">Прочее</option></select></Field>
          {amountMode === 'extra' && <Field label="Порядок в дату платежа"><select value={sameDayOrder} onChange={event => setSameDayOrder(event.target.value as EarlyRepayment['sameDayOrder'])}><option value="regularFirst">Сначала регулярный платёж</option><option value="earlyFirst">Сначала досрочный платёж</option></select></Field>}
          <label className="toggle-row"><div><b>Платёж включён</b><span>Выключенный платёж сохранится, но не попадёт в расчёт</span></div><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)}/></label>
          <label className="toggle-row"><div><b>Сначала погасить проценты</b><span>Остаток направить в основной долг</span></div><input type="checkbox" checked={interestFirst} onChange={event => setInterestFirst(event.target.checked)}/></label>
        </div>
        <Field label="Комментарий"><input value={comment} onChange={event => setComment(event.target.value)} placeholder="Например, премия за год"/></Field>
        {error && <div className="alert modal-alert">{error}</div>}
        <div className="modal-tip"><Sparkles/> Если задана комиссия за досрочное погашение, она удерживается из суммы списания. Для банковского примера 26.01.2026 укажите сумму 8 704,99 ₽.</div>
      </div>
      <div className="modal-actions"><button className="ghost" onClick={close}>Отмена</button><button className="primary" onClick={submit}>{initial ? 'Сохранить изменения' : 'Добавить и пересчитать'}</button></div>
    </div>
  </div>
}
