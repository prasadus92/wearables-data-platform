// Shared API contract types (User, Device, Timeseries, ...) live in
// @youth/health-core; import them from there directly. Only shapes the
// mobile client alone consumes stay here.

/** Backend LinkOut: hosted Link URL the app opens in a browser/webview. */
export interface LinkOut {
  link_token: string;
  link_url: string;
}

/**
 * Single-use pairing code for the Apple Watch connect flow. The user types
 * it into the Vital Connect bridge app, which then streams Health data to
 * the account. Fields mirror the backend response and may be null when the
 * upstream omits them.
 */
export interface ApplePairingCode {
  code: string | null;
  expires_at: string | null;
}
