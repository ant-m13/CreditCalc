import { useCallback, useEffect, useState } from 'react'
import { STORAGE_ERROR_EVENT, STORAGE_STATUS_EVENT, type StorageStatusKind } from '../store'
import { APP_VERSION } from '../version'

type LightTheme = 'emerald' | 'ocean' | 'violet' | 'graphite' | 'warm'
type Theme = LightTheme | 'night'

export function useStorageStatus(theme: Theme) {
  const [showWhatsNew, setShowWhatsNew] = useState(false)
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [lastLightTheme, setLastLightTheme] = useState<LightTheme>('emerald')
  const [storageStatus, setStorageStatus] = useState<{ kind: StorageStatusKind; message: string }>({ kind: 'saved', message: 'Данные сохранены' })

  useEffect(() => {
    const safeGet = (key: string) => {
      try {
        return localStorage.getItem(key)
      } catch {
        setStorageStatus({ kind: 'failed', message: 'Локальное хранилище недоступно' })
        return null
      }
    }
    const onboardingDone = safeGet('credit-calculator-onboarding-done') === 'yes'
    if (!onboardingDone) {
      setShowOnboarding(true)
      return
    }
    const seenVersion = safeGet('credit-calculator-seen-version')
    if (seenVersion !== APP_VERSION) setShowWhatsNew(true)
  }, [])

  useEffect(() => {
    const showLegacyWarning = () => setStorageStatus({ kind: 'failed', message: 'Браузер не дал сохранить данные локально. Экспортируйте расчёт в JSON, чтобы не потерять изменения.' })
    const updateStatus = (event: Event) => {
      const detail = (event as CustomEvent<{ kind?: StorageStatusKind; message?: string }>).detail
      setStorageStatus({
        kind: detail?.kind ?? 'failed',
        message: detail?.message ?? 'Браузер не дал сохранить данные локально. Экспортируйте расчёт в JSON, чтобы не потерять изменения.'
      })
    }
    window.addEventListener(STORAGE_ERROR_EVENT, showLegacyWarning)
    window.addEventListener(STORAGE_STATUS_EVENT, updateStatus)
    return () => {
      window.removeEventListener(STORAGE_ERROR_EVENT, showLegacyWarning)
      window.removeEventListener(STORAGE_STATUS_EVENT, updateStatus)
    }
  }, [])

  useEffect(() => {
    if (theme !== 'night') setLastLightTheme(theme)
  }, [theme])

  const closeWhatsNew = useCallback(() => {
    try {
      localStorage.setItem('credit-calculator-seen-version', APP_VERSION)
    } catch {
      setStorageStatus({ kind: 'failed', message: 'Не удалось сохранить отметку версии' })
    }
    setShowWhatsNew(false)
  }, [])

  const finishOnboarding = useCallback(() => {
    try {
      localStorage.setItem('credit-calculator-onboarding-done', 'yes')
      localStorage.setItem('credit-calculator-seen-version', APP_VERSION)
    } catch {
      setStorageStatus({ kind: 'failed', message: 'Не удалось сохранить состояние первого запуска' })
    }
    setShowOnboarding(false)
  }, [])

  return {
    showWhatsNew,
    showOnboarding,
    lastLightTheme,
    storageWarning: storageStatus.kind === 'saved' ? null : storageStatus.message,
    storageStatus,
    closeWhatsNew,
    finishOnboarding
  }
}
