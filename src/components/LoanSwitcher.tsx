import { useState } from 'react'
import { Pencil, Plus, Trash2, X } from 'lucide-react'
import type { LoanProfile } from '../store'
import { Field } from './ui'

export function LoanSwitcher({ loans, activeLoanId, switchLoan, createLoan, renameLoan, removeLoan }: { loans: LoanProfile[]; activeLoanId: string; switchLoan: (id: string) => void; createLoan: (name?: string) => void; renameLoan: (id: string, name: string) => void; removeLoan: (id: string) => void }) {
  const activeLoan = loans.find(loan => loan.id === activeLoanId)
  const [mode, setMode] = useState<'create' | 'rename' | 'delete' | null>(null)
  const [name, setName] = useState('')
  const openCreate = () => { setName(`Кредит ${loans.length + 1}`); setMode('create') }
  const openRename = () => { setName(activeLoan?.name ?? 'Мой кредит'); setMode('rename') }
  const openDelete = () => { if (activeLoan && loans.length > 1) setMode('delete') }
  const submit = () => {
    const cleaned = name.trim()
    if (!cleaned) return
    if (mode === 'create') createLoan(cleaned)
    if (mode === 'rename' && activeLoan) renameLoan(activeLoan.id, cleaned)
    setMode(null)
  }
  const confirmDelete = () => {
    if (!activeLoan || loans.length <= 1) return
    removeLoan(activeLoan.id)
    setMode(null)
  }
  return <div className="loan-switcher"><label><span>Кредит</span><select value={activeLoanId} onChange={event => switchLoan(event.target.value)}>{loans.map(loan => <option key={loan.id} value={loan.id}>{loan.name}</option>)}</select></label><button className="icon-btn" onClick={openRename} title="Переименовать кредит" aria-label="Переименовать кредит"><Pencil/></button><button className="icon-btn" onClick={openCreate} title="Добавить кредит" aria-label="Добавить кредит"><Plus/></button><button className="icon-btn danger" onClick={openDelete} title={loans.length <= 1 ? 'Нельзя удалить единственный кредит' : 'Удалить кредит'} aria-label="Удалить кредит" disabled={loans.length <= 1}><Trash2/></button>{mode && <div className="modal-backdrop"><div className="modal small-modal"><div className="modal-head"><div><span className="eyebrow">{mode === 'create' ? 'Новый кредит' : mode === 'rename' ? 'Название кредита' : 'Удаление кредита'}</span><h2>{mode === 'create' ? 'Добавить кредит' : mode === 'rename' ? 'Переименовать кредит' : 'Удалить кредит?'}</h2></div><button className="icon-btn" aria-label="Закрыть окно кредита" onClick={() => setMode(null)}><X/></button></div>{mode === 'delete' ? <div className="modal-body"><p className="share-warning">Кредит «{activeLoan?.name}» будет удалён из локального хранилища вместе с параметрами, досрочными платежами и графиком. Это действие нельзя отменить.</p></div> : <div className="modal-body"><Field label="Название"><input autoFocus value={name} onChange={event => setName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') submit() }}/></Field></div>}<div className="modal-actions"><button className="ghost" onClick={() => setMode(null)}>Отмена</button>{mode === 'delete' ? <button className="primary danger-action" onClick={confirmDelete}>Удалить</button> : <button className="primary" onClick={submit}>{mode === 'create' ? 'Создать' : 'Сохранить'}</button>}</div></div></div>}</div>
}
