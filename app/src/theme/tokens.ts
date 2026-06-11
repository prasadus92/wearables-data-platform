import { Platform } from 'react-native';

// Raw design tokens for places Tailwind classes cannot reach (SVG, native props).
// Keep in sync with tailwind.config.js.
export const colors = {
  paper: '#F7F6F3',
  // Brand cream from the light Figma screens; the light home backdrop.
  cream: '#F4F1EC',
  ink: '#1C1C1E',
  sub: '#6B6A66',
  faint: '#9C9A94',
  coral: '#E8554D',
  blue: '#4D7CE8',
  leaf: '#1E7E3E',
  amber: '#B7791F',
  amberSoft: '#FBF1DE',
  coralSoft: '#FDEAE8',
  leafSoft: '#E5F2E8',
  card: '#FFFFFF',
  line: '#E8E6E1',
  inkSoft: '#2C2C2E',
  // YOU(th) Figma palette: sheet surfaces, status accents and chrome.
  grey: '#F1F1F1',
  mist: '#F4F3F3',
  mute: '#8F8F8F',
  good: '#0ED187',
  attention: '#FF8811',
  danger: '#EC4444',
  disabledChip: '#DEDEDE',
  scrim: '#111111',
  // Figma dark home: warm backdrop tones and the teal biomarkers card.
  pink: '#F54EF0',
  night: '#121111',
  emberDeep: '#2B1410',
  emberMid: '#1A100D',
  emberGlow: '#8A4A22',
  tealTop: '#176058',
  tealBottom: '#0B3534',
} as const;

// Brand faces, for places Tailwind classes cannot reach (native props,
// style objects). Headings use medium, body uses book; uppercase mono-style
// captions stay on the system mono on purpose.
export const fonts = {
  book: 'PPNeueMontreal',
  medium: 'PPNeueMontreal-Medium',
  mono: Platform.select({ ios: 'Menlo', default: 'monospace' }),
} as const;

/** Appearance preference: follow the OS, or force one look. */
export type AppearancePref = 'system' | 'light' | 'dark';
/** The preference after resolving 'system' against the OS scheme. */
export type ResolvedTheme = 'light' | 'dark';

export interface HomePalette {
  /** Screen background behind everything. */
  bg: string;
  /** Primary type: greeting name, headings, wordmark. */
  text: string;
  /** Mono caption above the greeting. */
  caption: string;
  /** Secondary copy: card subtitles. */
  dim: string;
  /** Quietest copy: the disclaimer block. */
  faint: string;
  refreshTint: string;
  infoIcon: string;
  closeIcon: string;
  chipActiveBg: string;
  chipActiveText: string;
  chipInactiveBg: string;
  chipInactiveBorder: string;
  chipInactiveText: string;
  cardBg: string;
  cardBorder: string;
  cardBody: string;
  cardButtonBg: string;
  cardButtonText: string;
  skeletonBg: string;
  skeletonBorder: string;
  skeletonTile: string;
  skeletonLine: string;
  bannerBody: string;
  bannerButtonBg: string;
  bannerButtonText: string;
  bannerDismissBg: string;
  avatarBg: string;
  avatarBorder: string;
  avatarText: string;
}

/**
 * Home screen chrome colors per resolved theme. Dark keeps the Figma warm
 * ember backdrop values verbatim; light moves the same layout onto the
 * brand cream with ink type. The teal biomarkers card keeps its own dark
 * palette inside LineChart in both themes, so nothing here touches it.
 */
export const homePalette: Record<ResolvedTheme, HomePalette> = {
  dark: {
    bg: colors.night,
    text: '#FFFFFF',
    caption: '#FFFFFF',
    dim: 'rgba(255, 255, 255, 0.5)',
    faint: 'rgba(255, 255, 255, 0.5)',
    refreshTint: '#FFFFFF',
    infoIcon: 'rgba(255, 255, 255, 0.6)',
    closeIcon: 'rgba(255, 255, 255, 0.7)',
    chipActiveBg: colors.card,
    chipActiveText: colors.ink,
    chipInactiveBg: 'rgba(255, 255, 255, 0.08)',
    chipInactiveBorder: 'rgba(255, 255, 255, 0.16)',
    chipInactiveText: 'rgba(255, 255, 255, 0.72)',
    cardBg: 'rgba(27, 27, 27, 0.3)',
    cardBorder: 'rgba(255, 255, 255, 0.45)',
    cardBody: 'rgba(255, 255, 255, 0.5)',
    cardButtonBg: 'rgba(255, 255, 255, 0.13)',
    cardButtonText: '#FFFFFF',
    skeletonBg: 'rgba(27, 27, 27, 0.3)',
    skeletonBorder: 'rgba(255, 255, 255, 0.2)',
    skeletonTile: 'rgba(255, 255, 255, 0.12)',
    skeletonLine: 'rgba(255, 255, 255, 0.08)',
    bannerBody: '#DEDEDE',
    bannerButtonBg: '#FFFFFF',
    bannerButtonText: colors.ink,
    bannerDismissBg: 'rgba(255, 255, 255, 0.1)',
    avatarBg: 'rgba(254, 213, 180, 0.33)',
    avatarBorder: '#FFFFFF',
    avatarText: '#FFE2CE',
  },
  light: {
    bg: colors.cream,
    text: colors.ink,
    caption: colors.sub,
    dim: colors.sub,
    faint: colors.faint,
    refreshTint: colors.coral,
    infoIcon: 'rgba(28, 28, 30, 0.55)',
    closeIcon: 'rgba(28, 28, 30, 0.6)',
    chipActiveBg: colors.ink,
    chipActiveText: '#FFFFFF',
    chipInactiveBg: colors.card,
    chipInactiveBorder: colors.line,
    chipInactiveText: colors.sub,
    cardBg: colors.card,
    cardBorder: colors.line,
    cardBody: colors.sub,
    cardButtonBg: colors.ink,
    cardButtonText: '#FFFFFF',
    skeletonBg: colors.card,
    skeletonBorder: colors.line,
    skeletonTile: '#ECEAE5',
    skeletonLine: '#F1EFEA',
    bannerBody: colors.sub,
    bannerButtonBg: colors.ink,
    bannerButtonText: '#FFFFFF',
    bannerDismissBg: 'rgba(28, 28, 30, 0.07)',
    avatarBg: '#FCE4D4',
    avatarBorder: 'rgba(28, 28, 30, 0.25)',
    avatarText: '#A04A1F',
  },
};
