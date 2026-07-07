import { Component, type ErrorInfo, type ReactNode } from 'react'

interface SectionErrorBoundaryState {
  message: string | null
}

export class SectionErrorBoundary extends Component<{ children: ReactNode; resetKey: string }, SectionErrorBoundaryState> {
  state: SectionErrorBoundaryState = { message: null }

  static getDerivedStateFromError(error: unknown): SectionErrorBoundaryState {
    return { message: error instanceof Error ? error.message : 'Неизвестная ошибка раздела' }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('Section error boundary caught an error', error, info.componentStack)
  }

  componentDidUpdate(previousProps: { resetKey: string }) {
    if (previousProps.resetKey !== this.props.resetKey && this.state.message) {
      this.setState({ message: null })
    }
  }

  render() {
    if (!this.state.message) return this.props.children
    return <section className="panel list-panel"><div className="panel-head"><div><span className="eyebrow">Ошибка раздела</span><h3>Не удалось отобразить раздел</h3><p>{this.state.message}</p></div></div><button className="primary" onClick={() => this.setState({ message: null })}>Повторить</button></section>
  }
}
