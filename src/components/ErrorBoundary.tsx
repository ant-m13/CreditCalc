import { Component, type ErrorInfo, type ReactNode } from 'react'
import { PERSISTED_LOAN_STORAGE_KEY } from '../storageKeys'

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
      this.setState({ recoveryMessage: 'localStorage недоступен. Скачан пустой файл восстановления.' })
    }

    try {
      const anchor = document.createElement('a')
      anchor.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }))
      anchor.download = `credit-calculator-recovery-${new Date().toISOString().slice(0, 10)}.json`
      anchor.click()
      URL.revokeObjectURL(anchor.href)
    } catch (error) {
      console.error('Failed to download recovery data', error)
      this.setState({ recoveryMessage: `Не удалось скачать файл восстановления: ${errorMessage(error)}.` })
    }
  }

  restartWithoutStorage = () => {
    try {
      window.localStorage.removeItem(PERSISTED_LOAN_STORAGE_KEY)
    } catch (error) {
      console.error('Failed to clear localStorage during recovery', error)
      this.setState({ recoveryMessage: `Не удалось очистить localStorage: ${errorMessage(error)}. Откройте приложение в приватном окне или очистите данные сайта в настройках браузера.` })
      return
    }

    try {
      const reloadPage = this.props.reloadPage ?? (() => window.location.reload())
      reloadPage()
    } catch (error) {
      console.error('Failed to reload during recovery', error)
      this.setState({ recoveryMessage: `localStorage очищен, но автоматическая перезагрузка не удалась: ${errorMessage(error)}. Перезагрузите страницу вручную (Ctrl+F5).` })
    }
  }

  render() {
    if (!this.state.message) return this.props.children
    return <main className="error-boundary"><section className="panel list-panel"><div className="panel-head"><div><span className="eyebrow">Ошибка приложения</span><h3>Не удалось отобразить расчёт</h3><p>{this.state.message}</p>{this.state.recoveryMessage ? <p role="status">{this.state.recoveryMessage}</p> : null}</div></div><div className="error-actions"><button className="ghost" onClick={this.downloadLocalData}>Скачать данные</button><button className="ghost" onClick={this.restartWithoutStorage}>Запустить без localStorage</button><button className="primary" onClick={() => window.location.reload()}>Перезагрузить приложение</button></div></section></main>
  }
}
