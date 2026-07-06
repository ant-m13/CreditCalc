import { Component, type ErrorInfo, type ReactNode } from 'react'

interface ErrorBoundaryState {
  message: string | null
}

export class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { message: null }

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { message: error instanceof Error ? error.message : 'Неизвестная ошибка приложения' }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('Application error boundary caught an error', error, info.componentStack)
  }

  downloadLocalData = () => {
    const data = window.localStorage.getItem('ipoteka-calculator-v1') ?? '{}'
    const anchor = document.createElement('a')
    anchor.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }))
    anchor.download = `credit-calculator-recovery-${new Date().toISOString().slice(0, 10)}.json`
    anchor.click()
    URL.revokeObjectURL(anchor.href)
  }

  restartWithoutStorage = () => {
    window.localStorage.removeItem('ipoteka-calculator-v1')
    window.location.reload()
  }

  render() {
    if (!this.state.message) return this.props.children
    return <main className="error-boundary"><section className="panel list-panel"><div className="panel-head"><div><span className="eyebrow">Ошибка приложения</span><h3>Не удалось отобразить расчёт</h3><p>{this.state.message}</p></div></div><div className="error-actions"><button className="ghost" onClick={this.downloadLocalData}>Скачать данные</button><button className="ghost" onClick={this.restartWithoutStorage}>Запустить без localStorage</button><button className="primary" onClick={() => window.location.reload()}>Перезагрузить приложение</button></div></section></main>
  }
}
