import { useEffect, useState } from 'react'
import type React from 'react'
import { CircleHelp } from 'lucide-react'

export function Field({ label, hint, help, children }: { label: React.ReactNode; hint?: string; help?: string; children: React.ReactNode }) {
  const helpText = help ?? hint
  const helpLabel = typeof label === 'string' ? `Что влияет: ${label}` : 'Что влияет'
  return <label className="field"><span className="field-title">{label}{helpText && <details className="field-help" onClick={event => event.stopPropagation()}><summary aria-label={helpLabel}><CircleHelp size={13}/></summary><p>{helpText}</p></details>}</span>{children}</label>
}

export function NumberInput({ value, onCommit, ...props }: { value: number; onCommit: (value: number) => void } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])
  const propNumber = (input: unknown) => {
    if (typeof input === 'number') return Number.isFinite(input) ? input : undefined
    if (typeof input !== 'string' || input.trim() === '') return undefined
    const parsed = Number(input)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  const decimals = (input: unknown) => {
    const text = String(input)
    const fraction = text.includes('.') ? text.split('.')[1] : ''
    return Math.min(12, fraction.length)
  }
  const commit = (rawValue = draft) => {
    if (rawValue.trim() === '') { setDraft(String(value)); return }
    const parsed = Number(rawValue)
    if (!Number.isFinite(parsed)) { setDraft(String(value)); return }
    const min = propNumber(props.min)
    const max = propNumber(props.max)
    const step = props.step === 'any' ? undefined : propNumber(props.step)
    let normalized = parsed
    if (min !== undefined) normalized = Math.max(min, normalized)
    if (max !== undefined) normalized = Math.min(max, normalized)
    if (step !== undefined && step > 0) {
      const base = min ?? 0
      normalized = base + Math.round((normalized - base) / step) * step
      normalized = Number(normalized.toFixed(decimals(props.step)))
      if (min !== undefined) normalized = Math.max(min, normalized)
      if (max !== undefined) normalized = Math.min(max, normalized)
    }
    onCommit(normalized)
    setDraft(String(normalized))
  }
  return <input {...props} type="number" value={draft} onChange={event => setDraft(event.target.value)} onBlur={event => commit(event.currentTarget.value)} onKeyDown={event => {
    if (event.key === 'Enter') event.currentTarget.blur()
    if (event.key === 'Escape') { setDraft(String(value)); event.currentTarget.blur() }
  }}/>
}
