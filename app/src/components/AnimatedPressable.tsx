import type { ComponentProps } from 'react';
import { Pressable, type PressableProps } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { pressSpring } from '../lib/motion';

type AnimatedViewProps = ComponentProps<typeof Animated.View>;

interface Props extends PressableProps {
  /** Scale applied while pressed. Defaults to a subtle 0.97. */
  pressedScale?: number;
  /** Optional entering animation for the wrapping view. */
  entering?: AnimatedViewProps['entering'];
  /** Optional layout transition for the wrapping view. */
  layout?: AnimatedViewProps['layout'];
}

/**
 * Pressable with physical press feedback: springs to `pressedScale` on
 * press-in and back on release. NativeWind classes go on the inner Pressable
 * as usual; the animated wrapper carries only the transform.
 */
export function AnimatedPressable({
  pressedScale = 0.97,
  entering,
  layout,
  onPressIn,
  onPressOut,
  ...rest
}: Props) {
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <Animated.View entering={entering} layout={layout} style={animatedStyle}>
      <Pressable
        {...rest}
        onPressIn={(event) => {
          scale.value = withSpring(pressedScale, pressSpring);
          onPressIn?.(event);
        }}
        onPressOut={(event) => {
          scale.value = withSpring(1, pressSpring);
          onPressOut?.(event);
        }}
      />
    </Animated.View>
  );
}
