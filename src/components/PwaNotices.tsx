import { useState } from 'react'
import { CheckCircle2, Download, RefreshCw, WifiOff, X } from 'lucide-react'
import type { PwaStatus } from '../pwa/usePwaStatus'

interface PwaNoticesProps {
  status: PwaStatus
  storageAtRisk: boolean
  downloadBackup: () => void
}

export function PwaNotices({ status, storageAtRisk, downloadBackup }: PwaNoticesProps) {
  const [installDismissed, setInstallDismissed] = useState(false)
  const [iosHintDismissed, setIosHintDismissed] = useState(false)
  const [offlineReadyDismissed, setOfflineReadyDismissed] = useState(false)
  const [updateDismissed, setUpdateDismissed] = useState(false)
  const [updateError, setUpdateError] = useState(false)

  const applyUpdate = () => {
    setUpdateError(!status.activateUpdate())
  }

  return <div className="pwa-notices">
    {!status.online && <div className="alert pwa-notice offline-notice" role="status" aria-live="polite"><WifiOff size={18}/><span><b>Нет сети</b> Расчёты и ранее загруженные разделы доступны локально.</span></div>}
    {status.serviceWorker.updateAvailable && !updateDismissed && <div className="alert alert-with-actions pwa-notice update-notice" role="status" aria-live="polite">
      <RefreshCw size={18}/><span><b>Доступна новая версия.</b> Обновление применится только после вашего подтверждения.{storageAtRisk ? ' Перед обновлением рекомендуется скачать JSON-копию.' : ''}{updateError ? ' Не удалось активировать ожидающее обновление — повторите после следующей проверки.' : ''}</span>
      <div className="pwa-notice-actions">{storageAtRisk && <button className="ghost compact" onClick={downloadBackup}>Скачать JSON</button>}<button className="primary compact" onClick={applyUpdate}>Обновить</button><button className="ghost compact" onClick={() => setUpdateDismissed(true)}>Позже</button></div>
    </div>}
    {status.installAvailable && !installDismissed && <div className="alert alert-with-actions pwa-notice install-notice">
      <Download size={18}/><span><b>Установите приложение.</b> Калькулятор откроется как отдельное приложение и сможет запускаться офлайн.</span>
      <div className="pwa-notice-actions"><button className="primary compact" onClick={() => { void status.install() }}><Download size={15}/>Установить приложение</button><button className="ghost compact" onClick={() => setInstallDismissed(true)}>Позже</button></div>
    </div>}
    {status.iosInstallHint && !iosHintDismissed && <div className="alert alert-with-actions pwa-notice install-notice"><Download size={18}/><span><b>Можно установить приложение:</b> откройте меню «Поделиться» и выберите «На экран Домой».</span><button className="icon-btn" aria-label="Скрыть подсказку об установке" onClick={() => setIosHintDismissed(true)}><X size={16}/></button></div>}
    {status.serviceWorker.offlineReady && !offlineReadyDismissed && <div className="alert alert-with-actions pwa-notice ready-notice" role="status"><CheckCircle2 size={18}/><span><b>Офлайн-режим готов.</b> Оболочка приложения сохранена на этом устройстве.</span><button className="ghost compact" onClick={() => setOfflineReadyDismissed(true)}>Понятно</button></div>}
  </div>
}
