# pdf-signer — Product & Architecture Spec (handoff)

## Goal

Build a **desktop PDF signer** similar in UX spirit to Adobe Acrobat Reader’s simple stamp/sign flow: open a PDF, place a signature (image or drawn), save. Later: cryptographic certificate signing (PKCS#12 / DigiCert-style).

## Repos

| Role | URL |
| --- | --- |
| **Target (empty, public)** | https://github.com/kelvinlim/pdf-signer |
| **Architecture reference** | https://github.com/kelvinlim/audio-compare |

Mirror **project layout and stack** from `audio-compare`, not its audio domain logic.

## Decisions locked (2026-10-24, with Kelvin)

| Topic | Decision |
| --- | --- |
| v1 signing mode | **Image / drawn signature first**; certificate signing is **phase 2** |
| Signature sources (v1) | **Both**: import PNG/JPG from disk **and** draw with mouse/trackpad |
| Placement (v1) | **Drag and resize** on a PDF **page preview** |
| First platform | **Linux first** (still use Tauri so macOS/Windows stay viable later) |
| Save behavior | **Ask each time**: new file vs overwrite |
| License (suggested) | MIT, same as audio-compare (confirm if changing) |

## Stack (copy from audio-compare)

- **Tauri 2** + **Rust** backend (`src-tauri/`)
- **React 19** + **TypeScript** + **Vite 6** frontend (`src/`)
- Tauri plugins: at least `@tauri-apps/plugin-dialog` (open/save); opener optional
- Node 20+, Rust stable
- Scripts pattern: `npm run tauri dev` / `npm run tauri build`
- Suggested crate/app id style: `com.kolim.pdfsigner` (parallel to `com.kolim.audiocompare`)

Reference `package.json` / `src-tauri/Cargo.toml` / folder layout from audio-compare:

```
pdf-signer/
  package.json, vite.config.ts, tsconfig*.json, index.html
  src/                 # React UI
  src-tauri/           # Rust + tauri.conf.json + icons + capabilities
  README.md, LICENSE, .gitignore
  .github/             # optional CI later
```

## Product: Phase 1 (MVP) — image / drawn stamp

### Must have

1. **Open PDF** via native file dialog (PDF only).
2. **Page preview** of the PDF (multi-page: navigate pages).
3. **Signature capture**
   - Import image: PNG/JPG (prefer preserving transparency for PNG).
   - Draw pad: black stroke on transparent canvas; export as PNG for stamping.
4. **Place signature**: overlay on current page; **drag** to move; **resize** (keep aspect ratio by default; optional free resize if cheap).
5. **Apply / Stamp**: burn signature into PDF page content (or appearance stream) at chosen position/size.
6. **Save**: dialog each time — “Save as new file” vs “Overwrite original”; if new, suggest `basename-signed.pdf`.
7. **Local-only**: no cloud; files stay on disk.

### Nice to have (phase 1 if time)

- Persist last-used signature image path (or cached drawing) in app data dir.
- Multiple stamps before save.
- Zoom / fit-width on preview.
- Undo last stamp before save.

### Out of scope for phase 1

- Certificate / digital signature (PAdES, PKCS#7, `.p12` / `.pfx`)
- Form-fill / AcroForm field detection
- Batch folder signing
- Mobile / web
- Adobe account / cloud DocuSign-style workflows

## Product: Phase 2 — certificate signing

(Defer implementation; design hooks so phase 1 doesn’t paint into a corner.)

- Import PKCS#12 (`.p12` / `.pfx`) + password (never log password).
- Create a PDF digital signature (Acrobat-verifiable appearance optional).
- Prefer Rust crates or well-maintained PDF libs that support signing; document choice in README.
- Still ask save new vs overwrite.

Certificate signing is a real digital signature, not a stamp image.

1. Load a PKCS#12 file (`.p12` / `.pfx`) containing a private key and certificate.
2. Hash the PDF byte ranges that will be signed; sign that hash with the private key.
3. Embed a PKCS#7 / CMS signature in a PDF signature dictionary.
4. Optional: draw a visible appearance (name, date, logo) — decoration only; Acrobat validates the crypto, not the pixels.

**Image stamp (phase 1):** paints pixels; easy to fake; no tamper detection.
**Certificate sign (phase 2):** binds identity + integrity; Acrobat can verify and show validity UI.

### Generating a test certificate (self-signed)

For development only. Acrobat will show the signature but treat the cert as untrusted unless you install it as a trusted identity (or use a CA-issued cert).

```bash
# 1) Self-signed cert + private key
openssl req -x509 -newkey rsa:2048 \
  -keyout key.pem -out cert.pem -days 365 -nodes \
  -subj "/CN=Kelvin Lim/O=OmniKog LLC/C=US"

# 2) Pack into PKCS#12 (prompted for an export password)
openssl pkcs12 -export -out signer.p12 \
  -inkey key.pem -in cert.pem -name "Kelvin Lim"
```

App imports `signer.p12` + password. Never commit `key.pem`, `cert.pem`, or `signer.p12`.

### Production certificates

Buy or obtain from an org CA / DigiCert / GlobalSign (etc.). Those usually arrive as `.p12` / `.pfx` already. Prefer MIT-compatible PDF signing libraries; document the choice in the README.

## Suggested technical approach (implementer chooses; document in README)

**Frontend**

- PDF.js (or similar) for page raster/preview in the webview.
- Overlay a positioned `<img>` / canvas for the signature; map screen coords → PDF page coords (points, origin bottom-left).
- Invoke Tauri commands for open/stamp/save.

**Backend (Rust)**

- Open/read PDF; stamp image onto page; write output.
- Candidate libs (evaluate; pick one and stick): `lopdf`, `printpdf`, `pdf-writer`, or a binding — must support **embedding PNG with transparency** and correct page coordinates.
- Tauri commands e.g. `open_pdf`, `render_page` (if not done in frontend), `stamp_image`, `save_pdf`.

**UX flow**

1. Open PDF → show page 1 preview + page nav.
2. “Import signature” or “Draw signature”.
3. Place overlay → drag/resize → Confirm stamp.
4. Save → ask new vs overwrite → done; optionally reopen result.

## Acceptance criteria (phase 1)

- [ ] App builds and runs on **Linux** via `npm run tauri dev`.
- [ ] User can open a multi-page PDF and flip pages.
- [ ] User can import a PNG signature and draw one.
- [ ] User can drag/resize the signature on the preview.
- [ ] Stamped PDF opens in a standard viewer with the signature visible on the correct page/position.
- [ ] Save prompts for new file vs overwrite every time.
- [ ] README documents run/build and architecture (point to audio-compare as structural sibling).

## Non-goals / constraints

- Do not clone audio-compare’s ffmpeg/audio code.
- Do not require a system Adobe install.
- Prefer MIT-compatible dependencies; note any GPL carefully (audio-compare ships a GPL ffmpeg sidecar — pdf-signer should avoid that pattern unless necessary).

## Suggested first milestones for the implementing agent

1. Scaffold empty Tauri 2 + React/Vite app into `kelvinlim/pdf-signer` (public), matching audio-compare layout.
2. Wire file open dialog + PDF page preview.
3. Import + draw signature + drag/resize overlay.
4. Stamp + save-with-prompt.
5. Polish README + Linux build notes; leave phase-2 stubs/comments only.

## Contact / owner

Kelvin O. Lim — GitHub `kelvinlim`. Repo: https://github.com/kelvinlim/pdf-signer
