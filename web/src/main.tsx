import {ClerkProvider} from '@clerk/react';
import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { AuthBridge } from './components/AuthBridge'
import './styles.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ClerkProvider
      publishableKey={import.meta.env.VITE_CLERK_PUBLISHABLE_KEY}
      afterSignOutUrl="/"
      appearance={{ variables: { colorPrimary: '#1c1c1e' } }}
    >
      <AuthBridge>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </AuthBridge>
    </ClerkProvider>
  </React.StrictMode>,
)