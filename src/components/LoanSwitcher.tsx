import { useState } from 'react'
import { Pencil, Plus, X } from 'lucide-react'
import type { LoanProfile } from '../store'
import { Field } from './ui'

export function LoanSwitcher({ loans, activeLoanId, switchLoan, createLoan, renameLoan }: { loans: LoanProfile[]; activeLoanId: string; switchLoan: (id: string) => void; createLoan: (name?: string) => void; renameLoan: (id: string, name: string) => void }) {
  const activeLoan = loans.find(loan => loan.id === activeLoanId)
  const [mode, setMode] = useState<'create' | 'rename' | null>(null)
  const [name, setName] = useState('')
  const openCreate = () => { setName(`Кредит ${loans.length + 1}`); setMode('create') }
  const openRename = () => { setName(activeLoan?.name ?? 'Мой кредит'); setMode('rename') }
  const submit = () => {
    const cleaned = name.trim()
    if (!cleaned) return
    if (mode === 'create') createLoan(cleaned)
    if (mode === 'rename' && activeLoan) renameLoan(activeLoan.id, cleaned)
    setMode(null)
  }
  return <div className="loan-switcher"><label><span>Кредит</span><select value={activeLoanId} onChange={event => switchLoan(event.target.value)}>{loans.map(loan => <option key={loan.id} value={loan.id}>{loan.name}</option>)}</select></label><button className="icon-btn" onClick={openRename} title="Переименовать кредит" aria-label="Переименовать кредит"><Pencil/></button><button className="icon-btn" onClick={openCreate} title="Добавить кредит" aria-label="Добавить кредит"><Plus/></button>{mode && <div className="modal-backdrop"><div className="modal small-modal"><div className="modal-head"><div><span className="eyebrow">{mode === 'create' ? 'Новый кредит' : 'Название кредита'}</span><h2>{mode === 'create' ? 'Добавить кредит' : 'Переименовать кредит'}</h2></div><button className="icon-btn" onClick={() => setMode(null)}><X/></button></div><div className="modal-body"><Field label="Название"><input autoFocus value={name} onChange={event => setName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') submit() }}/></Field></div><div className="modal-actions"><button className="ghost" onClick={() => setMode(null)}>Отмена</button><button className="primary" onClick={submit}>{mode === 'create' ? 'Создать' : 'Сохранить'}</button></div></div></div>}</div>
}
