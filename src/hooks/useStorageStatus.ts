import { useCallback, useEffect, useState } from 'react'
import { STORAGE_ERROR_EVENT } from '../store'
import { APP_VERSION } from '../version'

type LightTheme = 'emerald' | 'ocean' | 'violet' | 'graphite' | 'warm'
type Theme = LightTheme | 'night'

export function useStorageStatus(theme: Theme) {
  const [showWhatsNew, setShowWhatsNew] = useState(false)
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [lastLightTheme, setLastLightTheme] = useState<LightTheme>('emerald')
  const [storageWarning, setStorageWarning] = useState(false)

  useEffect(() => {
    const safeGet = (key: string) => {
      try {
        return localStorage.getItem(key)
      } catch {
        setStorageWarning(true)
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
    const showWarning = () => setStorageWarning(true)
    window.addEventListener(STORAGE_ERROR_EVENT, showWarning)
    return () => window.removeEventListener(STORAGE_ERROR_EVENT, showWarning)
  }, [])

  useEffect(() => {
    if (theme !== 'night') setLastLightTheme(theme)
  }, [theme])

  const closeWhatsNew = useCallback(() => {
    try {
      localStorage.setItem('credit-calculator-seen-version', APP_VERSION)
    } catch {
      setStorageWarning(true)
    }
    setShowWhatsNew(false)
  }, [])

  const finishOnboarding = useCallback(() => {
    try {
      localStorage.setItem('credit-calculator-onboarding-done', 'yes')
      localStorage.setItem('credit-calculator-seen-version', APP_VERSION)
    } catch {
      setStorageWarning(true)
    }
    setShowOnboarding(false)
  }, [])

  return {
    showWhatsNew,
    showOnboarding,
    lastLightTheme,
    storageWarning,
    closeWhatsNew,
    finishOnboarding
  }
}
