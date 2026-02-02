import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AuthProvider } from './contexts/AuthContext'
import { StorageProvider } from './contexts/StorageContext'
import { SchwabProvider } from './contexts/SchwabContext'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <StorageProvider>
        <SchwabProvider>
          <App />
        </SchwabProvider>
      </StorageProvider>
    </AuthProvider>
  </StrictMode>,
)
