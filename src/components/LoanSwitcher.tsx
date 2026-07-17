import { forwardRef, useCallback, useImperativeHandle, useState } from 'react'
import { Pencil, Plus, Trash2, X } from 'lucide-react'
import type { LoanProfile } from '../store'
import { useModalDialog } from '../hooks/useModalDialog'
import { Field } from './ui'

type LoanSwitcherMode = 'create' | 'rename' | 'delete'

export interface LoanSwitcherHandle {
  closeDialog: () => boolean
}

interface LoanSwitcherProps {
  loans: LoanProfile[]
  activeLoanId: string
  switchLoan: (id: string) => void
  createLoan: (name?: string, sourceLoanId?: string) => void
  renameLoan: (id: string, name: string) => void
  removeLoan: (id: string) => void
}

export const LoanSwitcher = forwardRef<LoanSwitcherHandle, LoanSwitcherProps>(function LoanSwitcher({ loans, activeLoanId, switchLoan, createLoan, renameLoan, removeLoan }, ref) {
  const activeLoan = loans.find(loan => loan.id === activeLoanId)
  const [mode, setMode] = useState<LoanSwitcherMode | null>(null)
  const [name, setName] = useState('')
  const [sourceLoanId, setSourceLoanId] = useState('')
  const [error, setError] = useState('')
  const closeModal = useCallback(() => setMode(null), [])
  useImperativeHandle(ref, () => ({
    closeDialog: () => {
      if (!mode) return false
      closeModal()
      return true
    }
  }), [closeModal, mode])
  const openCreate = () => { setName(`Кредит ${loans.length + 1}`); setSourceLoanId(''); setError(''); setMode('create') }
  const openRename = () => { setName(activeLoan?.name ?? 'Мой кредит'); setError(''); setMode('rename') }
  const openDelete = () => { if (activeLoan && loans.length > 1) { setError(''); setMode('delete') } }
  const submit = () => {
    const cleaned = name.trim()
    if (!cleaned) return
    try {
      if (mode === 'create') createLoan(cleaned, sourceLoanId || undefined)
      if (mode === 'rename' && activeLoan) renameLoan(activeLoan.id, cleaned)
      setMode(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить кредит')
    }
  }
  const confirmDelete = () => {
    if (!activeLoan || loans.length <= 1) return
    removeLoan(activeLoan.id)
    setMode(null)
  }
  return <div className="loan-switcher"><label><span>Кредит</span><select value={activeLoanId} onChange={event => switchLoan(event.target.value)}>{loans.map(loan => <option key={loan.id} value={loan.id}>{loan.name}</option>)}</select></label><button className="icon-btn" onClick={openRename} title="Переименовать кредит" aria-label="Переименовать кредит"><Pencil/></button><button className="icon-btn" onClick={openCreate} title="Добавить кредит" aria-label="Добавить кредит"><Plus/></button><button className="icon-btn danger" onClick={openDelete} title={loans.length <= 1 ? 'Нельзя удалить единственный кредит' : 'Удалить кредит'} aria-label="Удалить кредит" disabled={loans.length <= 1}><Trash2/></button>{mode && <LoanSwitcherDialog mode={mode} loans={loans} activeLoan={activeLoan} name={name} sourceLoanId={sourceLoanId} error={error} setName={setName} setSourceLoanId={setSourceLoanId} submit={submit} confirmDelete={confirmDelete} close={closeModal}/>}</div>
})

function LoanSwitcherDialog({ mode, loans, activeLoan, name, sourceLoanId, error, setName, setSourceLoanId, submit, confirmDelete, close }: { mode: LoanSwitcherMode; loans: LoanProfile[]; activeLoan?: LoanProfile; name: string; sourceLoanId: string; error: string; setName: (value: string) => void; setSourceLoanId: (value: string) => void; submit: () => void; confirmDelete: () => void; close: () => void }) {
  const { dialogRef, titleId } = useModalDialog(close)
  return <div className="modal-backdrop"><div className="modal small-modal" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}><div className="modal-head"><div><span className="eyebrow">{mode === 'create' ? 'Новый кредит' : mode === 'rename' ? 'Название кредита' : 'Удаление кредита'}</span><h2 id={titleId}>{mode === 'create' ? 'Добавить кредит' : mode === 'rename' ? 'Переименовать кредит' : 'Удалить кредит?'}</h2></div><button className="icon-btn" aria-label="Закрыть окно кредита" onClick={close}><X/></button></div>{mode === 'delete' ? <div className="modal-body"><p className="share-warning">Кредит «{activeLoan?.name}» будет удалён из локального хранилища вместе с параметрами, досрочными платежами и графиком. Это действие нельзя отменить.</p>{error && <div className="alert modal-alert">{error}</div>}</div> : <div className="modal-body">{mode === 'create' && <><p className="share-warning">Можно начать с пустого расчёта или скопировать параметры, досрочные платежи, правила и льготные периоды существующего кредита.</p><Field label="Создать на основе"><select value={sourceLoanId} onChange={event => setSourceLoanId(event.target.value)}><option value="">Пустой кредит</option>{loans.map(loan => <option key={loan.id} value={loan.id}>{loan.name}</option>)}</select></Field></>}<Field label="Название"><input autoFocus value={name} onChange={event => setName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') submit() }}/></Field>{error && <div className="alert modal-alert">{error}</div>}</div>}<div className="modal-actions"><button className="ghost" onClick={close}>Отмена</button>{mode === 'delete' ? <button className="primary danger-action" onClick={confirmDelete}>Удалить</button> : <button className="primary" onClick={submit}>{mode === 'create' && sourceLoanId ? 'Создать копию' : mode === 'create' ? 'Создать' : 'Сохранить'}</button>}</div></div></div>
}
