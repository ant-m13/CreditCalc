// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ErrorBoundary } from './ErrorBoundary'

function BrokenApp(): never {
  throw new Error('Корневой сбой')
}

const installThrowingStorage = (message: string) => {
  const storage = {
    length: 0,
    clear: vi.fn(),
    getItem: vi.fn(() => {
      throw new Error(message)
    }),
    key: vi.fn(),
    removeItem: vi.fn(() => {
      throw new Error(message)
    }),
    setItem: vi.fn()
  }

  Object.defineProperty(window, 'localStorage', { configurable: true, value: storage })

  return storage
}

describe('ErrorBoundary', () => {
  let localStorageDescriptor: PropertyDescriptor | undefined
  let createObjectURLDescriptor: PropertyDescriptor | undefined
  let revokeObjectURLDescriptor: PropertyDescriptor | undefined
  let createObjectURLMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    localStorageDescriptor = Object.getOwnPropertyDescriptor(window, 'localStorage')
    createObjectURLDescriptor = Object.getOwnPropertyDescriptor(URL, 'createObjectURL')
    revokeObjectURLDescriptor = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL')
    createObjectURLMock = vi.fn(() => 'blob:recovery')

    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURLMock })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
  })

  afterEach(() => {
    cleanup()
    if (localStorageDescriptor) Object.defineProperty(window, 'localStorage', localStorageDescriptor)
    if (createObjectURLDescriptor) Object.defineProperty(URL, 'createObjectURL', createObjectURLDescriptor)
    else delete (URL as unknown as Record<string, unknown>).createObjectURL
    if (revokeObjectURLDescriptor) Object.defineProperty(URL, 'revokeObjectURL', revokeObjectURLDescriptor)
    else delete (URL as unknown as Record<string, unknown>).revokeObjectURL
    vi.restoreAllMocks()
  })

  it('скачивает пустой fallback, если localStorage недоступен', async () => {
    installThrowingStorage('storage blocked')

    render(<ErrorBoundary><BrokenApp/></ErrorBoundary>)

    fireEvent.click(screen.getByRole('button', { name: 'Скачать данные' }))

    const blob = createObjectURLMock.mock.calls[0][0] as Blob
    await expect(blob.text()).resolves.toBe('{}')
    expect(screen.getByRole('status').textContent).toContain('Локальное хранилище недоступно')
  })

  it('показывает понятное сообщение, если localStorage нельзя очистить', () => {
    const storage = installThrowingStorage('storage blocked')

    render(<ErrorBoundary><BrokenApp/></ErrorBoundary>)

    fireEvent.click(screen.getByRole('button', { name: 'Запустить без локального сохранения' }))

    expect(storage.removeItem).toHaveBeenCalledWith('ipoteka-calculator-v1')
    expect(screen.getByRole('status').textContent).toContain('Не удалось очистить локальное хранилище: storage blocked')
  })

  it('подсказывает ручную перезагрузку, если localStorage очищен, но reload не удался', () => {
    const storage = {
      length: 0,
      clear: vi.fn(),
      getItem: vi.fn(),
      key: vi.fn(),
      removeItem: vi.fn(),
      setItem: vi.fn()
    }
    Object.defineProperty(window, 'localStorage', { configurable: true, value: storage })
    const reloadPage = vi.fn(() => {
      throw new Error('reload blocked')
    })

    render(<ErrorBoundary reloadPage={reloadPage}><BrokenApp/></ErrorBoundary>)

    fireEvent.click(screen.getByRole('button', { name: 'Запустить без локального сохранения' }))

    expect(storage.removeItem).toHaveBeenCalledWith('ipoteka-calculator-v1')
    expect(reloadPage).toHaveBeenCalled()
    expect(screen.getByRole('status').textContent).toContain('Локальное хранилище очищено')
    expect(screen.getByRole('status').textContent).toContain('Ctrl+F5')
  })
})
