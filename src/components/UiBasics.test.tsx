// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GracePeriod } from '../loanEngine'
import { Empty } from './Empty'
import { FontControls } from './FontControls'
import { GraceList } from './GraceList'
import { Field, NumberInput } from './ui'
import { WhatsNewModal } from './WhatsNewModal'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('basic UI components', () => {
  it('invokes empty-state and font-size actions at their boundaries', async () => {
    const user = userEvent.setup()
    const open = vi.fn()
    const setFontSize = vi.fn()
    const { rerender } = render(<><Empty title="Нет событий" action={open}/><FontControls fontSize="normal" setFontSize={setFontSize}/></>)

    await user.click(screen.getByRole('button', { name: 'Добавить' }))
    expect(open).toHaveBeenCalledOnce()
    expect((screen.getByRole('button', { name: 'Уменьшить текст приложения' }) as HTMLButtonElement).disabled).toBe(true)
    await user.click(screen.getByRole('button', { name: 'Увеличить текст приложения' }))
    expect(setFontSize).toHaveBeenCalledWith('large')

    rerender(<FontControls fontSize="xlarge" setFontSize={setFontSize}/>)
    expect((screen.getByRole('button', { name: 'Увеличить текст приложения' }) as HTMLButtonElement).disabled).toBe(true)
    await user.click(screen.getByRole('button', { name: 'Уменьшить текст приложения' }))
    expect(setFontSize).toHaveBeenLastCalledWith('large')
  })

  it('renders grace periods and reports a failed removal without losing the list', async () => {
    const user = userEvent.setup()
    const open = vi.fn()
    const remove = vi.fn(() => { throw new Error('Период используется') })
    const item: GracePeriod = {
      id: 'grace-1',
      startDate: '2027-01-01',
      endDate: '2027-01-31',
      type: 'interestOnly',
      extendTerm: true,
      accrueInterest: true,
      capitalizeInterest: false
    }
    const { rerender } = render(<GraceList items={[]} open={open} remove={remove}/>)

    await user.click(screen.getAllByRole('button', { name: 'Добавить' })[0])
    expect(open).toHaveBeenCalledOnce()

    rerender(<GraceList items={[item]} open={open} remove={remove}/>)
    await user.click(screen.getByRole('button', { name: /Удалить льготный период/ }))
    expect(remove).toHaveBeenCalledWith(item.id)
    expect(screen.getByText('Период используется')).toBeTruthy()
    expect(screen.getByText(/с продлением срока/)).toBeTruthy()
  })

  it('normalizes number input and restores rejected or empty drafts', () => {
    const onCommit = vi.fn(() => true)
    const { rerender } = render(<Field label="Сумма" help="Подсказка"><NumberInput aria-label="Сумма" value={10} min={0} max={20} step={0.5} onCommit={onCommit}/></Field>)
    const input = screen.getByRole('spinbutton', { name: 'Сумма' }) as HTMLInputElement

    fireEvent.change(input, { target: { value: '21.8' } })
    fireEvent.blur(input)
    expect(onCommit).toHaveBeenLastCalledWith(20)
    expect(screen.getByLabelText('Что влияет: Сумма')).toBeTruthy()

    rerender(<NumberInput aria-label="Сумма" value={7} step="any" onCommit={() => false}/>)
    const rejected = screen.getByRole('spinbutton', { name: 'Сумма' }) as HTMLInputElement
    fireEvent.change(rejected, { target: { value: '12' } })
    fireEvent.blur(rejected)
    expect(rejected.value).toBe('7')
    fireEvent.change(rejected, { target: { value: '' } })
    fireEvent.blur(rejected)
    expect(rejected.value).toBe('7')
    fireEvent.change(rejected, { target: { value: '9' } })
    fireEvent.keyDown(rejected, { key: 'Escape' })
    expect(rejected.value).toBe('7')
  })

  it('opens the full changelog and closes the whats-new dialog', async () => {
    const user = userEvent.setup()
    const close = vi.fn()
    const openChanges = vi.fn()
    render(<WhatsNewModal close={close} openChanges={openChanges}/>)

    expect(screen.getByRole('dialog', { name: 'Что нового' })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Вся история' }))
    await user.click(screen.getByRole('button', { name: 'Понятно' }))
    expect(openChanges).toHaveBeenCalledOnce()
    expect(close).toHaveBeenCalledOnce()
  })
})
