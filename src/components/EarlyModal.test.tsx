// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { EarlyRepayment } from '../loanEngine'
import { EarlyModal } from './EarlyModal'

afterEach(cleanup)

describe('EarlyModal', () => {
  it('сохраняет нулевую сумму как временно отключенный платёж', async () => {
    const user = userEvent.setup()
    const close = vi.fn()
    const save = vi.fn()

    render(
      <EarlyModal
        close={close}
        save={save}
        initial={null}
        defaultDate="2026-01-15"
        isRegularPaymentDate={() => false}
      />
    )

    const amount = screen.getByRole('spinbutton')
    await user.clear(amount)
    await user.type(amount, '0')
    await user.click(screen.getByRole('button', { name: 'Добавить и пересчитать' }))

    expect(save).toHaveBeenCalledWith(expect.objectContaining<Partial<EarlyRepayment>>({
      amount: 0,
      amountMode: 'extra',
      date: '2026-01-15'
    }))
    expect(close).toHaveBeenCalledOnce()
  })

  it('сохраняет явное отключение через переключатель', async () => {
    const user = userEvent.setup()
    const close = vi.fn()
    const save = vi.fn()

    render(
      <EarlyModal
        close={close}
        save={save}
        initial={null}
        defaultDate="2026-01-15"
        isRegularPaymentDate={() => false}
      />
    )

    await user.click(screen.getByRole('checkbox', { name: /Платёж включён/i }))
    await user.click(screen.getByRole('button', { name: 'Добавить и пересчитать' }))

    expect(save).toHaveBeenCalledWith(expect.objectContaining<Partial<EarlyRepayment>>({
      amount: 100000,
      enabled: false,
      date: '2026-01-15'
    }))
    expect(close).toHaveBeenCalledOnce()
  })
})
