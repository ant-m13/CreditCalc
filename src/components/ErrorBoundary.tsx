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

  render() {
    if (!this.state.message) return this.props.children
    return <main className="error-boundary"><section className="panel list-panel"><div className="panel-head"><div><span className="eyebrow">Ошибка приложения</span><h3>Не удалось отобразить расчёт</h3><p>{this.state.message}</p></div></div><button className="primary" onClick={() => window.location.reload()}>Перезагрузить приложение</button></section></main>
  }
}
