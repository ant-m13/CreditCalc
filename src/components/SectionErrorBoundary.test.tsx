// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SectionErrorBoundary } from './SectionErrorBoundary'

function BrokenSection(): never {
  throw new Error('Раздел сломался')
}

describe('SectionErrorBoundary', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('локализует ошибку раздела и сбрасывается при смене раздела или кредита в resetKey', () => {
    const { rerender } = render(<SectionErrorBoundary resetKey="overview:loan-1"><BrokenSection/></SectionErrorBoundary>)

    expect(screen.getByText('Не удалось отобразить раздел')).toBeTruthy()
    expect(screen.getByText('Раздел сломался')).toBeTruthy()

    rerender(<SectionErrorBoundary resetKey="overview:loan-2"><div>Раздел восстановлен</div></SectionErrorBoundary>)

    expect(screen.getByText('Раздел восстановлен')).toBeTruthy()
  })
})
