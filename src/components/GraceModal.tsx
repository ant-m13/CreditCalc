import { useState } from 'react'
import { X } from 'lucide-react'
import type { GracePeriod } from '../loanEngine'
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

  const save = () => {
    add({
      id: crypto.randomUUID(),
      startDate: start,
      endDate: end,
      type,
      extendTerm: extend,
      accrueInterest: true,
      capitalizeInterest: false
    })
    close()
  }

  return <div className="modal-backdrop">
    <div className="modal">
      <div className="modal-head">
        <div><span className="eyebrow">Условия договора</span><h2>Льготный период</h2></div>
        <button className="icon-btn" onClick={close}><X/></button>
      </div>
      <div className="modal-body">
        <div className="form-grid">
          <Field label="Начало"><input type="date" value={start} onChange={event => setStart(event.target.value)}/></Field>
          <Field label="Окончание"><input type="date" value={end} onChange={event => setEnd(event.target.value)}/></Field>
          <Field label="Режим"><select value={type} onChange={event => setType(event.target.value as GracePeriod['type'])}><option value="full">Полная отсрочка</option><option value="interestOnly">Только проценты</option><option value="reduced">Уменьшенный платёж</option><option value="custom">Индивидуальный</option></select></Field>
          <label className="toggle-row"><div><b>Продлить срок</b><span>На период действия льготы</span></div><input type="checkbox" checked={extend} onChange={event => setExtend(event.target.checked)}/></label>
        </div>
      </div>
      <div className="modal-actions"><button className="ghost" onClick={close}>Отмена</button><button className="primary" onClick={save}>Добавить период</button></div>
    </div>
  </div>
}
