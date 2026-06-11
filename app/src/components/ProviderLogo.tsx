import { useMemo, useState } from 'react';
import { Image, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { APPLE_SLUG } from '../lib/catalog';
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
 * Apple mark drawn locally in the SF-symbol style: the CDN has no logo
 * asset for apple_health_kit, so this glyph is the permanent mark rather
 * than a fallback.
 */
function AppleGlyph({ size }: { size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 814 1000">
      <Path
        fill={colors.ink}
        d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76.5 0-103.7 40.8-165.9 40.8s-105.6-57-155.5-127C46.7 790.7 0 663 0 541.8c0-194.4 126.4-297.5 250.8-297.5 66.1 0 121.2 43.4 162.7 43.4 39.5 0 101.1-46 176.3-46 28.5 0 130.9 2.6 198.3 99.2zm-234-181.5c31.1-36.9 53.1-88.1 53.1-139.3 0-7.1-.6-14.3-1.9-20.1-50.6 1.9-110.8 33.7-147.1 75.8-28.5 32.4-55.1 83.6-55.1 135.5 0 7.8 1.3 15.6 1.9 18.1 3.2.6 8.4 1.3 13.6 1.3 45.4 0 102.5-30.4 135.5-71.3z"
      />
    </Svg>
  );
}

/**
 * Provider brand mark. Tries the runtime device_meta.logo URL first when
 * given, then the static CDN logo for the slug; if every image fails to
 * load it falls back to the original bordered-circle initial glyph, so a
 * dead URL can never leave an empty hole in the row. Apple Watch always
 * renders the local Apple glyph.
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

  if (slug === APPLE_SLUG) {
    return <AppleGlyph size={size} />;
  }

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
