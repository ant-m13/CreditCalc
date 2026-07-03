import { useState } from 'react'
import { X } from 'lucide-react'
import type { GracePeriod } from '../loanEngine'
import { currencySymbol } from '../formatters'
import { createId } from '../utils/createId'
import { isISODate } from '../utils/dateValidation'
import { Field } from './ui'

interface GraceModalProps {
  close: () => void
  add: (period: GracePeriod) => void
}

export function GraceModal({ close, add }: GraceModalProps) {
  const [start, setStart] = useState('2027-03-01')
  const [end, setEnd] = useState('2027-05-31')
  const [type, setType] = useState<GracePeriod['type']>('interestOnly')
  const [extend, setExtend] = useState(true)
  const [paymentAmount, setPaymentAmount] = useState('')
  const [accrueInterest, setAccrueInterest] = useState(true)
  const [capitalizeInterest, setCapitalizeInterest] = useState(false)
  const [error, setError] = useState('')

  const save = () => {
    if (!isISODate(start) || !isISODate(end)) { setError('Укажите корректные даты льготного периода'); return }
    if (end < start) { setError('Дата окончания не может быть раньше даты начала'); return }
    const normalizedPayment = paymentAmount.trim().replace(/\s/g, '').replace(',', '.')
    const customPayment = normalizedPayment ? Number(normalizedPayment) : undefined
    if (customPayment !== undefined && (!Number.isFinite(customPayment) || customPayment < 0)) { setError('Индивидуальный платёж должен быть неотрицательным'); return }
    try {
      add({
        id: createId('grace'),
        startDate: start,
        endDate: end,
        type,
        ...(customPayment !== undefined && (type === 'reduced' || type === 'custom') ? { paymentAmount: customPayment } : {}),
        extendTerm: extend,
        accrueInterest,
        capitalizeInterest: accrueInterest && capitalizeInterest
      })
      close()
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Не удалось сохранить льготный период')
    }
  }

  return <div className="modal-backdrop">
    <div className="modal">
      <div className="modal-head">
        <div><span className="eyebrow">Условия договора</span><h2>Льготный период</h2></div>
        <button className="icon-btn" aria-label="Закрыть окно льготного периода" onClick={close}><X/></button>
      </div>
      <div className="modal-body">
        <div className="form-grid">
          <Field label="Начало"><input type="date" value={start} onChange={event => setStart(event.target.value)}/></Field>
          <Field label="Окончание"><input type="date" value={end} onChange={event => setEnd(event.target.value)}/></Field>
          <Field label="Режим"><select value={type} onChange={event => setType(event.target.value as GracePeriod['type'])}><option value="full">Полная отсрочка</option><option value="interestOnly">Только проценты</option><option value="reduced">Уменьшенный платёж</option><option value="custom">Индивидуальный</option></select></Field>
          {(type === 'reduced' || type === 'custom') && <Field label="Платёж в период"><div className="with-suffix"><input inputMode="decimal" value={paymentAmount} onChange={event => setPaymentAmount(event.target.value)} placeholder="По умолчанию половина платежа"/><i>{currencySymbol()}</i></div></Field>}
          <label className="toggle-row"><div><b>Продлить срок</b><span>На период действия льготы</span></div><input type="checkbox" checked={extend} onChange={event => setExtend(event.target.checked)}/></label>
          <label className="toggle-row"><div><b>Начислять проценты</b><span>Если выключено, дни льготы будут беспроцентными</span></div><input type="checkbox" checked={accrueInterest} onChange={event => setAccrueInterest(event.target.checked)}/></label>
          <label className="toggle-row"><div><b>Капитализировать проценты</b><span>Добавить отложенные проценты к телу кредита</span></div><input type="checkbox" checked={accrueInterest && capitalizeInterest} disabled={!accrueInterest} onChange={event => setCapitalizeInterest(event.target.checked)}/></label>
        </div>
        {error && <div className="alert modal-alert">{error}</div>}
      </div>
      <div className="modal-actions"><button className="ghost" onClick={close}>Отмена</button><button className="primary" onClick={save}>Добавить период</button></div>
    </div>
  </div>
}
