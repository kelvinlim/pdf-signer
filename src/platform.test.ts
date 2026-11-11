import { describe, expect, it } from "vitest";
import { isAppleWebView } from "./platform";

describe("isAppleWebView", () => {
  it("matches macOS WKWebView / Safari", () => {
    expect(
      isAppleWebView(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)",
      ),
    ).toBe(true);
  });

  it("does not match Linux WebKitGTK", () => {
    expect(
      isAppleWebView(
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
      ),
    ).toBe(false);
  });

  it("does not match Windows WebView2", () => {
    expect(
      isAppleWebView(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0",
      ),
    ).toBe(false);
  });
});
