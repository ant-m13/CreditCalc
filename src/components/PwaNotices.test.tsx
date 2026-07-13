// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PwaNotices } from './PwaNotices'
import type { PwaStatus } from '../pwa/usePwaStatus'

const status = (patch: Partial<PwaStatus> = {}): PwaStatus => ({
  serviceWorker: { supported: true, registered: true, offlineReady: false, updateAvailable: false, error: '' },
  online: true,
  installed: false,
  installAvailable: false,
  iosInstallHint: false,
  browserPersistence: 'available',
  install: vi.fn().mockResolvedValue('accepted'),
  activateUpdate: vi.fn().mockReturnValue(true),
  requestBrowserPersistence: vi.fn().mockResolvedValue(true),
  ...patch
})

afterEach(cleanup)

describe('PwaNotices', () => {
  it('показывает офлайн-режим без утверждения, что сеть точно недоступна серверу', () => {
    render(<PwaNotices status={status({ online: false })} storageAtRisk={false} downloadBackup={vi.fn()}/>)
    expect(screen.getByText('Нет сети')).toBeTruthy()
    expect(screen.getByText(/ранее загруженные разделы доступны локально/i)).toBeTruthy()
  })

  it('показывает кнопку установки только при доступном browser prompt', () => {
    const install = vi.fn().mockResolvedValue('accepted')
    render(<PwaNotices status={status({ installAvailable: true, install })} storageAtRisk={false} downloadBackup={vi.fn()}/>)

    fireEvent.click(screen.getByRole('button', { name: /Установить приложение/i }))
    expect(install).toHaveBeenCalledTimes(1)
  })

  it('не активирует новую версию автоматически и предлагает backup при риске хранения', () => {
    const activateUpdate = vi.fn().mockReturnValue(true)
    const downloadBackup = vi.fn()
    render(<PwaNotices status={status({ serviceWorker: { supported: true, registered: true, offlineReady: false, updateAvailable: true, error: '' }, activateUpdate })} storageAtRisk downloadBackup={downloadBackup}/>)

    expect(activateUpdate).not.toHaveBeenCalled()
    expect(screen.getByText(/Доступна новая версия/i)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Скачать JSON' }))
    expect(downloadBackup).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Обновить' }))
    expect(activateUpdate).toHaveBeenCalledTimes(1)
  })
})
