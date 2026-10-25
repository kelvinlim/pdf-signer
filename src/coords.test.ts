import { describe, expect, it } from "vitest";
import {
  displayedSize,
  normalizeRotation,
  screenRectToPdfRect,
  type PageGeometry,
} from "./coords";

const letter = (rotate: number): PageGeometry => ({ view: [0, 0, 612, 792], rotate });
const rect = { x: 0, y: 0, width: 100, height: 50 };

describe("normalizeRotation", () => {
  it("wraps negative and large angles", () => {
    expect(normalizeRotation(-90)).toBe(270);
    expect(normalizeRotation(450)).toBe(90);
    expect(normalizeRotation(0)).toBe(0);
  });
});

describe("displayedSize", () => {
  it("swaps width and height for 90/270", () => {
    expect(displayedSize(letter(0))).toEqual({ width: 612, height: 792 });
    expect(displayedSize(letter(90))).toEqual({ width: 792, height: 612 });
    expect(displayedSize(letter(270))).toEqual({ width: 792, height: 612 });
    expect(displayedSize(letter(180))).toEqual({ width: 612, height: 792 });
  });
});

describe("screenRectToPdfRect", () => {
  it("flips the y axis for an upright page", () => {
    expect(screenRectToPdfRect(letter(0), 1, rect)).toEqual({
      x: 0,
      y: 742,
      width: 100,
      height: 50,
      rotation: 0,
    });
  });

  it("divides out the zoom scale", () => {
    const zoomed = { x: 0, y: 0, width: 200, height: 100 };
    expect(screenRectToPdfRect(letter(0), 2, zoomed)).toMatchObject({
      x: 0,
      y: 742,
      width: 100,
      height: 50,
    });
  });

  it("honours a CropBox offset", () => {
    const g: PageGeometry = { view: [10, 20, 622, 812], rotate: 0 };
    expect(screenRectToPdfRect(g, 1, rect)).toMatchObject({ x: 10, y: 762, width: 100, height: 50 });
  });

  it("maps a page rotated 90°", () => {
    expect(screenRectToPdfRect(letter(90), 1, rect)).toEqual({
      x: 0,
      y: 0,
      width: 50,
      height: 100,
      rotation: 90,
    });
  });

  it("maps a page rotated 180°", () => {
    expect(screenRectToPdfRect(letter(180), 1, rect)).toEqual({
      x: 512,
      y: 0,
      width: 100,
      height: 50,
      rotation: 180,
    });
  });

  it("maps a page rotated 270°", () => {
    expect(screenRectToPdfRect(letter(270), 1, rect)).toEqual({
      x: 562,
      y: 692,
      width: 50,
      height: 100,
      rotation: 270,
    });
  });

  it("keeps a rect in the bottom-right display corner in the matching PDF corner", () => {
    // Upright page: bottom-right of the screen is the PDF's bottom-right.
    const r = screenRectToPdfRect(letter(0), 1, { x: 512, y: 742, width: 100, height: 50 });
    expect(r).toMatchObject({ x: 512, y: 0, width: 100, height: 50 });
  });

  it("combines rotation, CropBox offset and zoom", () => {
    const g: PageGeometry = { view: [10, 20, 622, 812], rotate: 90 };
    const r = screenRectToPdfRect(g, 2, { x: 0, y: 0, width: 200, height: 100 });
    expect(r).toMatchObject({ x: 10, y: 20, width: 50, height: 100, rotation: 90 });
  });
});
