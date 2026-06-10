import { Pressable, Text, View } from 'react-native';

interface Props {
  kind: 'warning' | 'error';
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function Banner({ kind, title, message, actionLabel, onAction }: Props) {
  const tint = kind === 'error' ? 'bg-[#FDEAE8]' : 'bg-[#FBF1DE]';
  const accent = kind === 'error' ? 'text-coral' : 'text-amber';
  return (
    <View className={`mb-3 rounded-2xl px-4 py-3 ${tint}`}>
      <Text className={`text-[13px] font-semibold ${accent}`}>{title}</Text>
      <Text className="mt-0.5 text-[13px] leading-[18px] text-ink">
        {message}
      </Text>
      {actionLabel && onAction ? (
        <Pressable onPress={onAction} className="mt-2 self-start">
          <Text className={`text-[13px] font-semibold underline ${accent}`}>
            {actionLabel}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
