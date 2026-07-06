// @vitest-environment jsdom
import { useState } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useModalDialog } from './useModalDialog'

afterEach(cleanup)

function DialogWithChangingClose({ close }: { close: () => void }) {
  const [value, setValue] = useState('')
  const onClose = () => {
    close()
    setValue(current => current)
  }
  const { dialogRef, titleId } = useModalDialog(onClose)
  return <div className="modal-backdrop"><div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}><h2 id={titleId}>Тестовый диалог</h2><input aria-label="Значение" value={value} onChange={event => setValue(event.target.value)}/></div></div>
}

describe('useModalDialog', () => {
  it('не сбрасывает фокус при изменении identity onClose во время ввода', async () => {
    const user = userEvent.setup()
    render(<DialogWithChangingClose close={vi.fn()}/>)
    const input = screen.getByRole('textbox', { name: 'Значение' })
    await user.click(input)
    await user.type(input, '123')
    expect((input as HTMLInputElement).value).toBe('123')
    expect(document.activeElement).toBe(input)
  })

  it('блокирует прокрутку body и восстанавливает её при unmount', () => {
    document.body.style.overflow = 'auto'
    const { unmount } = render(<DialogWithChangingClose close={vi.fn()}/>)

    expect(document.body.style.overflow).toBe('hidden')
    unmount()
    expect(document.body.style.overflow).toBe('auto')
  })
})
