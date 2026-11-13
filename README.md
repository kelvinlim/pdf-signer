# pdf-signer

A local-only desktop app for signing PDFs with an image or drawn signature, in the spirit of Acrobat Reader's simple stamp flow. Files never leave your disk (your last signature is kept in the app's local data folder).

> **Status:** early development. You can open a PDF, import or draw a signature, place it on one page, and save the stamped PDF. Your last signature is remembered between launches. You can add several signatures (each on its own page) and undo. See [SPEC.md](SPEC.md) for the full spec.

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

## Releases

GitHub Actions builds installers for macOS (Apple silicon), Windows (x64) and Linux (x64: `.deb`, `.rpm`, AppImage). Pushing a `v*` tag drafts a GitHub release with the installers attached; pull requests and manual runs upload them as workflow artifacts. macOS builds are signed and notarized when the `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_API_KEY`, `APPLE_API_ISSUER` and `APPLE_API_KEY_CONTENT` repository secrets are set, and unsigned otherwise.

### macOS

The published DMG is **Apple silicon only** (`*_aarch64.dmg`). Intel Macs cannot run it. **macOS 13 Ventura or later** is required (WKWebView ≈ Safari 16.3).

When the six `APPLE_*` secrets are set, CI signs with a Developer ID certificate, notarizes, and staples the DMG (v0.1.1 and later). Gatekeeper should accept those builds with a normal double-click.

A local `npm run tauri build` without those credentials produces an **unsigned** app. macOS then blocks the first launch. Open it without turning Gatekeeper off:

1. Right-click **PDF Signer.app** → **Open** → **Open** again in the warning dialog, or
2. Strip the quarantine flag from this copy of the app:

```sh
xattr -cr "/Applications/PDF Signer.app"
```

If you downloaded an unsigned build from a browser, quarantine can also sit on the `.dmg`; `xattr -cr` that file before opening it, or run the same command on the `.app` after copying it to `/Applications`.

### macOS signing and notarization

Releases are signed with a **Developer ID Application** certificate and notarized with an App Store Connect API key. Both are needed; the Apple Development certificate is for local builds only.

1. **Certificate.** In Keychain Access open *login* → *My Certificates*, right-click "Developer ID Application: <name> (<team id>)" → *Export…* as `.p12`, and choose a password (keep it in a password manager; GitHub cannot show a secret back). Check it with `openssl pkcs12 -legacy -in cert.p12 -noout` (the `-legacy` flag is needed with OpenSSL 3; a wrong password prints `Mac verify error`).
2. **API key.** In App Store Connect → *Users and Access* → *Integrations* → *Team Keys*, create a key with Developer access and download the `AuthKey_<KEYID>.p8` (Apple allows one download). The page also shows the **Issuer ID**.
3. **Repository secrets** (run from the repo; `gh secret set NAME` prompts so values stay out of shell history):

   ```sh
   base64 -i cert.p12 | gh secret set APPLE_CERTIFICATE
   gh secret set APPLE_CERTIFICATE_PASSWORD
   gh secret set APPLE_SIGNING_IDENTITY --body "Developer ID Application: <name> (<team id>)"
   gh secret set APPLE_API_KEY --body "<KEYID>"
   gh secret set APPLE_API_ISSUER --body "<issuer id>"
   gh secret set APPLE_API_KEY_CONTENT < AuthKey_<KEYID>.p8
   gh secret list   # all six should appear
   ```

4. **Build.** `gh workflow run build.yml` uploads a signed DMG as an artifact; pushing a `v*` tag drafts a release with it attached. The workflow notarizes and staples the DMG and runs `spctl` on it, so a green macOS job means Gatekeeper accepts it. If either `APPLE_CERTIFICATE` or `APPLE_API_KEY_CONTENT` is missing, the macOS job falls back to an unsigned build with a warning.

For a local signed build: `APPLE_SIGNING_IDENTITY="Developer ID Application: <name> (<team id>)" npm run tauri build`. Never commit the `.p12` or `.p8` files. The same six secrets can be reused across repositories.

## Known limits

- **macOS 13 Ventura or later** (Apple silicon). PDF preview runs in WKWebView; Ventura 13.2.1 is ≈ Safari 16.3, which is the engine floor this app targets. macOS 12 Monterey is not supported.
- Password-protected / encrypted PDFs cannot be opened.
- Stamping rewrites the whole file, so existing digital signatures are invalidated.
- The last drawn or imported signature is stored in the app data folder on this machine only.

## License

[MIT](LICENSE)
