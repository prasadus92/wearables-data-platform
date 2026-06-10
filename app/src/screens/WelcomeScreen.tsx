import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated from 'react-native-reanimated';
import Svg, { Circle, Path } from 'react-native-svg';

import { api, ApiError } from '../api/client';
import { Button } from '../components/Button';
import { useApp } from '../lib/appContext';
import { enter } from '../lib/motion';
import { colors } from '../theme/tokens';

function Waveform() {
  return (
    <Svg width="100%" height={90} viewBox="0 0 360 90" fill="none">
      <Path
        d="M0 45 H70 L85 20 L100 70 L115 45 H150"
        stroke={colors.coral}
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M150 45 H210 L225 28 L240 62 L255 45 H300"
        stroke={colors.leaf}
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M300 45 H360"
        stroke="#5A8DD6"
        strokeWidth={2.5}
        strokeLinecap="round"
      />
      <Circle cx={150} cy={45} r={4} fill={colors.coral} />
      <Circle cx={300} cy={45} r={4} fill={colors.leaf} />
    </Svg>
  );
}

/** Generates an anonymous identity; the backend create call is idempotent. */
function randomClientUserId(): string {
  let hex = '';
  for (let i = 0; i < 8; i += 1) {
    hex += Math.floor(Math.random() * 16).toString(16);
  }
  return `youth-ios-${hex}`;
}

export function WelcomeScreen() {
  const { signIn, skip } = useApp();
  const [existingId, setExistingId] = useState('');
  const [showExisting, setShowExisting] = useState(false);
  const [sandbox, setSandbox] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGetStarted() {
    const trimmed = existingId.trim();
    if (showExisting && !trimmed) {
      setError('Enter your ID, or switch back to starting fresh.');
      return;
    }
    const clientUserId = showExisting ? trimmed : randomClientUserId();
    setBusy(true);
    setError(null);
    try {
      const user = await api.createUser(
        clientUserId,
        sandbox ? 'sandbox' : 'production',
      );
      signIn({ userId: user.id, clientUserId: user.client_user_id });
    } catch (err) {
      setError(
        err instanceof ApiError && err.status > 0
          ? err.message
          : 'Could not reach the server. Check your connection and try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  function toggleExisting() {
    setError(null);
    setShowExisting((v) => !v);
  }

  return (
    <View className="flex-1 bg-ink">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1"
      >
        <ScrollView
          contentContainerClassName="flex-grow"
          keyboardShouldPersistTaps="handled"
        >
          <View className="flex-1 justify-center px-8 pt-24">
            <Animated.View entering={enter(0)}>
              <Text className="text-[11px] font-semibold uppercase tracking-[3px] text-[#8E8C88]">
                YOU(th)
              </Text>
              <Text className="mt-2 text-[34px] font-bold leading-[40px] text-card">
                Your body,{'\n'}in real time
              </Text>
            </Animated.View>
            <Animated.View entering={enter(1)} style={{ marginTop: 40 }}>
              <Waveform />
            </Animated.View>
          </View>

          <Animated.View entering={enter(2)}>
            <View className="rounded-t-[28px] bg-card px-6 pb-10 pt-7">
              <Text className="text-[22px] font-bold leading-[28px] text-ink">
                Connect your wearables for an enhanced experience
              </Text>
              <Text className="mt-2 text-[14px] leading-[20px] text-sub">
                Sync your devices to unlock deeper health insights and keep
                your data up to date. No sign-up forms, no passwords.
              </Text>

              {showExisting ? (
                <Animated.View entering={enter(0)}>
                  <TextInput
                    value={existingId}
                    onChangeText={setExistingId}
                    placeholder="Your existing ID (e.g. youth-ios-1a2b3c4d)"
                    placeholderTextColor={colors.faint}
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoFocus
                    editable={!busy}
                    className="mt-5 h-14 rounded-2xl border border-line bg-paper px-4 text-[15px] text-ink"
                  />
                </Animated.View>
              ) : null}

              {error ? (
                <Text className="mt-3 text-[13px] text-coral">{error}</Text>
              ) : null}

              <View className="mt-5 flex-row gap-3">
                <View className="flex-1">
                  <Button label="Not now" variant="outline" onPress={skip} />
                </View>
                <View className="flex-1">
                  <Button
                    label={showExisting ? 'Continue' : 'Get started'}
                    onPress={handleGetStarted}
                    busy={busy}
                  />
                </View>
              </View>

              <Pressable
                accessibilityRole="button"
                onPress={toggleExisting}
                disabled={busy}
                className="mt-4 items-center py-1.5 active:opacity-60"
              >
                <Text className="text-[13px] font-semibold text-sub underline">
                  {showExisting ? 'Start fresh instead' : 'I have an existing ID'}
                </Text>
              </Pressable>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Toggle environment"
                onPress={() => setSandbox((v) => !v)}
                disabled={busy}
                className="mt-1 items-center py-1 active:opacity-60"
              >
                <Text className="text-[11px] uppercase tracking-[1.5px] text-faint">
                  Environment: {sandbox ? 'Sandbox' : 'Production'}
                </Text>
              </Pressable>
            </View>
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
