import { X } from 'lucide-react'
import { useModalDialog } from '../hooks/useModalDialog'
import { APP_VERSION, CHANGELOG } from '../version'

export function WhatsNewModal({ close, openChanges }: { close: () => void; openChanges: () => void }) {
  const { dialogRef, titleId } = useModalDialog(close)
  const latest = CHANGELOG[0]
  if (!latest) return null
  return <div className="modal-backdrop"><div className="modal small-modal" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}><div className="modal-head"><div><span className="eyebrow">Версия {APP_VERSION}</span><h2 id={titleId}>Что нового</h2></div><button className="icon-btn" aria-label="Закрыть окно что нового" onClick={close}><X/></button></div><div className="modal-body"><p className="share-warning">{latest.title}</p><ul className="whats-new-list">{latest.items.slice(0, 5).map(item => <li key={item}>{item}</li>)}</ul></div><div className="modal-actions"><button className="ghost" onClick={openChanges}>Вся история</button><button className="primary" onClick={close}>Понятно</button></div></div></div>
}
