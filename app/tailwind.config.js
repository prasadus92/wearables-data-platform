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
      },
    },
  },
  plugins: [],
};
