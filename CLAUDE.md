# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Status

Phases 0, 1a, 1b, 1c and 1d are in place: the app opens a PDF through a native dialog and renders the current page with PDF.js, with prev/next navigation, zoom in/out, fit-width (follows window resize), and error messages for password-protected or corrupt files. The canvas is rendered at device-pixel resolution but laid out in CSS pixels (`scale` = CSS px per PDF point), so the placement overlay can use CSS coordinates directly. Signatures can be imported (PNG/JPG, type sniffed from magic bytes in `src/signature.ts`) or drawn in `src/SignaturePad.tsx` (strokes exported as a cropped, transparent 2x PNG); the current `Signature` (bytes, mime, object URL, pixel size) lives in `App` state. The signature can be placed on the page with `src/PlacementOverlay.tsx` (drag to move, corner handles resize with aspect locked, Shift = free). The placement is held in `App` as a zoom-independent rect in displayed-page points (top-left origin) and converted to PDF user space by `screenRectToPdfRect` in `src/coords.ts` (handles zoom, `/Rotate`, CropBox offset; unit-tested in `src/coords.test.ts`). The resulting `PdfRect` carries the page `rotation`, which the stamper must compensate for so the image reads upright. The signature is pinned to the single page it was placed on (`Placement.page` in `App`); the overlay only shows there and exactly that one page is stamped. **Apply & Save…** asks every time: overwrite the original or save as a new file (`<name>-signed.pdf` via the save dialog). `App` sends the PDF-space rect, rotation and signature bytes to the `save_stamped_pdf` Rust command, then reloads the saved file into the viewer. Stamping lives in `src-tauri/src/stamp.rs`: `lopdf` loads the file, the PNG/JPEG is decoded with the `image` crate and embedded as an RGB Image XObject plus a `/SMask` for alpha (JPEG is re-encoded, not passed through as DCTDecode), the page's original content is wrapped in `q`/`Q` and a stamp stream appended, and inherited resources are cloned onto the page rather than mutating shared objects. `image_matrix` compensates for page `/Rotate`. The whole file is rewritten (not an incremental update), so existing digital signatures would be invalidated; encrypted PDFs are rejected. Output is written to a temp file in the destination directory and renamed. The last imported/drawn signature is remembered across launches: `store_signature` (raw request body), `load_saved_signature` and `forget_signature` in `src-tauri/src/lib.rs` keep it as `signature.img` in the app data dir, loaded on startup in `App` (the × toolbar button forgets it). Remaining in phase 1: multiple stamps and undo (1e). The phased plan is: 1a open/preview, 1b signature sources, 1c placement overlay, 1d stamp and save, 1e polish (multi-stamp, undo), then phase 2 certificate signing.

## What it is

Local-only desktop PDF signer (Linux first, Tauri keeps macOS/Windows viable). Phase 1: open a PDF, import (PNG/JPG) or draw a signature, drag/resize it on a page preview, stamp it into the PDF, save (always prompt: new file `basename-signed.pdf` vs overwrite). Phase 2 (deferred, leave only stubs/comments): PKCS#12 certificate signing — never log passwords.

## Commands

Rust is installed via rustup; in a fresh shell run `. "$HOME/.cargo/env"` if `cargo` is not on PATH.

- `npm install` then `npm run tauri dev` — run the app with hot reload (Vite on port 1420)
- `npm run tauri build` — production bundle
- `npx tsc --noEmit` — type-check the frontend
- `cargo check` (from `src-tauri/`) — type-check the backend

- `npm test` — Vitest (currently the coordinate mapping); a single file: `npx vitest run src/coords.test.ts`

- `cargo test --lib` (from `src-tauri/`) — stamping and atomic-write tests. For visual inspection set `STAMP_OUT_DIR=<dir>` (writes `rot{0,90,180,270}.pdf`) and optionally `STAMP_SAMPLE_PDF=<file>` (writes `real.pdf`), then render with `pdftoppm` and check `qpdf --check`.

## Stack and layout

Mirrors the sibling repo https://github.com/kelvinlim/audio-compare (layout/stack only — do not copy its ffmpeg/audio code or GPL sidecar pattern):

- Tauri 2 + Rust backend in `src-tauri/` (app id `com.kolim.pdfsigner`, crate `pdf-signer`, lib `pdf_signer_lib`)
- React 19 + TypeScript + Vite 6 frontend in `src/`; the scaffolder defaults to Vite 8 / TS 6, which were deliberately pinned back to Vite 6 / TS 5.8
- Tauri commands are registered in `src-tauri/src/lib.rs`; plugin permissions go in `src-tauri/capabilities/default.json` (currently `dialog:default`, `opener:default`)

## Architecture notes

- The frontend reads PDF bytes through the `read_file` Rust command (returned as a raw `tauri::ipc::Response`, so it arrives as an `ArrayBuffer`) and hands them to PDF.js. The PDF.js worker is bundled via Vite's `?url` import in `src/App.tsx`.
- `stamp::stamp_pdf` is "bytes in, bytes out" so a phase 2 signing step can be appended after it.
- Screen→PDF coordinate mapping is the subtle part: PDF page space is in points with origin **bottom-left**, while the preview is top-left pixels; account for zoom, page `/Rotate`, and CropBox vs MediaBox. Keep it a pure, unit-tested function.
- The Rust PDF library must support embedding PNG **with transparency** (planned: `lopdf`, with the alpha channel written as a separate `/SMask` image; JPEG can use `DCTDecode`). Prefer MIT-compatible dependencies.
- Draw pad exports a black-stroke PNG on a transparent canvas.
- PDF.js rendering in Linux's WebKitGTK webview has been confirmed working (the user opened a PDF in `npm run tauri dev`).

## License

MIT (see [LICENSE](LICENSE)).
