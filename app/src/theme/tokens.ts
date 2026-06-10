import { Platform } from 'react-native';

// Raw design tokens for places Tailwind classes cannot reach (SVG, native props).
// Keep in sync with tailwind.config.js.
export const colors = {
  paper: '#F7F6F3',
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
  // ExampleHealth Figma palette: sheet surfaces, status accents and chrome.
  grey: '#F1F1F1',
  mist: '#F4F3F3',
  mute: '#8F8F8F',
  good: '#0ED187',
  attention: '#FF8811',
  danger: '#EC4444',
  disabledChip: '#DEDEDE',
  scrim: '#111111',
} as const;

// Brand faces, for places Tailwind classes cannot reach (native props,
// style objects). Headings use medium, body uses book; uppercase mono-style
// captions stay on the system mono on purpose.
export const fonts = {
  book: 'PPNeueMontreal',
  medium: 'PPNeueMontreal-Medium',
  mono: Platform.select({ ios: 'Menlo', default: 'monospace' }),
} as const;
