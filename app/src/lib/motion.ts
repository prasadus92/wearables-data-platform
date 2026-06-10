import { FadeInDown, ReduceMotion } from 'react-native-reanimated';

/**
 * Shared motion vocabulary. Entering animations are spring-based and short;
 * `enter(i)` staggers sibling blocks by ~70ms so screens build top to bottom.
 * Every config opts into ReduceMotion.System so the OS accessibility setting
 * disables motion app-wide.
 */
export const enter = (index = 0) =>
  FadeInDown.springify(320)
    .delay(index * 70)
    .reduceMotion(ReduceMotion.System);

/** Snappy spring for press feedback and small indicator moves. */
export const pressSpring = {
  damping: 20,
  stiffness: 350,
  reduceMotion: ReduceMotion.System,
} as const;
