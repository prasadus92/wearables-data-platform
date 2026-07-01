import { ConfigContext, ExpoConfig } from 'expo/config';

// Secrets come from the environment (Expo CLI loads app/.env automatically).
// Never commit real tokens; see README for setup.
export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Wearables',
  slug: config.slug ?? 'app',
  scheme: 'wearables',
  extra: {
    ...config.extra,
    apiBaseUrl: process.env.API_BASE_URL ?? 'https://api.wearables.example.com',
    apiKey: process.env.API_AUTH_TOKEN ?? '',
  },
});
