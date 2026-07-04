import { APP_VERSION, BUILD_DATE, CHANGELOG, COMMIT_SHA, formatBuildDate, shortCommitSha } from '../version'
import { X } from 'lucide-react'
import { useModalDialog } from '../hooks/useModalDialog'

export function Changelog() {
  return <section className="panel changelog-panel"><div className="panel-head"><div><h3>Что изменилось</h3><p>Версия приложения: {APP_VERSION}. Commit: {shortCommitSha(COMMIT_SHA)}. Сборка: {formatBuildDate(BUILD_DATE)}.</p></div></div><div className="changelog-list">{CHANGELOG.map(entry => <article key={entry.version} className="changelog-entry"><div><span className="eyebrow">v{entry.version} · {entry.date}</span><h4>{entry.title}</h4><ul>{entry.items.map(item => <li key={item}>{item}</li>)}</ul></div></article>)}</div></section>
}

export function WhatsNewModal({ close, openChanges }: { close: () => void; openChanges: () => void }) {
  const { dialogRef, titleId } = useModalDialog(close)
  const latest = CHANGELOG[0]
  if (!latest) return null
  return <div className="modal-backdrop"><div className="modal small-modal" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}><div className="modal-head"><div><span className="eyebrow">Версия {APP_VERSION}</span><h2 id={titleId}>Что нового</h2></div><button className="icon-btn" aria-label="Закрыть окно что нового" onClick={close}><X/></button></div><div className="modal-body"><p className="share-warning">{latest.title}</p><ul className="whats-new-list">{latest.items.slice(0, 5).map(item => <li key={item}>{item}</li>)}</ul></div><div className="modal-actions"><button className="ghost" onClick={openChanges}>Вся история</button><button className="primary" onClick={close}>Понятно</button></div></div></div>
}
