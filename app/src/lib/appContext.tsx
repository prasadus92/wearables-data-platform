import type { Device, JunctionEnv } from '@youth/health-core';
import { createContext, useContext } from 'react';

import type { ProviderInfo } from './catalog';
import type { Session } from './storage';

export type Route =
  | { name: 'home' }
  | { name: 'devices' }
  | { name: 'connectMenu' }
  | { name: 'connectIntro'; provider: ProviderInfo }
  /** Apple Watch pairing flow; the provider is implied (apple_health_kit). */
  | { name: 'connectApple' }
  | {
      name: 'connectResult';
      provider: ProviderInfo;
      ok: boolean;
      /** Provider was connected before the flow even started. */
      already?: boolean;
      message?: string;
    }
  /** Post-success syncing story shown between Done and home. */
  | { name: 'connectSync'; provider: ProviderInfo };

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
  /**
   * Device list for the active session, shared across screens. Null means
   * unknown (nothing fetched successfully yet); screens must treat null as
   * loading and never as "no devices". A real empty account is [].
   */
  devices: Device[] | null;
  /**
   * Refetches the device list with retries. Resolves with the fresh list,
   * or null when every attempt failed (the cached list is kept as is).
   */
  refreshDevices: () => Promise<Device[] | null>;
  nav: Nav;
}

export const AppContext = createContext<AppState | null>(null);

export function useApp(): AppState {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppContext.Provider');
  return ctx;
}
