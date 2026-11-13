/**
 * Worker entry used both as:
 * - a real module worker on Linux/Windows (`?worker&url`), and
 * - a main-thread fake worker on Apple WKWebView (plain dynamic import).
 *
 * Polyfills run first so the worker bundle does not depend on engine builtins
 * that Safari 16.3 / older WebKitGTK lack.
 */
import "./pdfjs-polyfills";
import "pdfjs-dist/legacy/build/pdf.worker.min.mjs";
