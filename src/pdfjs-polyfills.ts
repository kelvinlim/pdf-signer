/**
 * Runtime shims for WKWebView ≈ Safari 16.3 (macOS 13.2 Ventura) and the
 * PDF.js worker (real worker on Linux/Windows, fake worker on Apple).
 *
 * pdfjs-dist 5.4's legacy build already polyfills to Safari 16.4, but:
 * - the reported failure is `Can't find variable: Iterator` (ES2025 helpers,
 *   Safari 18.4+), so we install those globals before PDF.js evaluates
 * - Safari 16.3 is slightly behind 16.4 (Promise.withResolvers is 17.4,
 *   AbortSignal.any is 17.4, Array.fromAsync / Set methods are later)
 * - the worker entry imports this file first so Linux/Windows real workers
 *   get the same shims as the Apple main-thread fake-worker path
 */
import "core-js/actual/array/from-async";
import "core-js/actual/array/find-last";
import "core-js/actual/array/find-last-index";
import "core-js/actual/array/to-sorted";
import "core-js/actual/array/to-reversed";
import "core-js/actual/array/to-spliced";
import "core-js/actual/iterator";
import "core-js/actual/map/group-by";
import "core-js/actual/object/group-by";
import "core-js/actual/promise/try";
import "core-js/actual/promise/with-resolvers";
import "core-js/actual/set/difference";
import "core-js/actual/set/intersection";
import "core-js/actual/set/is-disjoint-from";
import "core-js/actual/set/is-subset-of";
import "core-js/actual/set/is-superset-of";
import "core-js/actual/set/symmetric-difference";
import "core-js/actual/set/union";
import "core-js/actual/structured-clone";

/** AbortSignal.any is Safari 17.4+; PDF.js uses it for cancellation. */
const AbortSignalAny = AbortSignal as typeof AbortSignal & {
  any?: (signals: AbortSignal[]) => AbortSignal;
};
if (typeof AbortSignal !== "undefined" && typeof AbortSignalAny.any !== "function") {
  AbortSignalAny.any = function any(signals: AbortSignal[]): AbortSignal {
    const controller = new AbortController();
    for (const signal of signals) {
      if (signal.aborted) {
        controller.abort(signal.reason);
        return controller.signal;
      }
      signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
    }
    return controller.signal;
  };
}

/**
 * Safari's ReadableStream has no async iterator until a very recent release.
 * PDF.js `getTextContent()` uses `for await`, so install a reader-based shim.
 */
type AsyncIterableStream = ReadableStream & {
  [Symbol.asyncIterator]?: () => AsyncGenerator<unknown>;
};
const streamProto =
  typeof ReadableStream !== "undefined" ? (ReadableStream.prototype as AsyncIterableStream) : undefined;
const asyncIterator = typeof Symbol !== "undefined" ? Symbol.asyncIterator : undefined;
if (streamProto && asyncIterator && typeof streamProto[asyncIterator] !== "function") {
  Object.defineProperty(streamProto, asyncIterator, {
    configurable: true,
    writable: true,
    value: async function* readableStreamAsyncIterator(this: ReadableStream) {
      const reader = this.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) return;
          yield value;
        }
      } finally {
        reader.releaseLock();
      }
    },
  });
}
