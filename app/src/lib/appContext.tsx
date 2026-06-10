import type { JunctionEnv } from '@youth/health-core';
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
      /** Provider was connected before the flow even started. */
      already?: boolean;
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
  /** Active data environment. Demo maps to sandbox, Live to production. */
  mode: JunctionEnv;
  /** Switch environments instantly; each keeps its own session. */
  switchMode: (mode: JunctionEnv) => void;
  session: Session | null;
  /** User chose "Not now" during onboarding. */
  skipped: boolean;
  connectCardDismissed: boolean;
  signIn: (session: Session) => void;
  skip: () => void;
  signOut: () => void;
  /**
   * Ends the Clerk identity: signs out of Clerk and clears the session in
   * every mode. Anonymous sessions use signOut (per-mode) instead.
   */
  clerkSignOut: () => void;
  dismissConnectCard: () => void;
  nav: Nav;
}

export const AppContext = createContext<AppState | null>(null);

export function useApp(): AppState {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppContext.Provider');
  return ctx;
}
