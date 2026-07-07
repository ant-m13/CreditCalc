import { useState } from 'react'
import { CalendarDays, CircleHelp, Plus, Trash2 } from 'lucide-react'
import type { GracePeriod } from '../loanEngine'
import { shortDate } from '../formatters'
import { graceTypeName } from '../labels'
import { Empty } from './Empty'

export function GraceList({ items, remove, open }: { items: GracePeriod[]; remove: (id: string) => void; open: () => void }) {
  const [error, setError] = useState('')
  const removeGrace = (id: string) => {
    try {
      remove(id)
      setError('')
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Не удалось изменить льготные периоды')
    }
  }

  return <section className="panel list-panel"><div className="panel-head"><div><h3>Льготные периоды</h3><p>Отсрочка, проценты или индивидуальный платёж</p></div><button className="primary" onClick={open}><Plus/> Добавить</button></div>{error && <div className="alert">{error}</div>}{items.length ? <div className="event-list">{items.map(item => <div className="event" key={item.id}><div className="date-tile"><CalendarDays/></div><div><b>{shortDate(item.startDate)} — {shortDate(item.endDate)}</b><span>{graceTypeName(item.type)} · {item.extendTerm ? 'с продлением срока' : 'без продления'}</span></div><button className="icon-btn danger" aria-label={`Удалить льготный период ${shortDate(item.startDate)} — ${shortDate(item.endDate)}`} onClick={() => removeGrace(item.id)}><Trash2/></button></div>)}</div> : <Empty title="Льготные периоды не добавлены" action={open}/>}<div className="tip"><CircleHelp/> После льготного периода сначала могут погашаться отложенные платежи и проценты.</div></section>
}
