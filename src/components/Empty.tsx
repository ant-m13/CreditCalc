import type { ReactNode } from 'react'
import { CalendarDays, Plus } from 'lucide-react'

export function Empty({ title, action, icon, description = 'Добавьте событие, и мы сразу покажем его влияние на кредит.' }: { title: string; action: () => void; icon?: ReactNode; description?: string }) {
  return <div className="empty"><span>{icon ?? <CalendarDays/>}</span><h3>{title}</h3><p>{description}</p><button className="ghost" onClick={action}><Plus/> Добавить</button></div>
}
