import AsyncStorage from '@react-native-async-storage/async-storage';

export interface Session {
  userId: string;
  clientUserId: string;
}

const SESSION_KEY = 'yw.session';
const SKIPPED_KEY = 'yw.onboardingSkipped';
const CARD_DISMISSED_KEY = 'yw.connectCardDismissed';

export const storage = {
  async loadSession(): Promise<Session | null> {
    const raw = await AsyncStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as Session;
      if (parsed.userId && parsed.clientUserId) return parsed;
    } catch {
      // corrupt value, treat as signed out
    }
    return null;
  },

  saveSession(session: Session) {
    return AsyncStorage.setItem(SESSION_KEY, JSON.stringify(session));
  },

  clearSession() {
    return AsyncStorage.multiRemove([SESSION_KEY, SKIPPED_KEY]);
  },

  async loadSkipped(): Promise<boolean> {
    return (await AsyncStorage.getItem(SKIPPED_KEY)) === '1';
  },

  saveSkipped() {
    return AsyncStorage.setItem(SKIPPED_KEY, '1');
  },

  async loadConnectCardDismissed(): Promise<boolean> {
    return (await AsyncStorage.getItem(CARD_DISMISSED_KEY)) === '1';
  },

  saveConnectCardDismissed() {
    return AsyncStorage.setItem(CARD_DISMISSED_KEY, '1');
  },
};
