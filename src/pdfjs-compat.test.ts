// The frontend tsconfig has no @types/node (DOM-only); Vitest still runs in Node.
// @ts-expect-error node builtin
import { existsSync, readdirSync, readFileSync } from "node:fs";
// @ts-expect-error node builtin
import { dirname, join } from "node:path";
// @ts-expect-error node builtin
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import pdfjsSrc from "./pdfjs.ts?raw";
import polyfillSrc from "./pdfjs-polyfills.ts?raw";
import workerSrc from "./pdfjs-worker.ts?raw";
import viteConfigSrc from "../vite.config.ts?raw";

type GlobalWithIterator = typeof globalThis & { Iterator?: unknown };
type PromiseWithResolvers = typeof Promise & {
  withResolvers?: (...args: unknown[]) => unknown;
};

const here = dirname(fileURLToPath(import.meta.url));
const distAssets = join(here, "../dist/assets");

describe("PDF.js loader targets Safari 16.3-era WebKit", () => {
  it("loads polyfills, then the legacy build, then the worker entry", () => {
    expect(pdfjsSrc).toMatch(/import ["']\.\/pdfjs-polyfills["']/);
    expect(pdfjsSrc).toMatch(/from ["']pdfjs-dist\/legacy\/build\/pdf\.mjs["']/);
    expect(pdfjsSrc).toMatch(/import\(["']\.\/pdfjs-worker["']\)/);
    expect(pdfjsSrc).toMatch(/import\(["']\.\/pdfjs-worker\?worker&url["']\)/);
    expect(pdfjsSrc).not.toMatch(/import\s+\*\s+as\s+\w+\s+from ["']pdfjs-dist["']/);
    expect(pdfjsSrc).not.toMatch(/pdfjs-dist\/build\//);
  });

  it("does not use the modern worker as a raw ?url asset", () => {
    expect(workerSrc).toMatch(/import ["']\.\/pdfjs-polyfills["']/);
    expect(workerSrc).toMatch(/pdfjs-dist\/legacy\/build\/pdf\.worker\.min\.mjs/);
    expect(polyfillSrc).toMatch(/core-js\/actual\/iterator/);
    expect(polyfillSrc).toMatch(/core-js\/actual\/promise\/with-resolvers/);
  });

  it("sets the Vite/esbuild target to safari16 for WebKit builds", () => {
    expect(viteConfigSrc).toMatch(/safari16/);
    expect(viteConfigSrc).not.toMatch(/safari1[578]/);
  });
});

describe("PDF.js loads without native Iterator / Promise.withResolvers", () => {
  // Apple fake-worker path: the reported bug runs the worker on the page thread.
  vi.mock("./platform", () => ({ isAppleWebView: () => true }));

  const g = globalThis as GlobalWithIterator;
  const P = Promise as PromiseWithResolvers;
  const originalIterator = g.Iterator;
  const originalWithResolvers = P.withResolvers;

  beforeAll(() => {
    delete g.Iterator;
    delete P.withResolvers;
    expect(g.Iterator).toBeUndefined();
    expect(P.withResolvers).toBeUndefined();
  });

  afterAll(() => {
    if (originalIterator !== undefined) g.Iterator = originalIterator;
    else delete g.Iterator;
    if (originalWithResolvers !== undefined) P.withResolvers = originalWithResolvers;
    else delete P.withResolvers;
  });

  it("imports the loader and installs the missing builtins", async () => {
    const pdfjs = await import("./pdfjs");
    await expect(pdfjs.ready).resolves.toBeUndefined();
    expect(typeof g.Iterator).toBe("function");
    expect(typeof P.withResolvers).toBe("function");
    expect(typeof pdfjs.getDocument).toBe("function");
  });
});

const NEW_BUILTIN_PATTERNS = [
  { name: "Iterator helpers", re: /\bIterator\.(?:from|range|concat|zip)\b/ },
  { name: "Promise.withResolvers", re: /Promise\.withResolvers\s*\(/ },
  { name: "Promise.try", re: /Promise\.try\s*\(/ },
  { name: "Map.groupBy", re: /Map\.groupBy\s*\(/ },
  { name: "Object.groupBy", re: /Object\.groupBy\s*\(/ },
  { name: "Array.fromAsync", re: /Array\.fromAsync\s*\(/ },
  { name: "Array.prototype.findLast", re: /\.findLast(?:Index)?\s*\(/ },
  { name: "Array.prototype.toSorted", re: /\.toSorted\s*\(/ },
  { name: "Set.prototype.union", re: /\.union\s*\(/ },
] as const;

describe.skipIf(!existsSync(distAssets))("production bundle polyfills", () => {
  const files = existsSync(distAssets)
    ? readdirSync(distAssets).filter((f: string) => /\.(mjs|js)$/.test(f))
    : [];
  const named = Object.fromEntries(
    files.map((f: string) => [f, readFileSync(join(distAssets, f), "utf8")]),
  );
  const all = Object.values(named).join("\n");
  const polyfilledWorkers = Object.entries(named).filter(
    ([name, src]) => name.includes("pdfjs-worker") && src.includes("withResolvers"),
  );

  it("emits a worker chunk that includes the polyfill entry", () => {
    expect(files.length).toBeGreaterThan(0);
    expect(polyfilledWorkers.length, "expected a bundled PDF.js worker with polyfills").toBeGreaterThan(0);
    expect(all).toMatch(/withResolvers/);
    expect(all).toMatch(/target:"Iterator"|target:'Iterator'/);
  });

  it("does not ship unprefixed Iterator.from-style calls without a polyfill nearby", () => {
    // Usage of these names is fine *after* a polyfill; the polyfill file must
    // appear in the bundle. Fail if the modern PDF.js path (no legacy/core-js)
    // sneaks in and the polyfill modules are missing.
    expect(polyfillSrc.length).toBeGreaterThan(0);
    expect(all).toMatch(/Iterator/);
    for (const { name, re } of NEW_BUILTIN_PATTERNS) {
      if (!re.test(all)) continue;
      expect(all, `${name} appears in dist; polyfills must also be present`).toMatch(
        /withResolvers|IteratorPrototype|defineBuiltIn/,
      );
    }
  });
});
