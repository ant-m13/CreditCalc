import { useEffect, useId, useRef } from 'react'

const focusableSelector = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',')

type InertElement = HTMLElement & { inert?: boolean }

export function useModalDialog(onClose: () => void) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  const titleId = useId()

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousBodyOverflow = document.body.style.overflow
    const dialog = dialogRef.current
    const focusable = () => Array.from(dialog?.querySelectorAll<HTMLElement>(focusableSelector) ?? [])
      .filter(element => element.offsetParent !== null || element === document.activeElement)
    const hiddenSiblings: Array<{ element: InertElement; ariaHidden: string | null; inert: boolean }> = []
    let current = dialog?.closest('.modal-backdrop') as HTMLElement | null

    while (current?.parentElement) {
      const parent = current.parentElement
      for (const child of Array.from(parent.children)) {
        if (child === current || !(child instanceof HTMLElement)) continue
        const element = child as InertElement
        hiddenSiblings.push({ element, ariaHidden: element.getAttribute('aria-hidden'), inert: Boolean(element.inert) })
        element.setAttribute('aria-hidden', 'true')
        element.inert = true
      }
      current = parent
      if (parent === document.body) break
    }

    document.body.style.overflow = 'hidden'
    const focusTimer = window.setTimeout(() => {
      const first = dialog?.querySelector<HTMLElement>('[autofocus]') ?? focusable()[0] ?? dialog
      first?.focus()
    }, 0)

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab' || !dialog) return
      const elements = focusable()
      if (elements.length === 0) {
        event.preventDefault()
        dialog.focus()
        return
      }
      const first = elements[0]
      const last = elements.at(-1)!
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      window.clearTimeout(focusTimer)
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = previousBodyOverflow
      for (const { element, ariaHidden, inert } of hiddenSiblings) {
        if (ariaHidden === null) element.removeAttribute('aria-hidden')
        else element.setAttribute('aria-hidden', ariaHidden)
        element.inert = inert
      }
      previousFocus?.focus()
    }
  }, [])

  return { dialogRef, titleId }
}
