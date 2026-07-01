/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./App.tsx', './src/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      fontFamily: {
        // Brand faces loaded via expo-font in App.tsx. `font-sans` is the
        // body face (Book); `font-sans-medium` carries headings and emphasis.
        sans: ['PPNeueMontreal'],
        'sans-medium': ['PPNeueMontreal-Medium'],
      },
      colors: {
        paper: '#F7F6F3',
        ink: '#1C1C1E',
        sub: '#6B6A66',
        faint: '#9C9A94',
        coral: '#E8554D',
        blue: '#4D7CE8',
        leaf: '#1E7E3E',
        amber: '#B7791F',
        card: '#FFFFFF',
        line: '#E8E6E1',
        // UI palette: sheet surfaces, status accents and chrome.
        grey: '#F1F1F1',
        mist: '#F4F3F3',
        mute: '#8F8F8F',
        good: '#0ED187',
        attention: '#FF8811',
        danger: '#EC4444',
        scrim: '#111111',
      },
    },
  },
  plugins: [],
};
