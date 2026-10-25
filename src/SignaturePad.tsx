import { useCallback, useEffect, useRef, useState } from "react";

interface Point {
  x: number;
  y: number;
}

interface Props {
  onDone: (png: Uint8Array) => void;
  onCancel: () => void;
}

const PAD_WIDTH = 560;
const PAD_HEIGHT = 220;
const LINE_WIDTH = 3;
/** Transparent margin kept around the ink in the exported PNG. */
const EXPORT_PADDING = 6;
/** Export at 2x so the stamped signature stays crisp when scaled up. */
const EXPORT_SCALE = 2;

/** Trace a stroke through midpoints so freehand lines look smooth. */
function traceStroke(ctx: CanvasRenderingContext2D, pts: Point[]) {
  if (pts.length === 0) return;
  ctx.beginPath();
  if (pts.length === 1) {
    // A tap leaves a dot.
    ctx.arc(pts[0].x, pts[0].y, LINE_WIDTH / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i].x + pts[i + 1].x) / 2;
    const my = (pts[i].y + pts[i + 1].y) / 2;
    ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
  }
  const last = pts[pts.length - 1];
  ctx.lineTo(last.x, last.y);
  ctx.stroke();
}

function styleContext(ctx: CanvasRenderingContext2D) {
  ctx.strokeStyle = "#000";
  ctx.fillStyle = "#000";
  ctx.lineWidth = LINE_WIDTH;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
}

function exportPng(strokes: Point[][]): Promise<Uint8Array> {
  const pts = strokes.flat();
  const half = LINE_WIDTH / 2;
  const minX = Math.min(...pts.map((p) => p.x)) - half - EXPORT_PADDING;
  const minY = Math.min(...pts.map((p) => p.y)) - half - EXPORT_PADDING;
  const maxX = Math.max(...pts.map((p) => p.x)) + half + EXPORT_PADDING;
  const maxY = Math.max(...pts.map((p) => p.y)) + half + EXPORT_PADDING;

  // Drawn onto a fresh canvas that is never filled, so the background stays transparent.
  const out = document.createElement("canvas");
  out.width = Math.ceil((maxX - minX) * EXPORT_SCALE);
  out.height = Math.ceil((maxY - minY) * EXPORT_SCALE);
  const ctx = out.getContext("2d")!;
  ctx.scale(EXPORT_SCALE, EXPORT_SCALE);
  ctx.translate(-minX, -minY);
  styleContext(ctx);
  for (const stroke of strokes) traceStroke(ctx, stroke);

  return new Promise((resolve, reject) => {
    out.toBlob(async (blob) => {
      if (!blob) return reject(new Error("Could not export the drawing."));
      resolve(new Uint8Array(await blob.arrayBuffer()));
    }, "image/png");
  });
}

export default function SignaturePad({ onDone, onCancel }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [strokes, setStrokes] = useState<Point[][]>([]);
  const current = useRef<Point[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const redraw = useCallback((all: Point[][], live: Point[] | null) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, PAD_WIDTH, PAD_HEIGHT);
    styleContext(ctx);
    for (const s of all) traceStroke(ctx, s);
    if (live) traceStroke(ctx, live);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = PAD_WIDTH * dpr;
    canvas.height = PAD_HEIGHT * dpr;
  }, []);

  useEffect(() => redraw(strokes, null), [strokes, redraw]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  function pointAt(e: React.PointerEvent<HTMLCanvasElement>): Point {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * PAD_WIDTH,
      y: ((e.clientY - rect.top) / rect.height) * PAD_HEIGHT,
    };
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    current.current = [pointAt(e)];
    redraw(strokes, current.current);
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!current.current) return;
    current.current.push(pointAt(e));
    redraw(strokes, current.current);
  }

  function endStroke() {
    const stroke = current.current;
    current.current = null;
    if (stroke) setStrokes((prev) => [...prev, stroke]);
  }

  async function confirm() {
    try {
      onDone(await exportPng(strokes));
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Draw signature">
      <div className="modal">
        <h2>Draw your signature</h2>
        <canvas
          ref={canvasRef}
          className="pad"
          style={{ width: PAD_WIDTH, height: PAD_HEIGHT }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endStroke}
          onPointerCancel={endStroke}
        />
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button disabled={strokes.length === 0} onClick={() => setStrokes((s) => s.slice(0, -1))}>
            Undo
          </button>
          <button disabled={strokes.length === 0} onClick={() => setStrokes([])}>
            Clear
          </button>
          <span className="spacer" />
          <button onClick={onCancel}>Cancel</button>
          <button className="primary" disabled={strokes.length === 0} onClick={confirm}>
            Use signature
          </button>
        </div>
      </div>
    </div>
  );
}
