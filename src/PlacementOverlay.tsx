import { useRef } from "react";
import type { Rect } from "./coords";

interface Props {
  url: string;
  /** Placement in displayed-page points (top-left origin), independent of zoom. */
  rect: Rect;
  /** CSS pixels per point. */
  scale: number;
  /** Displayed page size in points; the overlay is kept inside it. */
  bounds: { width: number; height: number };
  onChange: (rect: Rect) => void;
}

type Corner = "nw" | "ne" | "sw" | "se";

const MIN_SIZE = 12;
const CORNERS: Corner[] = ["nw", "ne", "sw", "se"];

interface Drag {
  kind: "move" | Corner;
  startX: number;
  startY: number;
  origin: Rect;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export default function PlacementOverlay({ url, rect, scale, bounds, onChange }: Props) {
  const drag = useRef<Drag | null>(null);
  const aspect = rect.width / rect.height;

  function begin(kind: Drag["kind"], e: React.PointerEvent) {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { kind, startX: e.clientX, startY: e.clientY, origin: rect };
  }

  function move(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.startX) / scale;
    const dy = (e.clientY - d.startY) / scale;
    const o = d.origin;

    if (d.kind === "move") {
      onChange({
        ...o,
        x: clamp(o.x + dx, 0, bounds.width - o.width),
        y: clamp(o.y + dy, 0, bounds.height - o.height),
      });
      return;
    }

    // Resize: the corner opposite the handle stays fixed.
    const sx = d.kind.endsWith("e") ? 1 : -1;
    const sy = d.kind.startsWith("s") ? 1 : -1;
    const ax = sx === 1 ? o.x : o.x + o.width;
    const ay = sy === 1 ? o.y : o.y + o.height;
    const px = (sx === 1 ? o.x + o.width : o.x) + dx;
    const py = (sy === 1 ? o.y + o.height : o.y) + dy;

    const maxW = sx === 1 ? bounds.width - ax : ax;
    const maxH = sy === 1 ? bounds.height - ay : ay;
    let w = Math.max(MIN_SIZE, (px - ax) * sx);
    let h = Math.max(MIN_SIZE, (py - ay) * sy);

    if (e.shiftKey) {
      // Shift = free resize.
      w = Math.min(w, maxW);
      h = Math.min(h, maxH);
    } else {
      w = Math.min(Math.max(w, h * aspect), maxW, maxH * aspect);
      h = w / aspect;
    }
    onChange({ x: sx === 1 ? ax : ax - w, y: sy === 1 ? ay : ay - h, width: w, height: h });
  }

  function end() {
    drag.current = null;
  }

  return (
    <div
      className="placement"
      style={{
        left: rect.x * scale,
        top: rect.y * scale,
        width: rect.width * scale,
        height: rect.height * scale,
      }}
      onPointerDown={(e) => begin("move", e)}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
    >
      <img src={url} alt="Signature to place" draggable={false} />
      {CORNERS.map((c) => (
        <div
          key={c}
          className={`handle handle-${c}`}
          onPointerDown={(e) => begin(c, e)}
        />
      ))}
    </div>
  );
}
