import { useEffect, useState } from 'react'
import type React from 'react'
import { CircleHelp } from 'lucide-react'

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <label className="field"><span>{label}{hint && <span title={hint}><CircleHelp size={13}/></span>}</span>{children}</label>
}

export function NumberInput({ value, onCommit, ...props }: { value: number; onCommit: (value: number) => void } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])
  const commit = (rawValue = draft) => {
    if (rawValue.trim() === '') { setDraft(String(value)); return }
    const parsed = Number(rawValue)
    if (!Number.isFinite(parsed)) { setDraft(String(value)); return }
    onCommit(parsed)
    setDraft(String(parsed))
  }
  return <input {...props} type="number" value={draft} onChange={event => setDraft(event.target.value)} onBlur={event => commit(event.currentTarget.value)} onKeyDown={event => {
    if (event.key === 'Enter') event.currentTarget.blur()
    if (event.key === 'Escape') { setDraft(String(value)); event.currentTarget.blur() }
  }}/>
}
