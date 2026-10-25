import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import PlacementOverlay from "./PlacementOverlay";
import SignaturePad from "./SignaturePad";
import {
  displayedSize,
  screenRectToPdfRect,
  type PageGeometry,
  type Rect,
} from "./coords";
import { loadSignature, revokeSignature, type Signature } from "./signature";
import "./App.css";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const ZOOM_STEP = 1.25;
const MIN_SCALE = 0.25;
const MAX_SCALE = 5;
const PAGE_MARGIN = 24;

/** `fit` follows the container width; a number is a fixed scale (CSS px per PDF point). */
type ZoomMode = "fit" | number;

function describeLoadError(e: unknown): string {
  const name = (e as { name?: string })?.name;
  if (name === "PasswordException") {
    return "This PDF is password-protected. Encrypted PDFs are not supported yet.";
  }
  if (name === "InvalidPDFException" || name === "FormatError") {
    return "This file is not a valid PDF, or it is corrupt.";
  }
  return `Could not open PDF: ${e instanceof Error ? e.message : String(e)}`;
}

/** One signature on one page. Each stamp is written to its own page only. */
interface Placement {
  id: number;
  page: number;
  /** Displayed-page points (top-left origin); zoom-independent. */
  rect: Rect;
  /** The image this stamp uses, kept even if the current signature changes later. */
  sig: Signature;
}

type PageInfo = PageGeometry & { page: number };

function App() {
  const viewerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [doc, setDoc] = useState<pdfjs.PDFDocumentProxy | null>(null);
  const loadingTaskRef = useRef<pdfjs.PDFDocumentLoadingTask | null>(null);
  const [fileName, setFileName] = useState("");
  const [pageNum, setPageNum] = useState(1);
  const [zoom, setZoom] = useState<ZoomMode>("fit");
  const [viewerWidth, setViewerWidth] = useState(0);
  const [scale, setScale] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [signature, setSignature] = useState<Signature | null>(null);
  const [padOpen, setPadOpen] = useState(false);
  const [pageGeom, setPageGeom] = useState<PageInfo | null>(null);
  const [placements, setPlacements] = useState<Placement[]>([]);
  const nextPlacementId = useRef(1);
  /** Every signature object with a live object URL, so unused ones can be released. */
  const liveSignatures = useRef(new Set<Signature>());
  const [sourcePath, setSourcePath] = useState<string | null>(null);
  const [saveChoiceOpen, setSaveChoiceOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  /** Use `bytes` as the current signature; `remember` also keeps it for the next launch. */
  async function applySignature(bytes: Uint8Array, remember = true) {
    try {
      const next = await loadSignature(bytes);
      liveSignatures.current.add(next);
      setSignature(next);
      setError(null);
      if (remember) {
        try {
          await invoke("store_signature", bytes);
        } catch (e) {
          setError(`Signature loaded, but could not be remembered: ${String(e)}`);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function forgetSignature() {
    try {
      await invoke("forget_signature");
    } catch (e) {
      setError(String(e));
      return;
    }
    setSignature(null);
  }

  // Release object URLs for signatures that are neither current nor stamped.
  useEffect(() => {
    for (const sig of [...liveSignatures.current]) {
      if (sig !== signature && !placements.some((p) => p.sig === sig)) {
        revokeSignature(sig);
        liveSignatures.current.delete(sig);
      }
    }
  }, [signature, placements]);

  // Restore the last-used signature from the previous session.
  useEffect(() => {
    (async () => {
      try {
        const bytes = new Uint8Array(await invoke<ArrayBuffer>("load_saved_signature"));
        if (bytes.length > 0) await applySignature(bytes, false);
      } catch {
        // A missing or unreadable remembered signature just means starting empty.
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function importSignature() {
    const path = await open({
      multiple: false,
      filters: [{ name: "Image", extensions: ["png", "jpg", "jpeg"] }],
    });
    if (!path) return;
    try {
      const bytes = await invoke<ArrayBuffer>("read_file", { path });
      await applySignature(new Uint8Array(bytes));
    } catch (e) {
      setError(String(e));
    }
  }

  async function loadPdf(path: string) {
    const bytes = await invoke<ArrayBuffer>("read_file", { path });
    const task = pdfjs.getDocument({ data: new Uint8Array(bytes) });
    let loaded: pdfjs.PDFDocumentProxy;
    try {
      loaded = await task.promise;
    } catch (e) {
      void task.destroy();
      throw e;
    }
    // Keep the previous document on screen until the new one has loaded.
    void loadingTaskRef.current?.destroy();
    loadingTaskRef.current = task;
    setDoc(loaded);
    setSourcePath(path);
    setFileName(path.split(/[\\/]/).pop() ?? path);
    setPlacements([]);
  }

  async function openPdf() {
    const path = await open({
      multiple: false,
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (!path) return;
    setError(null);
    setNotice(null);
    try {
      await loadPdf(path);
      setPageNum(1);
    } catch (e) {
      setError(describeLoadError(e));
    }
  }

  /** `mode` is asked of the user on every save; there is no remembered default. */
  async function saveSigned(mode: "new" | "overwrite") {
    setSaveChoiceOpen(false);
    if (!sourcePath || !doc || placements.length === 0) return;

    let dest: string | null = sourcePath;
    if (mode === "new") {
      const sep = sourcePath.includes("\\") ? "\\" : "/";
      const dir = sourcePath.slice(0, sourcePath.lastIndexOf(sep) + 1);
      const base = fileName.replace(/\.pdf$/i, "");
      dest = await save({
        defaultPath: `${dir}${base}-signed.pdf`,
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      });
      if (!dest) return;
    }

    setSaving(true);
    setError(null);
    try {
      // Placements are in zoom-independent displayed points, so convert each
      // with its own page's geometry at scale 1.
      const stamps = [];
      for (const p of placements) {
        const page = await doc.getPage(p.page);
        const r = screenRectToPdfRect(
          { view: page.view as PageGeometry["view"], rotate: page.rotate },
          1,
          p.rect,
        );
        stamps.push({
          page: p.page,
          x: r.x,
          y: r.y,
          width: r.width,
          height: r.height,
          rotation: r.rotation,
          image: Array.from(p.sig.bytes),
        });
      }
      await invoke("save_stamped_pdf", { sourcePath, destPath: dest, stamps });
      // Show the saved result so the user can see exactly what was written.
      await loadPdf(dest);
      setNotice(`Saved to ${dest}`);
    } catch (e) {
      setError(typeof e === "string" ? e : describeLoadError(e));
    } finally {
      setSaving(false);
    }
  }

  // Track the viewer width so fit-width can follow window resizes.
  useEffect(() => {
    const el = viewerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setViewerWidth(el.clientWidth));
    observer.observe(el);
    setViewerWidth(el.clientWidth);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!doc || !canvasRef.current || viewerWidth === 0) return;
    const canvas = canvasRef.current;
    let task: pdfjs.RenderTask | undefined;
    let cancelled = false;
    (async () => {
      const page = await doc.getPage(pageNum);
      if (cancelled) return;
      const base = page.getViewport({ scale: 1 });
      const next =
        zoom === "fit"
          ? Math.min(MAX_SCALE, Math.max(MIN_SCALE, (viewerWidth - PAGE_MARGIN * 2) / base.width))
          : zoom;
      setScale(next);
      setPageGeom({
        page: pageNum,
        view: page.view as PageGeometry["view"],
        rotate: page.rotate,
      });

      // Render at device resolution but lay out in CSS pixels, so overlays
      // can use CSS coordinates directly.
      const dpr = window.devicePixelRatio || 1;
      const viewport = page.getViewport({ scale: next });
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      task = page.render({
        canvas,
        viewport: page.getViewport({ scale: next * dpr }),
      });
      try {
        await task.promise;
      } catch (e) {
        if ((e as { name?: string })?.name !== "RenderingCancelledException") {
          setError(`Could not render page ${pageNum}: ${String(e)}`);
        }
      }
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, pageNum, zoom, viewerWidth]);

  // Geometry is set asynchronously after a page change; only trust it once it
  // describes the page being shown.
  const geom = pageGeom && pageGeom.page === pageNum ? pageGeom : null;
  const bounds = geom ? displayedSize(geom) : null;
  const pagePlacements = placements.filter((p) => p.page === pageNum);

  function addPlacement() {
    if (!signature || !bounds) return;
    const width = Math.min(bounds.width * 0.25, bounds.height * 0.5 * (signature.width / signature.height));
    const height = width * (signature.height / signature.width);
    // Nudge each new stamp on the same page so they don't hide one another.
    const nudge = pagePlacements.length * 16;
    setNotice(null);
    setPlacements((prev) => [
      ...prev,
      {
        id: nextPlacementId.current++,
        page: pageNum,
        sig: signature,
        rect: {
          width,
          height,
          x: Math.min((bounds.width - width) / 2 + nudge, bounds.width - width),
          y: Math.min((bounds.height - height) / 2 + nudge, bounds.height - height),
        },
      },
    ]);
  }

  const undo = () => setPlacements((prev) => prev.slice(0, -1));

  // Ctrl/Cmd+Z undoes the last added signature.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !padOpen && !saveChoiceOpen) {
        e.preventDefault();
        setPlacements((prev) => prev.slice(0, -1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [padOpen, saveChoiceOpen]);

  /** Page numbers that will be stamped, with a count per page. */
  const pageCounts = [
    ...placements.reduce((m, p) => m.set(p.page, (m.get(p.page) ?? 0) + 1), new Map<number, number>()),
  ].sort((a, b) => a[0] - b[0]);
  const pageSummary = pageCounts
    .map(([page, n]) => (n > 1 ? `page ${page} (×${n})` : `page ${page}`))
    .join(", ");
  const countLabel = placements.length === 1 ? "1 signature" : `${placements.length} signatures`;

  const clamp = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
  const zoomBy = (factor: number) => setZoom(clamp(scale * factor));

  return (
    <main className="app">
      <header className="toolbar">
        <button onClick={openPdf}>Open PDF…</button>
        {doc && (
          <>
            <span className="file-name" title={fileName}>
              {fileName}
            </span>
            <span className="spacer" />
            <button
              aria-label="Previous page"
              disabled={pageNum <= 1}
              onClick={() => setPageNum((n) => n - 1)}
            >
              ‹
            </button>
            <span>
              {pageNum} / {doc.numPages}
            </span>
            <button
              aria-label="Next page"
              disabled={pageNum >= doc.numPages}
              onClick={() => setPageNum((n) => n + 1)}
            >
              ›
            </button>
            <span className="divider" />
            <button aria-label="Zoom out" onClick={() => zoomBy(1 / ZOOM_STEP)}>
              −
            </button>
            <span className="zoom-label">{Math.round(scale * 100)}%</span>
            <button aria-label="Zoom in" onClick={() => zoomBy(ZOOM_STEP)}>
              +
            </button>
            <button aria-pressed={zoom === "fit"} onClick={() => setZoom("fit")}>
              Fit width
            </button>
          </>
        )}
        <span className="divider" />
        <button onClick={importSignature}>Import signature…</button>
        <button onClick={() => setPadOpen(true)}>Draw signature…</button>
        {signature && (
          <>
            <img className="sig-thumb" src={signature.url} alt="Current signature" />
            <button
              aria-label="Forget saved signature"
              title="Forget the saved signature"
              onClick={() => void forgetSignature()}
            >
              ×
            </button>
            <button disabled={!doc || !bounds} onClick={addPlacement}>
              Add to this page
            </button>
          </>
        )}
        {placements.length > 0 && (
          <>
            <button onClick={undo}>Undo</button>
            <button onClick={() => setPlacements([])}>Remove all</button>
            <button className="primary" disabled={saving} onClick={() => setSaveChoiceOpen(true)}>
              {saving ? "Saving…" : "Apply & Save…"}
            </button>
          </>
        )}
      </header>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && <p className="notice">{notice}</p>}
      <div className="viewer" ref={viewerRef}>
        {!doc && !error && <p className="hint">Open a PDF to get started.</p>}
        <div className="page" hidden={!doc}>
          <canvas ref={canvasRef} />
          {bounds &&
            pagePlacements.map((p) => (
              <PlacementOverlay
                key={p.id}
                url={p.sig.url}
                rect={p.rect}
                scale={scale}
                bounds={bounds}
                onChange={(rect) =>
                  setPlacements((prev) => prev.map((q) => (q.id === p.id ? { ...q, rect } : q)))
                }
              />
            ))}
        </div>
      </div>
      {placements.length > 0 && (
        <footer className="status">
          {countLabel} will be stamped: {pageSummary}. Drag to move, corners to resize (Shift =
          free), Ctrl+Z to undo.
        </footer>
      )}
      {saveChoiceOpen && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Save signed PDF">
          <div className="modal">
            <h2>Save signed PDF</h2>
            <p>
              {countLabel} will be added ({pageSummary}). Other pages are left unchanged. How do you
              want to save?
            </p>
            <div className="modal-actions">
              <button onClick={() => setSaveChoiceOpen(false)}>Cancel</button>
              <span className="spacer" />
              <button onClick={() => void saveSigned("overwrite")}>Overwrite original</button>
              <button className="primary" onClick={() => void saveSigned("new")}>
                Save as new file…
              </button>
            </div>
          </div>
        </div>
      )}
      {padOpen && (
        <SignaturePad
          onCancel={() => setPadOpen(false)}
          onDone={(png) => {
            setPadOpen(false);
            void applySignature(png);
          }}
        />
      )}
    </main>
  );
}

export default App;
