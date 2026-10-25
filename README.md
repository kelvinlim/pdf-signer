# pdf-signer

A local-only desktop app for signing PDFs with an image or drawn signature, in the spirit of Acrobat Reader's simple stamp flow. Files never leave your disk.

> **Status:** early development. The Tauri/React app is scaffolded and can open a PDF and show its pages. Signature capture, placement, stamping and saving are not built yet. See [SPEC.md](SPEC.md) for the full spec.

## Planned features (phase 1)

- Open a PDF with a native file dialog and flip through its pages (basic version working)
- Import a PNG/JPG signature, or draw one with the mouse or trackpad
- Drag and resize the signature on a page preview
- Stamp it into the PDF and save, choosing each time between a new file (`<name>-signed.pdf`) or overwriting the original

Phase 2 will add certificate signing (PKCS#12 / `.p12` / `.pfx`).

## Stack

- [Tauri 2](https://tauri.app) with a Rust backend in `src-tauri/`
- React 19, TypeScript and Vite 6 in `src/`
- [PDF.js](https://mozilla.github.io/pdf.js/) (`pdfjs-dist`) renders page previews in the webview
- Linux first; Tauri keeps macOS and Windows viable later

The project layout follows its structural sibling, [audio-compare](https://github.com/kelvinlim/audio-compare). Only the layout and stack are shared, not its audio code.

## Development

Requires Node 20+ and stable Rust. On Linux, Tauri also needs the WebKitGTK 4.1 development packages; see the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/#linux).

```sh
npm install
npm run tauri dev     # run in development
npm run tauri build   # production build
```

## License

[MIT](LICENSE)
