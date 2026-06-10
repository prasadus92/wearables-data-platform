import { useEffect } from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated, { ReduceMotion, ZoomIn } from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { Button } from '../components/Button';
import {
  BetaTag,
  SheetBody,
  SheetCaption,
  SheetHandle,
  SheetTitle,
  StorySlides,
  sheetIn,
} from '../components/Sheet';
import { useApp } from '../lib/appContext';
import type { ProviderInfo } from '../lib/catalog';
import { successCelebration } from '../lib/haptics';
import { enter } from '../lib/motion';
import { colors, fonts } from '../theme/tokens';

/** Overshooting spring for the connected chip, a beat after the sheet. */
const chipIn = ZoomIn.springify()
  .damping(13)
  .stiffness(190)
  .delay(220)
  .reduceMotion(ReduceMotion.System);

const HERO_W = 337;
const HERO_H = 300;

/**
 * The design's green-tinted hero with the floating "connected" chip. The
 * device render is approximated by a soft gradient; the chip carries the
 * provider name and a green CONNECTED caption.
 */
function ConnectedHero({ name }: { name: string }) {
  return (
    <View
      className="w-full items-center justify-center overflow-hidden rounded-3xl"
      style={{ height: HERO_H }}
    >
      <Svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${HERO_W} ${HERO_H}`}
        style={{ position: 'absolute' }}
      >
        <Defs>
          <LinearGradient id="successBg" x1="0" y1="0" x2="0.4" y2="1">
            <Stop offset="0" stopColor="#D2F2E4" />
            <Stop offset="1" stopColor="#717C78" />
          </LinearGradient>
        </Defs>
        <Rect width={HERO_W} height={HERO_H} fill="url(#successBg)" />
      </Svg>
      <Animated.View
        entering={chipIn}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          borderRadius: 20,
          paddingHorizontal: 16,
          paddingVertical: 11,
          backgroundColor: 'rgba(255, 255, 255, 0.45)',
        }}
      >
        <View className="h-5 w-5 items-center justify-center rounded-full border border-ink">
          <Text className="text-[10px] font-sans-medium leading-[12px] text-ink">
            {name[0]}
          </Text>
        </View>
        <View className="gap-0.5">
          <Text className="text-[16px] font-sans-medium leading-[22px] text-ink">
            {name}
          </Text>
          <Text
            style={{ fontFamily: fonts.mono, color: colors.good }}
            className="text-[10px] uppercase leading-[12px] tracking-[0.5px]"
          >
            Connected
          </Text>
        </View>
      </Animated.View>
    </View>
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
      // while the chip springs in.
      successCelebration();
    }
  }, [celebrate]);

  return (
    <View className="flex-1 bg-scrim">
      {/* The dimmed area above the sheet skips straight home. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Skip to home"
        onPress={() => nav.reset({ name: 'home' })}
        className="flex-1"
      />
      <Animated.View
        entering={sheetIn}
        style={{ paddingHorizontal: 8, paddingBottom: 8 }}
      >
        {celebrate ? <StorySlides total={4} active={0} /> : <SheetHandle />}
        <View className="rounded-[29px] bg-grey p-5">
          <View className="flex-row items-start justify-between">
            <SheetCaption
              label={ok ? 'Success' : 'Error'}
              color={ok ? colors.good : colors.danger}
            />
            <BetaTag />
          </View>
          <View className="mt-2.5 pr-10">
            <SheetTitle>
              {already
                ? `${provider.name} is already connected`
                : ok
                  ? `Your ${provider.name} is connected successfully!`
                  : 'Connection failed'}
            </SheetTitle>
          </View>
          {ok ? (
            <Animated.View entering={enter(1)} style={{ marginTop: 16 }}>
              <ConnectedHero name={provider.name} />
            </Animated.View>
          ) : (
            <View className="mt-4">
              <SheetBody>
                {message ??
                  'Something went wrong while connecting. Please try again.'}
              </SheetBody>
            </View>
          )}
          {already ? (
            <View className="mt-4">
              <SheetBody>
                This device is already linked to your account and syncing. You
                can manage it from your profile.
              </SheetBody>
            </View>
          ) : null}
          <Animated.View entering={enter(2)} style={{ marginTop: 24 }}>
            {ok ? (
              <Button
                label={celebrate ? 'Next' : 'Done'}
                onPress={() =>
                  celebrate
                    ? nav.replace({ name: 'connectSync', provider })
                    : nav.reset({ name: 'home' })
                }
              />
            ) : (
              <View className="flex-row gap-2">
                <View className="flex-1">
                  <Button
                    label="Go back"
                    variant="outline"
                    onPress={nav.pop}
                  />
                </View>
                <View className="flex-1">
                  <Button
                    label="Retry"
                    onPress={() =>
                      nav.replace({ name: 'connectIntro', provider })
                    }
                  />
                </View>
              </View>
            )}
          </Animated.View>
        </View>
      </Animated.View>
    </View>
  );
}
