import * as Haptics from 'expo-haptics';
import { AccessibilityInfo } from 'react-native';

/**
 * Semantic haptic vocabulary. Single pulses map straight to the system
 * generators; composed patterns (celebration, heartbeat) collapse to one
 * pulse when the OS Reduce Motion setting is on, mirroring how motion.ts
 * gates animations. Every call is fire-and-forget and never throws.
 */

let reduceMotion = false;
AccessibilityInfo.isReduceMotionEnabled()
  .then((enabled) => {
    reduceMotion = enabled;
  })
  .catch(() => undefined);
AccessibilityInfo.addEventListener('reduceMotionChanged', (enabled) => {
  reduceMotion = enabled;
});

const swallow = () => undefined;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Selection changes: metric tabs, range chips, mode switch segments. */
export function tapLight(): void {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(swallow);
}

/** Primary button presses. */
export function actionMedium(): void {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(swallow);
}

/**
 * Success notification followed by two light afterglow taps ~120ms apart.
 * Under Reduce Motion only the success notification plays.
 */
export async function successCelebration(): Promise<void> {
  try {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    if (reduceMotion) return;
    await wait(120);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await wait(120);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  } catch {
    // haptics are best effort
  }
}

/**
 * Lub-dub: medium impact, 80ms gap, heavy impact. Under Reduce Motion a
 * single medium pulse stands in.
 */
export async function heartbeat(): Promise<void> {
  try {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (reduceMotion) return;
    await wait(80);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
  } catch {
    // haptics are best effort
  }
}
