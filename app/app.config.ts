import { ConfigContext, ExpoConfig } from 'expo/config';

// Secrets come from the environment (Expo CLI loads app/.env automatically).
// Never commit real tokens; see README for setup.
export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'YOU(th)',
  slug: config.slug ?? 'app',
  scheme: 'youthwearables',
  extra: {
    ...config.extra,
    apiBaseUrl: process.env.API_BASE_URL ?? 'https://api.youth.luminik.io',
    apiKey: process.env.API_AUTH_TOKEN ?? '',
  },
});
