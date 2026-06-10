import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import Svg, { Path, Rect } from 'react-native-svg';

import { Button } from '../components/Button';
import {
  BetaTag,
  SheetCaption,
  SheetTitle,
  StorySlides,
  sheetIn,
} from '../components/Sheet';
import { useApp } from '../lib/appContext';
import { METRICS, type ProviderInfo } from '../lib/catalog';
import { enter } from '../lib/motion';
import { colors, fonts } from '../theme/tokens';

/**
 * Post-success syncing story (pages 2 to 4 of the connect flow; the success
 * sheet is page 1). Each page is skippable via its own button or by tapping
 * the dimmed area above the sheet. The biomarker list and count come from
 * the shared metric metadata in @youth/health-core via the catalog.
 */

/** White biomarker pill row, as on the "We are syncing" page. */
function BiomarkerRow({ label }: { label: string }) {
  return (
    <View className="w-full rounded-2xl border border-card bg-card px-4 py-4">
      <Text className="text-[16px] font-sans-medium leading-[22px] text-ink">
        {label}
      </Text>
    </View>
  );
}

/** A biomarker card with a synced chip, used in the stacked carousel. */
function SyncedCard({
  label,
  emphasis,
}: {
  label: string;
  /** 1 is the front card; smaller values recede into the stack. */
  emphasis: number;
}) {
  return (
    <View
      className="w-full flex-row items-center justify-between rounded-2xl bg-card px-4 py-4"
      style={{
        opacity: 0.15 + emphasis * 0.85,
        transform: [{ scale: 0.86 + emphasis * 0.14 }],
      }}
    >
      <Text className="text-[16px] font-sans-medium leading-[22px] text-ink">
        {label}
      </Text>
      <View className="flex-row items-center gap-1.5">
        <View
          className="h-3 w-[5px] rounded-full"
          style={{ backgroundColor: colors.good }}
        />
        <Text className="text-[13px] font-sans text-ink">Synced</Text>
      </View>
    </View>
  );
}

/** Mini chart preview standing in for the data-section screenshot. */
function DataPreview() {
  return (
    <View className="w-full items-center overflow-hidden rounded-3xl bg-[#E7E7E7] px-6 py-6">
      <View className="w-full max-w-[280px] rounded-2xl bg-card p-4">
        <Text
          style={{ fontFamily: fonts.mono }}
          className="text-[10px] uppercase tracking-[0.5px] text-mute"
        >
          Cardiovascular
        </Text>
        <View className="mt-1 flex-row items-center gap-2">
          <Text className="text-[22px] font-sans-medium text-ink">HRV</Text>
          <View className="rounded-md bg-grey px-2 py-1">
            <Text
              style={{ fontFamily: fonts.mono }}
              className="text-[9px] uppercase tracking-[0.5px] text-sub"
            >
              Wearable
            </Text>
          </View>
        </View>
        <Svg
          width="100%"
          height={96}
          viewBox="0 0 240 96"
          style={{ marginTop: 10 }}
        >
          <Rect x={0} y={30} width={240} height={56} rx={6} fill="#BDEFD9" />
          <Path
            d="M4 40 L40 30 L78 52 L116 70 L156 64 L198 60 L236 58"
            stroke={colors.ink}
            strokeWidth={2}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Svg>
      </View>
    </View>
  );
}

interface Props {
  provider: ProviderInfo;
}

export function ConnectSyncScreen(_props: Props) {
  const { nav } = useApp();
  const [page, setPage] = useState(0);

  const goHome = () => nav.reset({ name: 'home' });
  const goDevices = () => {
    nav.reset({ name: 'home' });
    nav.push({ name: 'devices' });
  };

  const count = METRICS.length;
  const titles = [
    `We are syncing ${count} biomarkers`,
    'The full sync can take up to 5 minutes',
    'You can check the biomarkers in the data section',
  ];

  // The carousel page centers one card; neighbors recede into the stack.
  const stack = METRICS.slice(0, 5);
  const mid = Math.floor(stack.length / 2);

  return (
    <View className="flex-1 bg-scrim">
      {/* The dimmed area above the sheet skips straight home. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Skip to home"
        onPress={goHome}
        className="flex-1"
      />
      <Animated.View
        entering={sheetIn}
        style={{ paddingHorizontal: 8, paddingBottom: 8 }}
      >
        <StorySlides total={4} active={page + 1} />
        <View className="rounded-[29px] bg-grey p-5">
          <View className="flex-row items-start justify-between">
            <SheetCaption label="Success" color={colors.good} />
            <BetaTag />
          </View>
          {/* Re-keyed per page so each page builds in like a story slide. */}
          <Animated.View key={page} entering={enter(0)}>
            <View className="mt-2.5 pr-10">
              <SheetTitle>{titles[page]}</SheetTitle>
            </View>

            {page === 0 ? (
              <View className="mt-4 gap-3">
                {METRICS.map((m) => (
                  <BiomarkerRow key={m.key} label={m.label} />
                ))}
              </View>
            ) : null}

            {page === 1 ? (
              <View className="mt-4 items-center gap-2 overflow-hidden rounded-3xl bg-[#E7E7E7] px-6 py-8">
                {stack.map((m, i) => (
                  <SyncedCard
                    key={m.key}
                    label={m.label}
                    emphasis={1 - Math.abs(i - mid) / (mid + 1)}
                  />
                ))}
              </View>
            ) : null}

            {page === 2 ? (
              <View className="mt-4">
                <DataPreview />
              </View>
            ) : null}

            <View className="mt-6">
              {page < 2 ? (
                <Button label="Next" onPress={() => setPage(page + 1)} />
              ) : (
                <View className="flex-row gap-2">
                  <View className="flex-1">
                    <Button
                      label="My devices"
                      variant="outline"
                      onPress={goDevices}
                    />
                  </View>
                  <View className="flex-1">
                    <Button label="Continue" onPress={goHome} />
                  </View>
                </View>
              )}
            </View>
          </Animated.View>
        </View>
      </Animated.View>
    </View>
  );
}
