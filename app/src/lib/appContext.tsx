import { createContext, useContext } from 'react';

import type { ProviderInfo } from './catalog';
import type { Session } from './storage';

export type Route =
  | { name: 'home' }
  | { name: 'devices' }
  | { name: 'connectMenu' }
  | { name: 'connectIntro'; provider: ProviderInfo }
  | {
      name: 'connectResult';
      provider: ProviderInfo;
      ok: boolean;
      message?: string;
    };

export interface Nav {
  push: (route: Route) => void;
  pop: () => void;
  /** Replace the whole stack with a single root route. */
  reset: (route: Route) => void;
  /** Replace the top route in place. */
  replace: (route: Route) => void;
}

export interface AppState {
  session: Session | null;
  /** User chose "Not now" during onboarding. */
  skipped: boolean;
  connectCardDismissed: boolean;
  signIn: (session: Session) => void;
  skip: () => void;
  signOut: () => void;
  dismissConnectCard: () => void;
  nav: Nav;
}

export const AppContext = createContext<AppState | null>(null);

export function useApp(): AppState {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppContext.Provider');
  return ctx;
}
