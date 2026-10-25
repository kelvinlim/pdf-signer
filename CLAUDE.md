# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Status

Phases 0, 1a, 1b and 1c are in place: the app opens a PDF through a native dialog and renders the current page with PDF.js, with prev/next navigation, zoom in/out, fit-width (follows window resize), and error messages for password-protected or corrupt files. The canvas is rendered at device-pixel resolution but laid out in CSS pixels (`scale` = CSS px per PDF point), so the placement overlay can use CSS coordinates directly. Signatures can be imported (PNG/JPG, type sniffed from magic bytes in `src/signature.ts`) or drawn in `src/SignaturePad.tsx` (strokes exported as a cropped, transparent 2x PNG); the current `Signature` (bytes, mime, object URL, pixel size) lives in `App` state. The signature can be placed on the page with `src/PlacementOverlay.tsx` (drag to move, corner handles resize with aspect locked, Shift = free). The placement is held in `App` as a zoom-independent rect in displayed-page points (top-left origin) and converted to PDF user space by `screenRectToPdfRect` in `src/coords.ts` (handles zoom, `/Rotate`, CropBox offset; unit-tested in `src/coords.test.ts`). The resulting `PdfRect` carries the page `rotation`, which the stamper must compensate for so the image reads upright. Everything else in [SPEC.md](SPEC.md) (stamping, save prompt) is not built yet; the current placement is only shown in a footer readout. The phased plan is: 1a open/preview, 1b signature sources, 1c placement overlay, 1d stamp and save, 1e polish, then phase 2 certificate signing.

## What it is

Local-only desktop PDF signer (Linux first, Tauri keeps macOS/Windows viable). Phase 1: open a PDF, import (PNG/JPG) or draw a signature, drag/resize it on a page preview, stamp it into the PDF, save (always prompt: new file `basename-signed.pdf` vs overwrite). Phase 2 (deferred, leave only stubs/comments): PKCS#12 certificate signing — never log passwords.

## Commands

Rust is installed via rustup; in a fresh shell run `. "$HOME/.cargo/env"` if `cargo` is not on PATH.

- `npm install` then `npm run tauri dev` — run the app with hot reload (Vite on port 1420)
- `npm run tauri build` — production bundle
- `npx tsc --noEmit` — type-check the frontend
- `cargo check` (from `src-tauri/`) — type-check the backend

- `npm test` — Vitest (currently the coordinate mapping); a single file: `npx vitest run src/coords.test.ts`

`cargo test` for the stamping code is planned for phase 1d.

## Stack and layout

Mirrors the sibling repo https://github.com/kelvinlim/audio-compare (layout/stack only — do not copy its ffmpeg/audio code or GPL sidecar pattern):

- Tauri 2 + Rust backend in `src-tauri/` (app id `com.kolim.pdfsigner`, crate `pdf-signer`, lib `pdf_signer_lib`)
- React 19 + TypeScript + Vite 6 frontend in `src/`; the scaffolder defaults to Vite 8 / TS 6, which were deliberately pinned back to Vite 6 / TS 5.8
- Tauri commands are registered in `src-tauri/src/lib.rs`; plugin permissions go in `src-tauri/capabilities/default.json` (currently `dialog:default`, `opener:default`)

## Architecture notes

- The frontend reads PDF bytes through the `read_file` Rust command (returned as a raw `tauri::ipc::Response`, so it arrives as an `ArrayBuffer`) and hands them to PDF.js. The PDF.js worker is bundled via Vite's `?url` import in `src/App.tsx`.
- Rust will stamp the image into the PDF via Tauri commands (e.g. `stamp_image`, `save_pdf`), keeping the pipeline "bytes in, bytes out" so a phase 2 signing step can be appended.
- Screen→PDF coordinate mapping is the subtle part: PDF page space is in points with origin **bottom-left**, while the preview is top-left pixels; account for zoom, page `/Rotate`, and CropBox vs MediaBox. Keep it a pure, unit-tested function.
- The Rust PDF library must support embedding PNG **with transparency** (planned: `lopdf`, with the alpha channel written as a separate `/SMask` image; JPEG can use `DCTDecode`). Prefer MIT-compatible dependencies.
- Overwrite must write a temp file in the same directory and rename atomically.
- Draw pad exports a black-stroke PNG on a transparent canvas.
- PDF.js rendering in Linux's WebKitGTK webview has been confirmed working (the user opened a PDF in `npm run tauri dev`).

## License

MIT (see [LICENSE](LICENSE)).
