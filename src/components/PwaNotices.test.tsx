// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { INSTALL_REMINDER_DELAY_MS, PwaNotices } from './PwaNotices'
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

beforeEach(() => localStorage.clear())

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.useRealTimers()
})

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

  it('после отказа откладывает следующее напоминание об установке на неделю', () => {
    vi.useFakeTimers()
    const start = new Date(2026, 6, 17, 12)
    vi.setSystemTime(start)
    const props = { status: status({ installAvailable: true }), storageAtRisk: false, downloadBackup: vi.fn() }
    const first = render(<PwaNotices {...props}/>)

    fireEvent.click(screen.getByRole('button', { name: 'Напомнить через неделю' }))
    expect(screen.queryByText('Установите приложение.')).toBeNull()

    first.unmount()
    const beforeWeek = render(<PwaNotices {...props}/>)
    expect(screen.queryByText('Установите приложение.')).toBeNull()

    beforeWeek.unmount()
    vi.setSystemTime(start.getTime() + INSTALL_REMINDER_DELAY_MS + 1)
    render(<PwaNotices {...props}/>)
    expect(screen.getByText('Установите приложение.')).toBeTruthy()
  })

  it('навсегда скрывает автоматическое напоминание по выбору пользователя', () => {
    vi.useFakeTimers()
    const start = new Date(2026, 6, 17, 12)
    vi.setSystemTime(start)
    const props = { status: status({ installAvailable: true }), storageAtRisk: false, downloadBackup: vi.fn() }
    const first = render(<PwaNotices {...props}/>)

    fireEvent.click(screen.getByRole('button', { name: 'Больше не напоминать' }))
    expect(screen.queryByText('Установите приложение.')).toBeNull()

    first.unmount()
    vi.setSystemTime(start.getTime() + INSTALL_REMINDER_DELAY_MS * 10)
    render(<PwaNotices {...props}/>)
    expect(screen.queryByText('Установите приложение.')).toBeNull()
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
