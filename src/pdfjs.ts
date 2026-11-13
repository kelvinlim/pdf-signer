/**
 * PDF.js is loaded through this module so the app shell can mount even if the
 * engine fails. We always use the *legacy* build (Babel + core-js for Safari
 * 16.4) and run extra polyfills first so WKWebView ≈ Safari 16.3 can evaluate
 * the engine. The modern `pdfjs-dist` build needs ES2025 `Iterator` (Safari
 * 18.4+) and was the v0.1.2 macOS failure.
 *
 * On Apple WebViews the worker is imported as a JS module (not a `?url`
 * asset) so it runs on the page thread and sets `globalThis.pdfjsWorker`.
 * That makes PDF.js take its fake-worker path instead of
 * `new Worker(*.mjs, { type: "module" })`. WKWebView will not load a `.mjs`
 * module worker from Tauri's `tauri://` asset protocol (MIME / handshake).
 *
 * Linux WebKitGTK and Windows WebView2 keep a real worker; the worker entry
 * (`pdfjs-worker.ts`) prepends the same polyfills so the worker thread is
 * not missing Iterator / Promise.withResolvers / AbortSignal.any either.
 */
import "./pdfjs-polyfills";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { isAppleWebView } from "./platform";

export const ready = (async () => {
  if (isAppleWebView()) {
    await import("./pdfjs-worker");
    return;
  }
  const { default: workerSrc } = await import("./pdfjs-worker?worker&url");
  pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
})();

export async function getDocument(data: Uint8Array): Promise<pdfjs.PDFDocumentLoadingTask> {
  await ready;
  return pdfjs.getDocument({ data });
}

export type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from "pdfjs-dist";
