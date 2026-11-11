/**
 * PDF.js is loaded through this module so the app shell can mount even if the
 * engine fails. On Apple WebViews the worker is imported as a JS module (not a
 * `?url` asset) so it runs on the page thread and sets `globalThis.pdfjsWorker`.
 *
 * That makes PDF.js take its fake-worker path instead of
 * `new Worker(*.mjs, { type: "module" })`. WKWebView will not load a `.mjs`
 * module worker from Tauri's `tauri://` asset protocol (MIME / handshake),
 * which left v0.1.1 as a blank window when `App.tsx` imported PDF.js at the
 * top level. Linux WebKitGTK already runs a real worker in production, so
 * that path is kept.
 */
import * as pdfjs from "pdfjs-dist";
import { isAppleWebView } from "./platform";

export const ready = (async () => {
  if (isAppleWebView()) {
    await import("pdfjs-dist/build/pdf.worker.min.mjs");
    return;
  }
  const { default: workerSrc } = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
})();

export async function getDocument(data: Uint8Array): Promise<pdfjs.PDFDocumentLoadingTask> {
  await ready;
  return pdfjs.getDocument({ data });
}

export type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from "pdfjs-dist";
