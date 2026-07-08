// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LoanBackupData } from '../importExport'
import { defaultConfig } from '../loanDefaults'
import { useLoanImport } from './useLoanImport'

const data = (patch: Partial<LoanBackupData> = {}): LoanBackupData => ({
  config: defaultConfig,
  repayments: [],
  repaymentRules: [],
  gracePeriods: [],
  selectedScenario: 'combined',
  termUnit: 'months',
  displayDecimals: 2,
  theme: 'emerald',
  ...patch
})

function Probe({ payload = data() }: { payload?: LoanBackupData }) {
  const { importStatus, createLoanFromData } = useLoanImport({
    addLoanFromData: vi.fn(),
    replaceData: vi.fn(),
    resetRows: vi.fn()
  })
  return <>
    <button onClick={() => createLoanFromData(payload, 'файла')}>Create</button>
    {importStatus ? <p role="status">{importStatus.text}</p> : null}
  </>
}

afterEach(() => cleanup())

describe('useLoanImport', () => {
  it('показывает предупреждения, полученные при чтении импортируемого файла', async () => {
    const user = userEvent.setup()

    render(<Probe payload={data({ importWarnings: ['Валюта GBP не поддерживается и заменена на RUB'] })}/>)

    await user.click(screen.getByRole('button', { name: 'Create' }))

    expect(screen.getByRole('status').textContent).toContain('Предупреждение: Валюта GBP не поддерживается и заменена на RUB')
  })
})
