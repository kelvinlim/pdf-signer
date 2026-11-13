import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// @ts-expect-error type error without @types/node package
import process from "node:process";
const host = process.env.TAURI_DEV_HOST;

// WKWebView on macOS 13.2 ≈ Safari 16.3; Linux WebKitGTK is also WebKit.
// A target newer than safari16 lets esbuild dead-code-eliminate polyfills
// (Iterator, Promise.withResolvers, …) that those engines still lack.
const target = process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari16";

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [react()],

  // Relative URLs so the bundle loads from Tauri's custom protocol
  // (`tauri://localhost` on macOS/Linux). Absolute `/assets/...` paths 404 in
  // WKWebView and show up as a blank native window.
  base: "./",

  esbuild: { target },

  optimizeDeps: {
    esbuildOptions: { target },
    // Pre-bundling the package root would pull the *modern* PDF.js build.
    exclude: ["pdfjs-dist"],
  },

  worker: {
    format: "es" as const,
    rollupOptions: {
      output: {
        // One file so the worker does not need extra module requests from
        // `tauri://` / WebKitGTK (MIME / path issues).
        inlineDynamicImports: true,
      },
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  build: {
    // Tauri uses Chromium on Windows and WebKit on macOS and Linux.
    target,
    minify: !process.env.TAURI_ENV_DEBUG ? "esbuild" : false,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
    chunkSizeWarningLimit: 2000,
  },
}));
