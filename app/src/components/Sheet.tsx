import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated, {
  FadeIn,
  FadeOut,
  ReduceMotion,
  SlideInDown,
  SlideOutDown,
} from 'react-native-reanimated';

import { colors, fonts } from '../theme/tokens';

/**
 * Visual primitives for the YOU(th) bottom-sheet language: every connect,
 * sync and confirm surface in the design is a white (or light grey) panel
 * with 29pt corners, a small grab handle, a mono caption, a 24pt Medium
 * title and a muted 16pt body. Screens compose these pieces; the modal
 * variant (SheetModal) overlays the current screen for confirm dialogs.
 */

export const sheetIn = SlideInDown.springify()
  .damping(26)
  .stiffness(240)
  .reduceMotion(ReduceMotion.System);

export const sheetOut = SlideOutDown.duration(200).reduceMotion(
  ReduceMotion.System,
);

/** The 26pt grab handle above the panel. */
export function SheetHandle() {
  return (
    <View className="mb-1.5 h-[4px] w-[26px] self-center rounded-full bg-card" />
  );
}

/** Mono uppercase kicker: SUCCESS, ATTENTION, ERROR, DISCLAIMER. */
export function SheetCaption({
  label,
  color = colors.mute,
}: {
  label: string;
  color?: string;
}) {
  return (
    <Text
      style={{ fontFamily: fonts.mono, color }}
      className="text-[12px] uppercase tracking-[0.5px]"
    >
      {label}
    </Text>
  );
}

export function SheetTitle({ children }: { children: ReactNode }) {
  return (
    <Text className="text-[24px] font-sans-medium leading-[30px] tracking-[-0.4px] text-ink">
      {children}
    </Text>
  );
}

export function SheetBody({ children }: { children: ReactNode }) {
  return (
    <Text className="text-[16px] font-sans leading-[22px] text-mute">
      {children}
    </Text>
  );
}

/** The small BETA tag pinned to the sheet's top right corner. */
export function BetaTag() {
  return (
    <View
      className="items-center justify-center rounded-[7px] p-2"
      style={{ backgroundColor: colors.disabledChip }}
    >
      <Text
        style={{ fontFamily: fonts.mono }}
        className="text-[10px] uppercase leading-[10px] text-ink"
      >
        Beta
      </Text>
    </View>
  );
}

/** Story-style progress segments shown above the syncing sheets. */
export function StorySlides({
  total,
  active,
}: {
  total: number;
  active: number;
}) {
  return (
    <View className="h-12 w-full flex-row items-center gap-2 py-1 pr-2">
      {Array.from({ length: total }, (_, i) => (
        <View
          key={i}
          className="h-[3px] flex-1 rounded-full bg-card"
          style={{ opacity: i === active ? 1 : 0.21 }}
        />
      ))}
    </View>
  );
}

/**
 * Modal bottom sheet for confirm dialogs: dimmed backdrop plus a reanimated
 * slide-up panel. Backdrop taps dismiss when `onDismiss` is given. Plain
 * components only, no extra dependencies.
 */
export function SheetModal({
  visible,
  onDismiss,
  children,
}: {
  visible: boolean;
  onDismiss?: () => void;
  children: ReactNode;
}) {
  if (!visible) return null;
  return (
    <View
      className="absolute inset-0 justify-end"
      // The dialog must sit above every sibling, including charts.
      style={{ zIndex: 40, elevation: 40 }}
    >
      <Animated.View
        entering={FadeIn.duration(180).reduceMotion(ReduceMotion.System)}
        exiting={FadeOut.duration(150).reduceMotion(ReduceMotion.System)}
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: 0,
          right: 0,
          backgroundColor: 'rgba(17, 17, 17, 0.55)',
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
          onPress={onDismiss}
          disabled={!onDismiss}
          className="flex-1"
        />
      </Animated.View>
      <Animated.View
        entering={sheetIn}
        exiting={sheetOut}
        style={{ paddingHorizontal: 8, paddingBottom: 8 }}
      >
        <SheetHandle />
        <View className="rounded-[29px] border border-mist bg-card p-5">
          {children}
        </View>
      </Animated.View>
    </View>
  );
}
