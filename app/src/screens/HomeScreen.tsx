import { useCallback, useEffect, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from 'react-native';

import { api } from '../api/client';
import type { Device, TimeseriesOut } from '../api/types';
import { Banner } from '../components/Banner';
import { LineChart } from '../components/LineChart';
import { useApp } from '../lib/appContext';
import { METRICS, RANGES, providerName } from '../lib/catalog';
import { isOlderThan } from '../lib/format';
import { colors } from '../theme/tokens';

function Chip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className={`mr-2 rounded-full px-4 py-2 ${active ? 'bg-ink' : 'bg-card border border-line'}`}
    >
      <Text
        className={`text-[13px] font-semibold ${active ? 'text-card' : 'text-sub'}`}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function ConnectCard({
  hasSession,
  onConnect,
  onDismiss,
}: {
  hasSession: boolean;
  onConnect: () => void;
  onDismiss: () => void;
}) {
  return (
    <View className="mb-4 rounded-2xl bg-ink p-5">
      <Pressable
        accessibilityLabel="Dismiss"
        onPress={onDismiss}
        className="absolute right-3 top-3 h-8 w-8 items-center justify-center rounded-full active:opacity-60"
      >
        <Text className="text-[16px] text-[#8E8C88]">✕</Text>
      </Pressable>
      <Text className="pr-8 text-[17px] font-bold text-card">
        Connect your wearables for an enhanced experience
      </Text>
      <Text className="mt-1.5 text-[13px] leading-[19px] text-[#B9B7B2]">
        Sync your devices to unlock deeper health insights and keep your data
        up to date.
      </Text>
      <Pressable
        onPress={onConnect}
        className="mt-4 self-start rounded-full bg-card px-5 py-2.5 active:opacity-80"
      >
        <Text className="text-[12px] font-semibold uppercase tracking-[2px] text-ink">
          {hasSession ? 'Connect a device' : 'Get started'}
        </Text>
      </Pressable>
    </View>
  );
}

export function HomeScreen() {
  const { session, connectCardDismissed, dismissConnectCard, signOut, nav } =
    useApp();
  const [metric, setMetric] = useState(METRICS[0]);
  const [range, setRange] = useState(RANGES[1]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [series, setSeries] = useState<TimeseriesOut | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDevices = useCallback(async () => {
    if (!session) return;
    try {
      setDevices(await api.getDevices(session.userId));
    } catch {
      // banner state is best effort, keep last known devices
    }
  }, [session]);

  const loadSeries = useCallback(async () => {
    if (!session) {
      setSeries(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const end = new Date();
      const start = new Date(end.getTime() - range.hours * 3600 * 1000);
      setSeries(
        await api.getTimeseries(session.userId, metric.key, {
          start,
          end,
          resolution: range.resolution,
        }),
      );
    } catch {
      setError('Could not load data. Pull to refresh to retry.');
      setSeries(null);
    } finally {
      setLoading(false);
    }
  }, [session, metric, range]);

  useEffect(() => {
    loadDevices();
  }, [loadDevices]);

  useEffect(() => {
    loadSeries();
  }, [loadSeries]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      if (session) {
        // Pull-to-refresh asks the backend to pull fresh data from Aggregator.
        await api.syncUser(session.userId).catch(() => undefined);
      }
      await Promise.all([loadDevices(), loadSeries()]);
    } finally {
      setRefreshing(false);
    }
  }, [session, loadDevices, loadSeries]);

  const active = devices.filter((d) => d.status !== 'disconnected');
  const expired = active.filter((d) => d.status === 'expired');
  // A device that never delivered data only counts as stale once it has
  // been connected for over a day; brand new connections get grace time.
  const stale = active.filter(
    (d) =>
      d.status === 'connected' &&
      isOlderThan(d.last_data_at ?? d.connected_at, 24),
  );
  const showConnectCard =
    !connectCardDismissed && (!session || active.length === 0);

  return (
    <ScrollView
      className="flex-1 bg-paper"
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={colors.sub}
        />
      }
    >
      <View className="px-5 pb-28 pt-16">
        <View className="mb-5 flex-row items-center justify-between">
          <View>
            <Text className="text-[11px] font-semibold uppercase tracking-[2px] text-faint">
              Welcome back
            </Text>
            <Text className="text-[24px] font-bold text-ink">
              {session ? session.clientUserId : 'Guest'}
            </Text>
          </View>
          <Pressable
            accessibilityLabel="Profile and devices"
            onPress={() => nav.push({ name: 'devices' })}
            className="h-11 w-11 items-center justify-center rounded-full bg-ink active:opacity-80"
          >
            <Text className="text-[15px] font-bold text-card">
              {(session?.clientUserId[0] ?? 'G').toUpperCase()}
            </Text>
          </Pressable>
        </View>

        {expired.length > 0 ? (
          <Banner
            kind="error"
            title="Connection expired"
            message={`${expired.map((d) => providerName(d.provider)).join(', ')} needs to be reconnected to keep syncing.`}
            actionLabel="Reconnect"
            onAction={() => nav.push({ name: 'devices' })}
          />
        ) : null}

        {stale.length > 0 ? (
          <Banner
            kind="warning"
            title="Sync issues"
            message="We have not received data recently. Pull down to refresh or check the device's own app."
          />
        ) : null}

        {showConnectCard ? (
          <ConnectCard
            hasSession={!!session}
            onConnect={() =>
              session ? nav.push({ name: 'connectMenu' }) : signOut()
            }
            onDismiss={dismissConnectCard}
          />
        ) : null}

        <Text className="mb-3 mt-2 text-[18px] font-bold text-ink">
          Your biomarkers
        </Text>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          className="mb-3 -mx-5 px-5"
        >
          {METRICS.map((m) => (
            <Chip
              key={m.key}
              label={m.label}
              active={m.key === metric.key}
              onPress={() => setMetric(m)}
            />
          ))}
        </ScrollView>

        <View className="mb-4 flex-row">
          {RANGES.map((r) => (
            <Chip
              key={r.key}
              label={r.label}
              active={r.key === range.key}
              onPress={() => setRange(r)}
            />
          ))}
        </View>

        <View className="rounded-2xl bg-card p-4">
          <View className="flex-row items-baseline justify-between">
            <Text className="text-[15px] font-semibold text-ink">
              {metric.label}
            </Text>
            {metric.dual ? (
              <View className="flex-row items-center">
                <View className="mr-1.5 h-2 w-2 rounded-full bg-coral" />
                <Text className="mr-4 text-[12px] text-sub">Systolic</Text>
                <View className="mr-1.5 h-2 w-2 rounded-full bg-blue" />
                <Text className="text-[12px] text-sub">Diastolic</Text>
              </View>
            ) : null}
          </View>

          {error ? (
            <View className="h-[220px] items-center justify-center px-6">
              <Text className="text-center text-[13px] text-sub">{error}</Text>
            </View>
          ) : !session ? (
            <View className="h-[220px] items-center justify-center px-6">
              <Text className="text-center text-[13px] leading-[19px] text-sub">
                Create your profile and connect a wearable to see your data
                here.
              </Text>
            </View>
          ) : (
            <LineChart
              points={series?.points ?? []}
              unit={series?.unit ?? ''}
              dual={metric.dual}
              rangeHours={range.hours}
              loading={loading}
              emptyMessage={`No ${metric.label.toLowerCase()} data for this range yet. Connect a device or pull down to sync.`}
            />
          )}
        </View>
      </View>
    </ScrollView>
  );
}
