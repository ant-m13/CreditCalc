// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defaultConfig } from '../loanDefaults'
import { VALIDATED_LOAN_DATA_MARKER } from '../importExport'
import { ExportPanel, ImportPreviewModal } from './ExportPanel'

const renderPanel = (calculatedExportsDisabled = false) => {
  const download = vi.fn()
  const downloadRecovery = vi.fn()
  const print = vi.fn()
  render(
    <ExportPanel
      download={download}
      downloadRecovery={downloadRecovery}
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
  return { download, downloadRecovery, print }
}

afterEach(() => cleanup())

describe('ExportPanel', () => {
  it('отключает все расчётные экспорты и оставляет raw recovery доступным', async () => {
    const user = userEvent.setup()
    const { download, downloadRecovery, print } = renderPanel(true)

    const csv = screen.getByRole('button', { name: /CSV/i }) as HTMLButtonElement
    const excel = screen.getByRole('button', { name: /Excel/i }) as HTMLButtonElement
    const json = screen.getByRole('button', { name: /Сохранить JSON/i }) as HTMLButtonElement
    const pdf = screen.getByRole('button', { name: /PDF \/ печать/i }) as HTMLButtonElement

    expect(csv.disabled).toBe(true)
    expect(excel.disabled).toBe(true)
    expect(pdf.disabled).toBe(true)
    expect(json.disabled).toBe(true)

    await user.click(csv)
    await user.click(pdf)
    expect(download).not.toHaveBeenCalled()
    expect(print).not.toHaveBeenCalled()

    expect(download).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: /Raw recovery JSON/i }))
    expect(downloadRecovery).toHaveBeenCalledOnce()
  })

  it('показывает длинный список предупреждений импорта страницами', async () => {
    const user = userEvent.setup()
    const warnings = Array.from({ length: 45 }, (_, index) => `Предупреждение ${index + 1}`)
    render(<ImportPreviewModal pending={{
      title: 'Проверка импорта',
      description: 'Проверьте данные',
      sourceLabel: 'JSON',
      actionSource: 'файла',
      data: {
        __validatedLoanData: VALIDATED_LOAN_DATA_MARKER,
        config: defaultConfig,
        repayments: [],
        repaymentRules: [],
        gracePeriods: [],
        selectedScenario: 'combined',
        termUnit: 'months',
        displayDecimals: 2,
        theme: 'emerald',
        importWarnings: warnings
      }
    }} createNew={vi.fn()} replaceCurrent={vi.fn()} decline={vi.fn()}/>)

    expect(screen.getAllByRole('status')).toHaveLength(20)
    expect(screen.getByText('Предупреждение 1')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Следующие предупреждения' }))
    expect(screen.queryByText('Предупреждение 1')).toBeNull()
    expect(screen.getByText('Предупреждение 21')).toBeTruthy()
  })
})
