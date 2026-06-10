import { Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { Button } from '../components/Button';
import { useApp } from '../lib/appContext';
import type { ProviderInfo } from '../lib/catalog';
import { colors } from '../theme/tokens';

function ResultMark({ ok }: { ok: boolean }) {
  return (
    <Svg width={88} height={88} viewBox="0 0 88 88" fill="none">
      <Circle
        cx={44}
        cy={44}
        r={42}
        fill={ok ? colors.leafSoft : colors.coralSoft}
      />
      {ok ? (
        <Path
          d="M28 45.5L39.5 57L61 33"
          stroke={colors.leaf}
          strokeWidth={5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : (
        <Path
          d="M31 31L57 57M57 31L31 57"
          stroke={colors.coral}
          strokeWidth={5}
          strokeLinecap="round"
        />
      )}
    </Svg>
  );
}

interface Props {
  provider: ProviderInfo;
  ok: boolean;
  message?: string;
}

export function ConnectResultScreen({ provider, ok, message }: Props) {
  const { nav } = useApp();

  return (
    <View className="flex-1 bg-paper px-6 pt-14">
      <View className="flex-1 items-center justify-center">
        <ResultMark ok={ok} />
        <Text className="mt-7 text-center text-[24px] font-bold text-ink">
          {ok ? `${provider.name} connected` : 'Connection failed'}
        </Text>
        <Text className="mt-2.5 max-w-[300px] text-center text-[14px] leading-[20px] text-sub">
          {ok
            ? 'Your data will start appearing on the timeline shortly. Pull down on the home screen to sync.'
            : (message ??
              'Something went wrong while connecting. Please try again.')}
        </Text>
      </View>
      <View className="pb-12">
        {ok ? (
          <Button label="Done" onPress={() => nav.reset({ name: 'home' })} />
        ) : (
          <>
            <Button
              label="Try again"
              onPress={() => nav.replace({ name: 'connectIntro', provider })}
            />
            <View className="h-3" />
            <Button
              label="Choose another device"
              variant="outline"
              onPress={nav.pop}
            />
          </>
        )}
      </View>
    </View>
  );
}
