import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import './styles.css'
import './styles/base-layout.css'
import './styles/responsive.css'
import './styles/themes.css'
import './styles/forms.css'
import './styles/overview-schedule.css'
import './styles/app-ui.css'
import './styles/components.css'
import './styles/mobile-schedule.css'
import './styles/theme-overrides.css'
import './styles/print.css'
import { registerPwaServiceWorker } from './pwa/serviceWorkerRegistration'
import { isNativeApp } from './platform'

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><ErrorBoundary><App /></ErrorBoundary></React.StrictMode>)

if (!isNativeApp()) void registerPwaServiceWorker()
