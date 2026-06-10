import { useEffect } from 'react';
import { Text, View } from 'react-native';
import Animated, {
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
  ZoomIn,
} from 'react-native-reanimated';
import Svg, { Circle, Path } from 'react-native-svg';

import { Button } from '../components/Button';
import { useApp } from '../lib/appContext';
import type { ProviderInfo } from '../lib/catalog';
import { successCelebration } from '../lib/haptics';
import { enter } from '../lib/motion';
import { colors } from '../theme/tokens';

/** Scale-in with a slight overshoot, so the mark lands with a bounce. */
const popIn = ZoomIn.springify()
  .damping(12)
  .stiffness(180)
  .reduceMotion(ReduceMotion.System);

/** Overshooting spring for the device card, a beat after the mark lands. */
const cardIn = ZoomIn.springify()
  .damping(13)
  .stiffness(190)
  .delay(160)
  .reduceMotion(ReduceMotion.System);

const MARK_SIZE = 88;

/**
 * One expanding ring behind the success mark: scales up while fading out,
 * once. Two of these staggered read as a gentle radio pulse. Skipped
 * entirely under Reduce Motion. All motion is done within ~1.2s.
 */
function PulseRing({ delay }: { delay: number }) {
  const reduced = useReducedMotion();
  const progress = useSharedValue(0);

  useEffect(() => {
    if (reduced) return;
    progress.value = withDelay(
      delay,
      withTiming(1, { duration: 840, easing: Easing.out(Easing.cubic) }),
    );
  }, [reduced, delay, progress]);

  const style = useAnimatedStyle(() => ({
    opacity: progress.value === 0 ? 0 : 0.3 * (1 - progress.value),
    transform: [{ scale: 1 + progress.value * 0.75 }],
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: 'absolute',
          width: MARK_SIZE,
          height: MARK_SIZE,
          borderRadius: MARK_SIZE / 2,
          borderWidth: 2,
          borderColor: colors.leaf,
        },
        style,
      ]}
    />
  );
}

function ResultMark({ ok }: { ok: boolean }) {
  return (
    <Svg
      width={MARK_SIZE}
      height={MARK_SIZE}
      viewBox="0 0 88 88"
      fill="none"
    >
      <Circle
        cx={44}
        cy={44}
        r={42}
        fill={ok ? colors.leafSoft : colors.coralSoft}
      />
      {ok ? (
        <Path
          d="M28 45.5L39.5 57L61 33"
          stroke={colors.leaf}
          strokeWidth={5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : (
        <Path
          d="M31 31L57 57M57 31L31 57"
          stroke={colors.coral}
          strokeWidth={5}
          strokeLinecap="round"
        />
      )}
    </Svg>
  );
}

interface Props {
  provider: ProviderInfo;
  ok: boolean;
  /** Provider was connected before the flow even started: no celebration. */
  already?: boolean;
  message?: string;
}

export function ConnectResultScreen({ provider, ok, already, message }: Props) {
  const { nav } = useApp();
  const celebrate = ok && !already;

  useEffect(() => {
    if (celebrate) {
      // Success notification plus two light afterglow taps, timed to land
      // while the pulse rings expand.
      successCelebration();
    }
  }, [celebrate]);

  return (
    <View className="flex-1 bg-paper px-6 pt-14">
      <View className="flex-1 items-center justify-center">
        <View className="items-center justify-center">
          {celebrate ? (
            <>
              <PulseRing delay={120} />
              <PulseRing delay={360} />
            </>
          ) : null}
          <Animated.View entering={popIn}>
            <ResultMark ok={ok} />
          </Animated.View>
        </View>
        <Animated.View entering={enter(1)} style={{ alignItems: 'center' }}>
          <Text className="mt-7 text-center text-[24px] font-sans-medium text-ink">
            {already
              ? `${provider.name} is already connected`
              : ok
                ? `${provider.name} connected`
                : 'Connection failed'}
          </Text>
          <Text className="mt-2.5 max-w-[300px] text-center text-[14px] font-sans leading-[20px] text-sub">
            {already
              ? 'This device is already linked to your account and syncing. You can manage it from your profile.'
              : ok
                ? 'Pull down on the home screen any time to sync on demand.'
                : (message ??
                  'Something went wrong while connecting. Please try again.')}
          </Text>
        </Animated.View>
        {celebrate ? (
          <Animated.View entering={cardIn}>
            <View className="mt-7 items-center rounded-2xl bg-card px-7 py-4">
              <Text className="text-[15px] font-sans-medium text-ink">
                {provider.name}
              </Text>
              <Text className="mt-1 text-[12px] font-sans text-faint">
                Readings will start flowing in automatically.
              </Text>
            </View>
          </Animated.View>
        ) : null}
      </View>
      <Animated.View entering={enter(2)} style={{ paddingBottom: 48 }}>
        {ok ? (
          <Button label="Done" onPress={() => nav.reset({ name: 'home' })} />
        ) : (
          <>
            <Button
              label="Try again"
              onPress={() => nav.replace({ name: 'connectIntro', provider })}
            />
            <View className="h-3" />
            <Button
              label="Choose another device"
              variant="outline"
              onPress={nav.pop}
            />
          </>
        )}
      </Animated.View>
    </View>
  );
}
