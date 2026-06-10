import { ActivityIndicator, Text } from 'react-native';

import { colors } from '../theme/tokens';
import { AnimatedPressable } from './AnimatedPressable';

type Variant = 'primary' | 'outline' | 'ghost' | 'light';

interface Props {
  label: string;
  onPress: () => void;
  variant?: Variant;
  disabled?: boolean;
  busy?: boolean;
}

const container: Record<Variant, string> = {
  primary: 'bg-ink',
  outline: 'border border-line bg-transparent',
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
      onPress={onPress}
      disabled={inactive}
      className={`h-14 flex-row items-center justify-center rounded-full px-6 ${container[variant]} ${inactive ? 'opacity-50' : ''}`}
    >
      {busy ? (
        <ActivityIndicator
          color={variant === 'primary' ? colors.card : colors.ink}
        />
      ) : (
        <Text
          className={`text-[13px] font-semibold uppercase tracking-[2px] ${labelCls[variant]}`}
        >
          {label}
        </Text>
      )}
    </AnimatedPressable>
  );
}
