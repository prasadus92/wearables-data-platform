import { ActivityIndicator, Text } from 'react-native';

import { actionMedium, tapLight } from '../lib/haptics';
import { colors, fonts } from '../theme/tokens';
import { AnimatedPressable } from './AnimatedPressable';

type Variant = 'primary' | 'outline' | 'ghost' | 'light';

interface Props {
  label: string;
  onPress: () => void;
  variant?: Variant;
  disabled?: boolean;
  busy?: boolean;
}

// Figma button system: 50pt tall, 12pt corners, mono uppercase label.
// Outlined buttons carry the design's dark 1px outline.
const container: Record<Variant, string> = {
  primary: 'bg-ink',
  outline: 'border border-ink bg-transparent',
  ghost: 'bg-transparent',
  light: 'bg-card',
};

const labelCls: Record<Variant, string> = {
  primary: 'text-card',
  outline: 'text-ink',
  ghost: 'text-sub',
  light: 'text-ink',
};

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
  busy,
}: Props) {
  const inactive = disabled || busy;
  return (
    <AnimatedPressable
      accessibilityRole="button"
      onPress={() => {
        // Single home for button haptics: primary actions land with a
        // medium impact, secondary variants stay on the light tap.
        if (variant === 'primary') actionMedium();
        else tapLight();
        onPress();
      }}
      disabled={inactive}
      className={`h-[50px] flex-row items-center justify-center rounded-xl px-6 ${container[variant]} ${inactive ? 'opacity-50' : ''}`}
    >
      {busy ? (
        <ActivityIndicator
          color={variant === 'primary' ? colors.card : colors.ink}
        />
      ) : (
        <Text
          style={{ fontFamily: fonts.mono }}
          className={`text-[13px] uppercase tracking-[0.5px] ${labelCls[variant]}`}
        >
          {label}
        </Text>
      )}
    </AnimatedPressable>
  );
}
