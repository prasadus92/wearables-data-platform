import { Modal, Pressable, Text, View } from 'react-native';

import type { MetricMeta } from '@youth/health-core';

import { fonts } from '../theme/tokens';

interface Props {
  meta: MetricMeta;
  visible: boolean;
  onClose: () => void;
}

/**
 * Bottom card that explains the selected metric in plain language. Mirrors
 * the web dashboard's info popover, including the medical-advice footer.
 */
export function MetricInfoSheet({ meta, visible, onClose }: Props) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable
        accessibilityLabel="Close"
        onPress={onClose}
        className="flex-1 justify-end bg-black/40"
      >
        {/* Stop taps on the card itself from closing the sheet. */}
        <Pressable onPress={() => undefined}>
          <View className="rounded-t-[28px] bg-card px-6 pb-12 pt-5">
            <View className="mb-4 h-1 w-10 self-center rounded-full bg-line" />
            <Text className="text-[20px] font-sans-medium tracking-[-0.5px] text-ink">
              {meta.friendlyName}
            </Text>
            <Text className="mt-2 text-[14px] font-sans leading-[20px] text-mute">
              {meta.shortExplanation}
            </Text>
            <View className="mt-5 border-t border-mist pt-4">
              <Text
                style={{ fontFamily: fonts.mono }}
                className="text-[10px] uppercase tracking-[1px] text-mute"
              >
                Disclaimer
              </Text>
              <Text className="mt-1.5 text-[12px] font-sans leading-[17px] text-mute">
                This is informational, and no substitute for medical advice.
              </Text>
            </View>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
