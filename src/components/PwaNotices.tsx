import { useState } from 'react'
import { CheckCircle2, Download, RefreshCw, WifiOff } from 'lucide-react'
import type { PwaStatus } from '../pwa/usePwaStatus'

export const INSTALL_REMINDER_DELAY_MS = 7 * 24 * 60 * 60 * 1000
const INSTALL_REMINDER_SNOOZED_UNTIL_KEY = 'credit-calculator-install-reminder-snoozed-until'
const INSTALL_REMINDER_DISABLED_KEY = 'credit-calculator-install-reminder-disabled'

const installReminderIsDue = () => {
  if (typeof window === 'undefined') return true
  try {
    if (window.localStorage.getItem(INSTALL_REMINDER_DISABLED_KEY) === 'yes') return false
    const snoozedUntil = Number(window.localStorage.getItem(INSTALL_REMINDER_SNOOZED_UNTIL_KEY))
    return !Number.isFinite(snoozedUntil) || snoozedUntil <= Date.now()
  } catch {
    return true
  }
}

interface PwaNoticesProps {
  status: PwaStatus
  storageAtRisk: boolean
  downloadBackup: () => void
}

export function PwaNotices({ status, storageAtRisk, downloadBackup }: PwaNoticesProps) {
  const [installReminderDue, setInstallReminderDue] = useState(installReminderIsDue)
  const [offlineReadyDismissed, setOfflineReadyDismissed] = useState(false)
  const [updateDismissed, setUpdateDismissed] = useState(false)
  const [updateError, setUpdateError] = useState(false)

  const applyUpdate = () => {
    setUpdateError(!status.activateUpdate())
  }

  const snoozeInstallReminder = () => {
    try {
      window.localStorage.setItem(INSTALL_REMINDER_SNOOZED_UNTIL_KEY, String(Date.now() + INSTALL_REMINDER_DELAY_MS))
    } catch {
      // Если хранилище заблокировано, скрываем напоминание хотя бы до перезагрузки.
    }
    setInstallReminderDue(false)
  }

  const disableInstallReminder = () => {
    try {
      window.localStorage.setItem(INSTALL_REMINDER_DISABLED_KEY, 'yes')
      window.localStorage.removeItem(INSTALL_REMINDER_SNOOZED_UNTIL_KEY)
    } catch {
      // Если хранилище заблокировано, скрываем напоминание хотя бы до перезагрузки.
    }
    setInstallReminderDue(false)
  }

  return <div className="pwa-notices">
    {!status.online && <div className="alert pwa-notice offline-notice" role="status" aria-live="polite"><WifiOff size={18}/><span><b>Нет сети</b> Расчёты и ранее загруженные разделы доступны локально.</span></div>}
    {status.serviceWorker.updateAvailable && !updateDismissed && <div className="alert alert-with-actions pwa-notice update-notice" role="status" aria-live="polite">
      <RefreshCw size={18}/><span><b>Доступна новая версия.</b> Обновление применится только после вашего подтверждения.{storageAtRisk ? ' Перед обновлением рекомендуется скачать JSON-копию.' : ''}{updateError ? ' Не удалось активировать ожидающее обновление — повторите после следующей проверки.' : ''}</span>
      <div className="pwa-notice-actions">{storageAtRisk && <button className="ghost compact" onClick={downloadBackup}>Скачать JSON</button>}<button className="primary compact" onClick={applyUpdate}>Обновить</button><button className="ghost compact" onClick={() => setUpdateDismissed(true)}>Позже</button></div>
    </div>}
    {status.installAvailable && installReminderDue && <div className="alert alert-with-actions pwa-notice install-notice">
      <Download size={18}/><span><b>Установите приложение.</b> Калькулятор откроется как отдельное приложение и сможет запускаться офлайн.</span>
      <div className="pwa-notice-actions"><button className="primary compact" onClick={() => { void status.install() }}><Download size={15}/>Установить приложение</button><button className="ghost compact" onClick={snoozeInstallReminder}>Напомнить через неделю</button><button className="ghost compact" onClick={disableInstallReminder}>Больше не напоминать</button></div>
    </div>}
    {status.iosInstallHint && installReminderDue && <div className="alert alert-with-actions pwa-notice install-notice"><Download size={18}/><span><b>Можно установить приложение:</b> откройте меню «Поделиться» и выберите «На экран Домой».</span><div className="pwa-notice-actions"><button className="ghost compact" onClick={snoozeInstallReminder}>Напомнить через неделю</button><button className="ghost compact" onClick={disableInstallReminder}>Больше не напоминать</button></div></div>}
    {status.serviceWorker.offlineReady && !offlineReadyDismissed && <div className="alert alert-with-actions pwa-notice ready-notice" role="status"><CheckCircle2 size={18}/><span><b>Офлайн-режим готов.</b> Оболочка приложения сохранена на этом устройстве.</span><button className="ghost compact" onClick={() => setOfflineReadyDismissed(true)}>Понятно</button></div>}
  </div>
}
