import { ClerkProvider } from '@clerk/react'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import App from './App'
import { AuthBridge } from './components/AuthBridge'
import { ThemeProvider, useTheme } from './components/ThemeProvider'
import './styles.css'

/**
 * Clerk components follow the active theme through appearance variables
 * (no extra theme package needed): dark surfaces from the app's warm dark
 * token set, light keeps the ink primary.
 */
function ThemedClerkProvider({ children }: { children: ReactNode }) {
  const { resolved } = useTheme()
  return (
    <ClerkProvider
      publishableKey={import.meta.env.VITE_CLERK_PUBLISHABLE_KEY}
      afterSignOutUrl="/"
      appearance={
        resolved === 'dark'
          ? {
              variables: {
                colorPrimary: '#f4f2ef',
                colorBackground: '#1c1917',
                colorText: '#f4f2ef',
                colorTextSecondary: '#9c9a94',
                colorInputBackground: '#262220',
                colorInputText: '#f4f2ef',
                colorNeutral: '#f4f2ef',
              },
            }
          : { variables: { colorPrimary: '#1c1c1e' } }
      }
    >
      {children}
    </ClerkProvider>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <ThemedClerkProvider>
        <AuthBridge>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </AuthBridge>
      </ThemedClerkProvider>
    </ThemeProvider>
  </React.StrictMode>,
)
