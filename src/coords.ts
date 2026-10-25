/**
 * Mapping between the on-screen page preview and PDF user space.
 *
 * Screen space: CSS pixels, origin top-left of the rendered (already rotated) page.
 * PDF space: points, origin bottom-left of the unrotated page, offset by the page box.
 */

export interface PageGeometry {
  /** Visible page box [x0, y0, x1, y1] in PDF points (pdf.js `page.view`: CropBox ∩ MediaBox). */
  view: [number, number, number, number];
  /** Page `/Rotate` in degrees, clockwise. */
  rotate: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type Rotation = 0 | 90 | 180 | 270;

/**
 * A placement in PDF user space: the axis-aligned box the signature occupies
 * on the page, plus the page rotation the stamper must compensate for so the
 * image reads upright when the page is displayed.
 */
export interface PdfRect extends Rect {
  rotation: Rotation;
}

export function normalizeRotation(rotate: number): Rotation {
  const r = ((Math.round(rotate / 90) * 90) % 360 + 360) % 360;
  return r as Rotation;
}

/** Size of the page as displayed (after rotation), in points. */
export function displayedSize(g: PageGeometry): { width: number; height: number } {
  const w = g.view[2] - g.view[0];
  const h = g.view[3] - g.view[1];
  return normalizeRotation(g.rotate) % 180 === 0 ? { width: w, height: h } : { width: h, height: w };
}

/** Convert a screen point (CSS px, top-left origin) to PDF user space. */
export function screenToPdfPoint(
  g: PageGeometry,
  scale: number,
  sx: number,
  sy: number,
): { x: number; y: number } {
  const [x0, y0, x1, y1] = g.view;
  const u = sx / scale;
  const v = sy / scale;
  switch (normalizeRotation(g.rotate)) {
    case 0:
      return { x: x0 + u, y: y1 - v };
    case 90:
      return { x: x0 + v, y: y0 + u };
    case 180:
      return { x: x1 - u, y: y0 + v };
    case 270:
      return { x: x1 - v, y: y1 - u };
  }
}

/** Convert a screen rectangle (CSS px, top-left origin) to a PDF-space placement. */
export function screenRectToPdfRect(g: PageGeometry, scale: number, rect: Rect): PdfRect {
  const a = screenToPdfPoint(g, scale, rect.x, rect.y);
  const b = screenToPdfPoint(g, scale, rect.x + rect.width, rect.y + rect.height);
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
    rotation: normalizeRotation(g.rotate),
  };
}
