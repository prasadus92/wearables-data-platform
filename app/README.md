# ExampleHealth Mobile App

Expo (React Native + TypeScript) client for the ExampleHealth wearables platform.
It connects wearables (Oura, WHOOP, Garmin, Fitbit) through Aggregator's hosted
OAuth flow and charts biomarker timelines served by the backend API.

## Configuration

The app reads its API credentials from the environment at config time
(`app.config.ts`). Create `app/.env` (gitignored) with:

```
API_AUTH_TOKEN=<the backend API_AUTH_TOKEN>
# Optional, defaults to https://api.examplehealth.example.com
# API_BASE_URL=http://localhost:8000
```

The token is the same `API_AUTH_TOKEN` value used by the backend (see the
repository root `.env`). It is sent as the `X-API-Key` header on every `/v1`
request. Never commit the real token.

## Run

```
cd app
npm install
npx expo start
```

Then press `i` for the iOS simulator, `a` for Android, or scan the QR code
with Expo Go on a physical device.

Notes:
- Pull-to-refresh on the home screen triggers a backend sync
  (`POST /v1/users/{id}/sync`) before refetching data.
- The OAuth connect flow opens Aggregator's hosted link page via
  `expo-web-browser` and returns through the `examplehealth://` scheme
  (Expo Go uses its own `exp://` scheme automatically).
- In sandbox mode, Oura and Fitbit offer a "Use demo data" shortcut that
  seeds 30 days of synthetic data without a real device.

## Screens

- Welcome (onboarding): explains wearable sync, asks for a user id, creates
  the user via `POST /v1/users` and persists the session. "Not now" enters
  the app as a guest; the home feed then shows a dismissible reminder card.
- Home: biomarker timeline with metric tabs (Heart Rate, HRV, SpO2, Resp
  Rate, Blood Pressure) and range chips (24h/7d/30d/90d). Blood pressure
  plots systolic and diastolic as two lines. Banners appear when a
  connection has expired or a connected device has not delivered data in
  over 24 hours.
- Connect menu: providers not yet connected, with status labels. Tapping one
  opens an intro screen describing the data we read, then the hosted OAuth
  page. A success or failure screen confirms the outcome.
- Profile / devices: connected and expired devices with last-synced time,
  reconnect for expired connections, and disconnect with confirmation.
  Disconnected providers reappear in the connect menu.

## Stack

- Expo SDK 56, React Native 0.85, TypeScript (strict)
- NativeWind v4 (Tailwind for RN) with raw tokens in `src/theme/tokens.ts`
  for SVG and native props
- Hand-rolled SVG line chart (`react-native-svg`), no chart libraries
- Tiny state-based stack navigator in `App.tsx` (no router dependency)
- `@react-native-async-storage/async-storage` for session and UI persistence

## Quality checks

```
npx tsc --noEmit          # typecheck
npx expo export --platform ios   # validate the production bundle
```
