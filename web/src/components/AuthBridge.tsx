import { useAuth } from '@clerk/react'
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { setTokenProvider } from '../api'

// Bridges Clerk session state into the API client. While signed in, every
// request carries a fresh session JWT instead of the static API key; signed
// out, the client falls back to anonymous API-key behavior untouched.
//
// `signedIn` flips to true only AFTER the token provider is registered, so
// consumers never fire a "signed in" request that would still go out with
// the API key.

interface BridgeState {
  /** Clerk has resolved whether a session exists. */
  loaded: boolean
  /** A Clerk session exists and the API client is sending its JWT. */
  signedIn: boolean
}

const AuthContext = createContext<BridgeState>({ loaded: false, signedIn: false })

export function useClerkBridge(): BridgeState {
  return useContext(AuthContext)
}

export function AuthBridge({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn, getToken } = useAuth()
  const [bridged, setBridged] = useState(false)

  useEffect(() => {
    if (isLoaded && isSignedIn) {
      setTokenProvider(() => getToken())
      setBridged(true)
    } else {
      setTokenProvider(null)
      setBridged(false)
    }
    return () => setTokenProvider(null)
  }, [isLoaded, isSignedIn, getToken])

  return (
    <AuthContext.Provider value={{ loaded: isLoaded, signedIn: bridged }}>
      {children}
    </AuthContext.Provider>
  )
}
