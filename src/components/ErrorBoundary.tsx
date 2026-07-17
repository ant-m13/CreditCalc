import { Component, type ErrorInfo, type ReactNode } from 'react'
import { ISO_DATE_LENGTH } from '../constants'
import { PERSISTED_LOAN_STORAGE_KEY } from '../storageKeys'
import { saveBlob } from '../download'
import { isNativeApp } from '../platform'

interface ErrorBoundaryState {
  message: string | null
  recoveryMessage: string | null
}

interface ErrorBoundaryProps {
  children: ReactNode
  reloadPage?: () => void
}

const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'неизвестная ошибка'

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { message: null, recoveryMessage: null }

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { message: error instanceof Error ? error.message : 'Неизвестная ошибка приложения', recoveryMessage: null }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('Application error boundary caught an error', error, info.componentStack)
  }

  downloadLocalData = () => {
    let data = '{}'

    try {
      data = window.localStorage.getItem(PERSISTED_LOAN_STORAGE_KEY) ?? '{}'
    } catch (error) {
      console.error('Failed to read localStorage recovery data', error)
      this.setState({ recoveryMessage: 'Локальное хранилище недоступно. Скачан пустой файл восстановления.' })
    }

    try {
      void saveBlob(new Blob([data], { type: 'application/json' }), `credit-calculator-recovery-${new Date().toISOString().slice(0, ISO_DATE_LENGTH)}.json`)
        .catch(error => {
          console.error('Failed to save recovery data', error)
          this.setState({ recoveryMessage: `Не удалось сохранить файл восстановления: ${errorMessage(error)}.` })
        })
    } catch (error) {
      console.error('Failed to download recovery data', error)
      this.setState({ recoveryMessage: `Не удалось сохранить файл восстановления: ${errorMessage(error)}.` })
    }
  }

  restartWithoutStorage = () => {
    try {
      window.localStorage.removeItem(PERSISTED_LOAN_STORAGE_KEY)
    } catch (error) {
      console.error('Failed to clear localStorage during recovery', error)
      this.setState({ recoveryMessage: isNativeApp() ? `Не удалось очистить локальное хранилище: ${errorMessage(error)}. Очистите данные CreditCalc в системных настройках Android.` : `Не удалось очистить локальное хранилище: ${errorMessage(error)}. Откройте приложение в приватном окне или очистите данные сайта в настройках браузера.` })
      return
    }

    try {
      const reloadPage = this.props.reloadPage ?? (() => window.location.reload())
      reloadPage()
    } catch (error) {
      console.error('Failed to reload during recovery', error)
      this.setState({ recoveryMessage: isNativeApp() ? `Локальное хранилище очищено, но перезапуск не удался: ${errorMessage(error)}. Закройте и снова откройте приложение.` : `Локальное хранилище очищено, но автоматическая перезагрузка не удалась: ${errorMessage(error)}. Перезагрузите страницу вручную (Ctrl+F5).` })
    }
  }

  render() {
    if (!this.state.message) return this.props.children
    return <main className="error-boundary"><section className="panel list-panel"><div className="panel-head"><div><span className="eyebrow">Ошибка приложения</span><h3>Не удалось отобразить расчёт</h3><p>{this.state.message}</p>{this.state.recoveryMessage ? <p role="status">{this.state.recoveryMessage}</p> : null}</div></div><div className="error-actions"><button className="ghost" onClick={this.downloadLocalData}>{isNativeApp() ? 'Сохранить данные' : 'Скачать данные'}</button><button className="ghost" onClick={this.restartWithoutStorage}>{isNativeApp() ? 'Запустить без сохранения' : 'Запустить без локального сохранения'}</button><button className="primary" onClick={() => window.location.reload()}>Перезагрузить приложение</button></div></section></main>
  }
}
