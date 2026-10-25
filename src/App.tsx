import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
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
  const [pageGeom, setPageGeom] = useState<PageGeometry | null>(null);
  /** Pending placement in displayed-page points (top-left origin); zoom-independent. */
  const [placement, setPlacement] = useState<Rect | null>(null);

  async function applySignature(bytes: Uint8Array) {
    try {
      const next = await loadSignature(bytes);
      setSignature((prev) => {
        revokeSignature(prev);
        return next;
      });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

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

  async function openPdf() {
    const path = await open({
      multiple: false,
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (!path) return;
    setError(null);
    try {
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
      setFileName(path.split(/[\\/]/).pop() ?? path);
      setPageNum(1);
      setPlacement(null);
    } catch (e) {
      setError(describeLoadError(e));
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
      setPageGeom({ view: page.view as PageGeometry["view"], rotate: page.rotate });

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

  const bounds = pageGeom ? displayedSize(pageGeom) : null;

  // Keep the placement inside the page (page sizes can differ between pages).
  const shown: Rect | null =
    placement && bounds
      ? (() => {
          const width = Math.min(placement.width, bounds.width);
          const height = Math.min(placement.height, bounds.height);
          return {
            width,
            height,
            x: Math.min(Math.max(0, placement.x), bounds.width - width),
            y: Math.min(Math.max(0, placement.y), bounds.height - height),
          };
        })()
      : null;

  function placeSignature() {
    if (!signature || !bounds) return;
    const width = Math.min(bounds.width * 0.25, bounds.height * 0.5 * (signature.width / signature.height));
    const height = width * (signature.height / signature.width);
    setPlacement({
      width,
      height,
      x: (bounds.width - width) / 2,
      y: (bounds.height - height) / 2,
    });
  }

  const pdfRect =
    shown && pageGeom
      ? screenRectToPdfRect(pageGeom, scale, {
          x: shown.x * scale,
          y: shown.y * scale,
          width: shown.width * scale,
          height: shown.height * scale,
        })
      : null;

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
            <button disabled={!doc} onClick={placeSignature}>
              {placement ? "Reset placement" : "Place on page"}
            </button>
            {placement && <button onClick={() => setPlacement(null)}>Remove</button>}
          </>
        )}
      </header>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="viewer" ref={viewerRef}>
        {!doc && !error && <p className="hint">Open a PDF to get started.</p>}
        <div className="page" hidden={!doc}>
          <canvas ref={canvasRef} />
          {signature && shown && bounds && (
            <PlacementOverlay
              url={signature.url}
              rect={shown}
              scale={scale}
              bounds={bounds}
              onChange={setPlacement}
            />
          )}
        </div>
      </div>
      {pdfRect && (
        <footer className="status">
          Page {pageNum} · x {pdfRect.x.toFixed(1)} pt, y {pdfRect.y.toFixed(1)} pt ·{" "}
          {pdfRect.width.toFixed(1)} × {pdfRect.height.toFixed(1)} pt · Drag to move, corners to
          resize (Shift = free)
        </footer>
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
