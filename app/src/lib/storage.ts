import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AggregatorEnv } from '@examplehealth/health-core';

import type { AppearancePref } from '../theme/tokens';

export interface Session {
  userId: string;
  clientUserId: string;
  /**
   * Present when the session was bootstrapped through a signed-in Clerk
   * identity (POST /v1/me). Anonymous and signed-in sessions never mix:
   * each is ignored while the other auth state applies. Mirrors web.
   */
  auth?: 'clerk';
}

// One session per environment, mirroring the web app, so Demo and Live
// coexist and switching between them is instant.
const MODE_KEY = 'wearables-mode';
const sessionKey = (env: AggregatorEnv) => `wearables-user:${env}`;

// Pre-mode key that held a single session; migrated into the sandbox slot.
const LEGACY_SESSION_KEY = 'yw.session';
const SKIPPED_KEY = 'yw.onboardingSkipped';
const CARD_DISMISSED_KEY = 'yw.connectCardDismissed';
const APPEARANCE_KEY = 'yw.appearance';
const RANGE_KEY = 'yw.range';

function parseSession(raw: string | null): Session | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Session;
    if (parsed.userId && parsed.clientUserId) {
      return {
        userId: parsed.userId,
        clientUserId: parsed.clientUserId,
        ...(parsed.auth === 'clerk' ? { auth: 'clerk' as const } : {}),
      };
    }
  } catch {
    // corrupt value, treat as signed out
  }
  return null;
}

export const storage = {
  async loadMode(): Promise<AggregatorEnv> {
    const saved = await AsyncStorage.getItem(MODE_KEY);
    return saved === 'production' ? 'production' : 'sandbox';
  },

  saveMode(mode: AggregatorEnv) {
    return AsyncStorage.setItem(MODE_KEY, mode);
  },

  async loadSessions(): Promise<Record<AggregatorEnv, Session | null>> {
    // Migrate the pre-mode single-session key into the sandbox slot.
    const legacy = await AsyncStorage.getItem(LEGACY_SESSION_KEY);
    if (legacy) {
      const existing = await AsyncStorage.getItem(sessionKey('sandbox'));
      if (!existing) await AsyncStorage.setItem(sessionKey('sandbox'), legacy);
      await AsyncStorage.removeItem(LEGACY_SESSION_KEY);
    }
    const [sandbox, production] = await Promise.all([
      AsyncStorage.getItem(sessionKey('sandbox')),
      AsyncStorage.getItem(sessionKey('production')),
    ]);
    return {
      sandbox: parseSession(sandbox),
      production: parseSession(production),
    };
  },

  saveSession(env: AggregatorEnv, session: Session) {
    return AsyncStorage.setItem(sessionKey(env), JSON.stringify(session));
  },

  clearSession(env: AggregatorEnv) {
    return AsyncStorage.multiRemove([sessionKey(env), SKIPPED_KEY]);
  },

  /** Sign-out from a Clerk identity clears every mode slot at once. */
  clearAllSessions() {
    return AsyncStorage.multiRemove([
      sessionKey('sandbox'),
      sessionKey('production'),
      SKIPPED_KEY,
    ]);
  },

  async loadSkipped(): Promise<boolean> {
    return (await AsyncStorage.getItem(SKIPPED_KEY)) === '1';
  },

  saveSkipped() {
    return AsyncStorage.setItem(SKIPPED_KEY, '1');
  },

  clearSkipped() {
    return AsyncStorage.removeItem(SKIPPED_KEY);
  },

  async loadConnectCardDismissed(): Promise<boolean> {
    return (await AsyncStorage.getItem(CARD_DISMISSED_KEY)) === '1';
  },

  saveConnectCardDismissed() {
    return AsyncStorage.setItem(CARD_DISMISSED_KEY, '1');
  },

  async loadRange(): Promise<string | null> {
    return AsyncStorage.getItem(RANGE_KEY);
  },

  saveRange(label: string) {
    AsyncStorage.setItem(RANGE_KEY, label).catch(() => {});
  },

  async loadAppearance(): Promise<AppearancePref> {
    const saved = await AsyncStorage.getItem(APPEARANCE_KEY);
    return saved === 'light' || saved === 'dark' ? saved : 'system';
  },

  saveAppearance(pref: AppearancePref) {
    return AsyncStorage.setItem(APPEARANCE_KEY, pref);
  },
};
