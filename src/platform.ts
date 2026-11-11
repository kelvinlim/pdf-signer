/** WKWebView / Safari on Apple devices; not Linux WebKitGTK or Windows WebView2. */
export function isAppleWebView(ua = typeof navigator === "undefined" ? "" : navigator.userAgent): boolean {
  return /Mac|iP(hone|ad)/.test(ua);
}
