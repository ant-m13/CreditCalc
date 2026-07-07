// @vitest-environment jsdom
import { screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('точка входа приложения', () => {
  beforeEach(() => {
    vi.resetModules()
    document.body.innerHTML = '<div id="root"></div>'
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('оборачивает App в ErrorBoundary на верхнем уровне', async () => {
    vi.doMock('./App', () => ({
      default: () => {
        throw new Error('Тестовая ошибка рендера')
      }
    }))

    await import('./main')

    expect(await screen.findByText('Не удалось отобразить расчёт')).toBeTruthy()
    expect(screen.getByText('Тестовая ошибка рендера')).toBeTruthy()
  })
})
