// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ExportPanel } from './ExportPanel'

const renderPanel = (calculatedExportsDisabled = false) => {
  const download = vi.fn()
  const print = vi.fn()
  render(
    <ExportPanel
      download={download}
      print={print}
      calculatedExportsDisabled={calculatedExportsDisabled}
      createImported={vi.fn(() => true)}
      replaceImported={vi.fn(() => true)}
      copyShareLink={vi.fn()}
      createParameterCode={vi.fn(async () => 'v1.test')}
      decodeParameterCode={vi.fn()}
      looksLikeParameterLink={vi.fn(() => false)}
      status={null}
    />
  )
  return { download, print }
}

afterEach(() => cleanup())

describe('ExportPanel', () => {
  it('отключает расчётные экспорты во время stale и оставляет JSON доступным', async () => {
    const user = userEvent.setup()
    const { download, print } = renderPanel(true)

    const csv = screen.getByRole('button', { name: /CSV/i }) as HTMLButtonElement
    const excel = screen.getByRole('button', { name: /Excel/i }) as HTMLButtonElement
    const json = screen.getByRole('button', { name: /Сохранить JSON/i }) as HTMLButtonElement
    const pdf = screen.getByRole('button', { name: /PDF \/ печать/i }) as HTMLButtonElement

    expect(csv.disabled).toBe(true)
    expect(excel.disabled).toBe(true)
    expect(pdf.disabled).toBe(true)
    expect(json.disabled).toBe(false)

    await user.click(csv)
    await user.click(pdf)
    expect(download).not.toHaveBeenCalled()
    expect(print).not.toHaveBeenCalled()

    await user.click(json)
    expect(download).toHaveBeenCalledWith('json')
  })
})
