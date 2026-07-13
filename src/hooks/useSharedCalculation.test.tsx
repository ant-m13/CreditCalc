// @vitest-environment jsdom
import { useState } from 'react'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ImportStatus } from './useLoanImport'

vi.mock('../shareCalculation', () => ({
  readSharedCalculationFromLocation: () => 'v1.invalid',
  decodeSharedCalculation: () => Promise.reject(new Error('Ссылка повреждена'))
}))

import { useSharedCalculation } from './useSharedCalculation'

function Probe() {
  const [status, setStatus] = useState<ImportStatus | null>(null)
  useSharedCalculation({
    createLoanFromData: vi.fn(() => true),
    replaceActiveWithData: vi.fn(() => true),
    setImportStatus: setStatus
  })
  return status ? <p role="alert">{status.text}</p> : null
}

afterEach(() => cleanup())

describe('useSharedCalculation', () => {
  it('удаляет повреждённый payload из hash и сообщает ошибку', async () => {
    window.history.replaceState(null, '', '/CreditCalc/#calc=v1.invalid')
    render(<Probe/>)

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Ссылка повреждена'))
    expect(window.location.hash).toBe('')
    expect(window.location.pathname).toBe('/CreditCalc/')
  })
})
