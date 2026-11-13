import { describe, expect, it } from "vitest";
import appSrc from "./App.tsx?raw";

describe("App.tsx load isolation", () => {
  it("does not import PDF.js at module evaluation", () => {
    expect(appSrc).not.toMatch(/from ["']pdfjs-dist\/build/);
    expect(appSrc).not.toMatch(/pdfjs-dist\/legacy/);
    expect(appSrc).not.toMatch(/\?url/);
    expect(appSrc).toMatch(/import\(["']\.\/pdfjs["']\)/);
  });
});
