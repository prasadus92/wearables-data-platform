import { useMemo, useState } from 'react';
import { Image, Text, View } from 'react-native';

import { colors, fonts } from '../theme/tokens';

/**
 * Official provider logos from the same CDN the API's device_meta.logo URLs
 * point at, keyed by provider slug. All four verified to serve 200.
 */
const STATIC_LOGOS: Record<string, string> = {
  oura: 'https://storage.googleapis.com/vital-assets/oura.png',
  whoop_v2: 'https://storage.googleapis.com/vital-assets/whoop.png',
  garmin: 'https://storage.googleapis.com/vital-assets/garmin.png',
  fitbit: 'https://storage.googleapis.com/vital-assets/fitbit.png',
};

/**
 * Provider brand mark. Tries the runtime device_meta.logo URL first when
 * given, then the static CDN logo for the slug; if every image fails to
 * load it falls back to the original bordered-circle initial glyph, so a
 * dead URL can never leave an empty hole in the row.
 */
export function ProviderLogo({
  slug,
  name,
  logoUrl,
  size = 20,
}: {
  slug: string;
  name: string;
  /** Runtime logo URL, e.g. device_meta.logo on a connected device. */
  logoUrl?: string | null;
  size?: number;
}) {
  const sources = useMemo(() => {
    const list: string[] = [];
    if (logoUrl) list.push(logoUrl);
    const fallback = STATIC_LOGOS[slug];
    if (fallback && fallback !== logoUrl) list.push(fallback);
    return list;
  }, [logoUrl, slug]);
  const [failures, setFailures] = useState(0);
  const uri = sources[failures];

  if (!uri) {
    return (
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: 1,
          borderColor: colors.ink,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text
          style={{
            fontFamily: fonts.medium,
            fontSize: size * 0.5,
            lineHeight: size * 0.6,
            color: colors.ink,
          }}
        >
          {name[0]}
        </Text>
      </View>
    );
  }

  return (
    <Image
      source={{ uri }}
      onError={() => setFailures((n) => n + 1)}
      style={{ width: size, height: size }}
      resizeMode="contain"
      accessibilityIgnoresInvertColors
    />
  );
}

/** Reads a usable logo URL out of a device's metadata, when present. */
export function deviceLogoUrl(
  meta: Record<string, unknown> | null,
): string | null {
  const logo = meta?.logo;
  return typeof logo === 'string' && logo.length > 0 ? logo : null;
}
