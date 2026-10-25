import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import "./App.css";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [doc, setDoc] = useState<pdfjs.PDFDocumentProxy | null>(null);
  const [pageNum, setPageNum] = useState(1);
  const [error, setError] = useState<string | null>(null);

  async function openPdf() {
    setError(null);
    const path = await open({
      multiple: false,
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (!path) return;
    try {
      const bytes = await invoke<ArrayBuffer>("read_file", { path });
      const loaded = await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise;
      setDoc(loaded);
      setPageNum(1);
    } catch (e) {
      setError(String(e));
    }
  }

  useEffect(() => {
    if (!doc || !canvasRef.current) return;
    const canvas = canvasRef.current;
    let cancelled = false;
    (async () => {
      const page = await doc.getPage(pageNum);
      const viewport = page.getViewport({ scale: 1.25 });
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const task = page.render({ canvas, viewport });
      try {
        await task.promise;
      } catch {
        if (cancelled) return;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [doc, pageNum]);

  return (
    <main className="app">
      <header className="toolbar">
        <button onClick={openPdf}>Open PDF…</button>
        {doc && (
          <>
            <button disabled={pageNum <= 1} onClick={() => setPageNum((n) => n - 1)}>
              ‹
            </button>
            <span>
              {pageNum} / {doc.numPages}
            </span>
            <button disabled={pageNum >= doc.numPages} onClick={() => setPageNum((n) => n + 1)}>
              ›
            </button>
          </>
        )}
      </header>
      {error && <p className="error">{error}</p>}
      <canvas ref={canvasRef} />
    </main>
  );
}

export default App;
