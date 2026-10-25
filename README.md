# pdf-signer

A local-only desktop app for signing PDFs with an image or drawn signature, in the spirit of Acrobat Reader's simple stamp flow. Files never leave your disk.

> **Status:** early development. You can open a PDF, import or draw a signature, place it on one page, and save the stamped PDF. Multiple stamps, undo and a remembered signature are still to come. See [SPEC.md](SPEC.md) for the full spec.

## Features (phase 1)

- Open a PDF with a native file dialog and flip through its pages, with zoom and fit-width
- Import a PNG/JPG signature, or draw one with the mouse or trackpad
- Drag and resize the signature on a page preview
- Stamp it onto that one page and save, choosing each time between a new file (`<name>-signed.pdf`) or overwriting the original

Phase 2 will add certificate signing (PKCS#12 / `.p12` / `.pfx`).

## Stack

- [Tauri 2](https://tauri.app) with a Rust backend in `src-tauri/`
- React 19, TypeScript and Vite 6 in `src/`
- [PDF.js](https://mozilla.github.io/pdf.js/) (`pdfjs-dist`) renders page previews in the webview
- Linux first; Tauri keeps macOS and Windows viable later

The project layout follows its structural sibling, [audio-compare](https://github.com/kelvinlim/audio-compare). Only the layout and stack are shared, not its audio code.

## How it works

The webview renders pages with PDF.js. On save, the Rust backend uses [`lopdf`](https://crates.io/crates/lopdf) to embed the signature (PNG transparency is preserved as an alpha mask) into the chosen page's content, then writes the file atomically. Screen positions are converted to PDF coordinates, accounting for zoom, page rotation and CropBox offset. The whole file is rewritten, so previously digitally signed PDFs would lose their signatures, and password-protected PDFs are not supported yet.

## Development

Requires Node 20+ and stable Rust. On Linux, Tauri also needs the WebKitGTK 4.1 development packages; see the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/#linux).

```sh
npm install
npm run tauri dev     # run in development
npm run tauri build   # production build
npm test              # frontend tests (Vitest)
(cd src-tauri && cargo test --lib)   # Rust tests
```

## License

[MIT](LICENSE)
