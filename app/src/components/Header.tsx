import { Pressable, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { colors } from '../theme/tokens';

interface Props {
  title: string;
  onBack?: () => void;
}

export function Header({ title, onBack }: Props) {
  return (
    <View className="flex-row items-center px-5 pb-3 pt-2">
      {onBack ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={onBack}
          className="-ml-2 mr-2 h-10 w-10 items-center justify-center rounded-full active:opacity-60"
        >
          <Svg width={20} height={20} viewBox="0 0 20 20" fill="none">
            <Path
              d="M12.5 4L6.5 10L12.5 16"
              stroke={colors.ink}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
        </Pressable>
      ) : null}
      <Text className="text-[22px] font-bold text-ink">{title}</Text>
    </View>
  );
}
