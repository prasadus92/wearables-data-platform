import { isClerkAPIResponseError, useSignIn } from '@clerk/clerk-expo';
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
import { colors, fonts } from '../theme/tokens';

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

/** Human-readable message for sign-in failures, without naming vendors. */
function signInErrorMessage(err: unknown): string {
  if (isClerkAPIResponseError(err)) {
    const first = err.errors[0];
    return (
      first?.longMessage ??
      first?.message ??
      'Could not sign you in. Try again.'
    );
  }
  return 'Could not reach the server. Check your connection and try again.';
}

/**
 * Onboarding step. `choice` offers sign-in, a guest demo, or skip; `email`
 * and `code` carry the two-step email-code sign-in.
 */
type Step = 'choice' | 'email' | 'code';

export function WelcomeScreen() {
  const { mode, signIn, skip } = useApp();
  const { signIn: clerkSignIn, setActive, isLoaded: clerkReady } = useSignIn();
  const [step, setStep] = useState<Step>('choice');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Guest start: a fresh anonymous identity, no account required. */
  async function handleTryDemo() {
    setBusy(true);
    setError(null);
    try {
      const user = await api.createUser(randomClientUserId(), mode);
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

  async function handleSendCode() {
    const trimmed = email.trim();
    if (!trimmed.includes('@')) {
      setError('Enter your email address.');
      return;
    }
    if (!clerkReady || !clerkSignIn) return;
    setBusy(true);
    setError(null);
    try {
      // Creating the attempt with the strategy also sends the email code.
      await clerkSignIn.create({ identifier: trimmed, strategy: 'email_code' });
      setCode('');
      setStep('code');
    } catch (err) {
      setError(signInErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleVerifyCode() {
    const trimmed = code.trim();
    if (!trimmed) {
      setError('Enter the code from your email.');
      return;
    }
    if (!clerkReady || !clerkSignIn || !setActive) return;
    setBusy(true);
    setError(null);
    try {
      const attempt = await clerkSignIn.attemptFirstFactor({
        strategy: 'email_code',
        code: trimmed,
      });
      if (attempt.status === 'complete') {
        // App watches the session and bootstraps the per-mode user next.
        await setActive({ session: attempt.createdSessionId });
      } else {
        setError('Could not complete sign-in. Try again.');
      }
    } catch (err) {
      setError(signInErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function goTo(next: Step) {
    setError(null);
    setStep(next);
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
              <Text
                style={{ fontFamily: fonts.mono }}
                className="text-[11px] uppercase tracking-[3px] text-[#8E8C88]"
              >
                YOU(th)
              </Text>
              <Text className="mt-2 text-[34px] font-sans-medium leading-[40px] text-card">
                Your body,{'\n'}in real time
              </Text>
            </Animated.View>
            <Animated.View entering={enter(1)} style={{ marginTop: 40 }}>
              <Waveform />
            </Animated.View>
          </View>

          <Animated.View entering={enter(2)}>
            <View className="rounded-t-[28px] bg-card px-6 pb-10 pt-7">
              <Text className="text-[22px] font-sans-medium leading-[28px] text-ink">
                {step === 'email' || step === 'code'
                  ? 'Sign in to your account'
                  : 'Connect your wearables for an enhanced experience'}
              </Text>
              <Text className="mt-2 text-[14px] font-sans leading-[20px] text-sub">
                {step === 'email'
                  ? 'Enter your email and we will send you a one-time code.'
                  : step === 'code'
                    ? `Enter the code we emailed to ${email.trim()}.`
                    : mode === 'sandbox'
                      ? 'Explore with demo wearables and synthetic data. Sign in to keep your data across devices, or try the demo as a guest.'
                      : 'Connect your real wearables. Sign in to keep your data across devices.'}
              </Text>

              {step === 'email' ? (
                <Animated.View entering={enter(0)}>
                  <TextInput
                    value={email}
                    onChangeText={setEmail}
                    placeholder="you@example.com"
                    placeholderTextColor={colors.faint}
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="email"
                    keyboardType="email-address"
                    autoFocus
                    editable={!busy}
                    onSubmitEditing={handleSendCode}
                    className="mt-5 h-14 rounded-2xl border border-line bg-paper px-4 text-[15px] font-sans text-ink"
                  />
                </Animated.View>
              ) : null}

              {step === 'code' ? (
                <Animated.View entering={enter(0)}>
                  <TextInput
                    value={code}
                    onChangeText={setCode}
                    placeholder="6-digit code"
                    placeholderTextColor={colors.faint}
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="one-time-code"
                    keyboardType="number-pad"
                    autoFocus
                    editable={!busy}
                    onSubmitEditing={handleVerifyCode}
                    className="mt-5 h-14 rounded-2xl border border-line bg-paper px-4 text-[15px] font-sans text-ink"
                  />
                </Animated.View>
              ) : null}

              {error ? (
                <Text className="mt-3 text-[13px] font-sans text-coral">
                  {error}
                </Text>
              ) : null}

              {step === 'choice' ? (
                <>
                  <View className="mt-5">
                    <Button
                      label="Sign in"
                      onPress={() => goTo('email')}
                      disabled={busy}
                    />
                  </View>
                  {mode === 'sandbox' ? (
                    <View className="mt-3">
                      <Button
                        label="Try the demo"
                        variant="outline"
                        onPress={handleTryDemo}
                        busy={busy}
                      />
                    </View>
                  ) : null}
                </>
              ) : (
                <View className="mt-5 flex-row gap-3">
                  <View className="flex-1">
                    <Button
                      label="Back"
                      variant="outline"
                      onPress={() => goTo(step === 'code' ? 'email' : 'choice')}
                      disabled={busy}
                    />
                  </View>
                  <View className="flex-1">
                    <Button
                      label={step === 'code' ? 'Verify' : 'Continue'}
                      onPress={step === 'code' ? handleVerifyCode : handleSendCode}
                      busy={busy}
                    />
                  </View>
                </View>
              )}

              {step === 'choice' && mode === 'sandbox' ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={skip}
                  disabled={busy}
                  className="mt-4 items-center py-1.5 active:opacity-60"
                >
                  <Text className="text-[13px] font-sans-medium text-sub underline">
                    Skip for now
                  </Text>
                </Pressable>
              ) : step === 'code' ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={handleSendCode}
                  disabled={busy}
                  className="mt-4 items-center py-1.5 active:opacity-60"
                >
                  <Text className="text-[13px] font-sans-medium text-sub underline">
                    Send a new code
                  </Text>
                </Pressable>
              ) : null}
            </View>
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
