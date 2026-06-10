// Shared API contract types (User, Device, Timeseries, ...) live in
// @examplehealth/health-core; import them from there directly. Only shapes the
// mobile client alone consumes stay here.

/** Backend LinkOut: hosted Link URL the app opens in a browser/webview. */
export interface LinkOut {
  link_token: string;
  link_url: string;
}
