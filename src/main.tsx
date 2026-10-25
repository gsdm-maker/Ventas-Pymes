import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { ThemeProvider } from '@/core/theme/ThemeProvider'
import { AuthProvider } from '@/core/auth/AuthProvider'
import { SyncProvider } from '@/core/offline/SyncProvider'
import { ToastProvider } from '@/components/ui/Toast'
import { ConfirmProvider } from '@/components/ui/ConfirmProvider'
import App from './App'
import { AvisoActualizacion } from '@/components/layout/AvisoActualizacion'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <SyncProvider>
            <ToastProvider>
              <ConfirmProvider>
                <App />
                {/* Registra el service worker y avisa cuando hay versión nueva */}
                <AvisoActualizacion />
              </ConfirmProvider>
            </ToastProvider>
          </SyncProvider>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  </React.StrictMode>
)
