import { MAX_IMAGE_EDGE, MAX_IMAGE_PIXELS } from "../shared/imageResourceLimits";

export interface ChannelMultipliers {
  red: number;
  green: number;
  blue: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface PixelSelectionMask {
  width: number;
  height: number;
  pixels: Uint8Array;
}

/** Operations are deliberately binary at this boundary. Soft selection and mask
 * opacity use a different contract, so they cannot accidentally be treated as
 * interchangeable with a temporary pixel selection. */
export type SelectionOperation = "replace" | "add" | "subtract" | "intersect";

export function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0 || 0x6d2b79f5;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

export function mixChannelRange(
  output: Uint8ClampedArray,
  baseline: Uint8ClampedArray,
  start: number,
  end: number,
  multipliers: ChannelMultipliers,
): void {
  for (let index = start; index < end; index += 4) {
    output[index] = baseline[index] * multipliers.red / 100;
    output[index + 1] = baseline[index + 1] * multipliers.green / 100;
    output[index + 2] = baseline[index + 2] * multipliers.blue / 100;
  }
}

export function interpolatedPoints(start: Point, end: Point, spacing: number): Point[] {
  const distance = Math.hypot(end.x - start.x, end.y - start.y);
  const steps = Math.max(1, Math.ceil(distance / Math.max(0.1, spacing)));
  return Array.from({ length: steps }, (_, index) => {
    const progress = (index + 1) / steps;
    return { x: start.x + (end.x - start.x) * progress, y: start.y + (end.y - start.y) * progress };
  });
}

export function rectangularSelectionMask(width: number, height: number, start: Point, end: Point): PixelSelectionMask {
  assertSelectionDimensions(width, height);
  const pixels = new Uint8Array(width * height);
  const minX = Math.max(0, Math.min(width - 1, Math.floor(Math.min(start.x, end.x))));
  const maxX = Math.max(0, Math.min(width - 1, Math.floor(Math.max(start.x, end.x))));
  const minY = Math.max(0, Math.min(height - 1, Math.floor(Math.min(start.y, end.y))));
  const maxY = Math.max(0, Math.min(height - 1, Math.floor(Math.max(start.y, end.y))));
  for (let y = minY; y <= maxY; y += 1) pixels.fill(1, y * width + minX, y * width + maxX + 1);
  return { width, height, pixels };
}

export function ellipticalSelectionMask(width: number, height: number, start: Point, end: Point): PixelSelectionMask {
  assertSelectionDimensions(width, height);
  const pixels = new Uint8Array(width * height);
  const left = Math.max(0, Math.min(width - 1, Math.floor(Math.min(start.x, end.x))));
  const right = Math.max(0, Math.min(width - 1, Math.floor(Math.max(start.x, end.x))));
  const top = Math.max(0, Math.min(height - 1, Math.floor(Math.min(start.y, end.y))));
  const bottom = Math.max(0, Math.min(height - 1, Math.floor(Math.max(start.y, end.y))));
  const centerX = (left + right) / 2;
  const centerY = (top + bottom) / 2;
  // A one-pixel drag is still a useful point selection rather than a divide-by-zero case.
  const radiusX = Math.max(.5, (right - left + 1) / 2);
  const radiusY = Math.max(.5, (bottom - top + 1) / 2);
  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) {
      const normalizedX = (x - centerX) / radiusX;
      const normalizedY = (y - centerY) / radiusY;
      if (normalizedX * normalizedX + normalizedY * normalizedY <= 1) pixels[y * width + x] = 1;
    }
  }
  return { width, height, pixels };
}

/** Rasterizes a closed lasso or polygon using the even-odd fill rule. */
export function polygonSelectionMask(width: number, height: number, points: readonly Point[]): PixelSelectionMask {
  assertSelectionDimensions(width, height);
  if (points.length < 3 || points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) {
    throw new Error("A polygon selection needs at least three finite points");
  }
  const pixels = new Uint8Array(width * height);
  const minY = Math.max(0, Math.floor(Math.min(...points.map((point) => point.y))));
  const maxY = Math.min(height - 1, Math.floor(Math.max(...points.map((point) => point.y))));
  for (let y = minY; y <= maxY; y += 1) {
    const scanY = y + .5;
    const intersections: number[] = [];
    for (let index = 0; index < points.length; index += 1) {
      const a = points[index];
      const b = points[(index + 1) % points.length];
      if ((a.y > scanY) === (b.y > scanY)) continue;
      intersections.push(a.x + (scanY - a.y) * (b.x - a.x) / (b.y - a.y));
    }
    intersections.sort((a, b) => a - b);
    for (let index = 0; index + 1 < intersections.length; index += 2) {
      const left = Math.max(0, Math.ceil(intersections[index] - .5));
      const right = Math.min(width - 1, Math.floor(intersections[index + 1] - .5));
      if (right >= left) pixels.fill(1, y * width + left, y * width + right + 1);
    }
  }
  return { width, height, pixels };
}

export function combineSelectionMask(
  current: PixelSelectionMask | null,
  candidate: PixelSelectionMask,
  operation: SelectionOperation,
): PixelSelectionMask {
  assertSelectionDimensions(candidate.width, candidate.height);
  if (candidate.pixels.length !== candidate.width * candidate.height) throw new Error("Invalid selection pixel buffer");
  if (!current || operation === "replace") return { width: candidate.width, height: candidate.height, pixels: new Uint8Array(candidate.pixels) };
  if (current.width !== candidate.width || current.height !== candidate.height || current.pixels.length !== candidate.pixels.length) {
    throw new Error("Selection dimensions do not match");
  }
  const pixels = new Uint8Array(candidate.pixels.length);
  for (let index = 0; index < pixels.length; index += 1) {
    const existing = current.pixels[index] !== 0;
    const incoming = candidate.pixels[index] !== 0;
    pixels[index] = Number(operation === "add" ? existing || incoming
      : operation === "subtract" ? existing && !incoming
        : existing && incoming);
  }
  return { width: candidate.width, height: candidate.height, pixels };
}

export function invertSelectionMask(selection: PixelSelectionMask): PixelSelectionMask {
  assertSelectionDimensions(selection.width, selection.height);
  if (selection.pixels.length !== selection.width * selection.height) throw new Error("Invalid selection pixel buffer");
  const pixels = new Uint8Array(selection.pixels.length);
  for (let index = 0; index < pixels.length; index += 1) pixels[index] = selection.pixels[index] ? 0 : 1;
  return { width: selection.width, height: selection.height, pixels };
}

/** Restores pixels outside a raster-local binary selection in a changed tile.
 * The caller owns tile capture and writes the returned buffer, keeping selection
 * enforcement compatible with the existing tile-diff undo budget. */
export function constrainRgbaToSelection(
  before: Uint8ClampedArray, after: Uint8ClampedArray, selection: PixelSelectionMask,
  tileX: number, tileY: number, width: number, height: number,
): Uint8ClampedArray {
  if (before.length !== after.length || before.length !== width * height * 4) throw new Error("Invalid tile pixel buffer");
  if (selection.width <= 0 || selection.height <= 0 || selection.pixels.length !== selection.width * selection.height) throw new Error("Invalid selection pixel buffer");
  const constrained = new Uint8ClampedArray(after);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const selectionX = tileX + x;
    const selectionY = tileY + y;
    if (selectionX >= 0 && selectionY >= 0 && selectionX < selection.width && selectionY < selection.height && selection.pixels[selectionY * selection.width + selectionX]) continue;
    const offset = (y * width + x) * 4;
    constrained[offset] = before[offset]; constrained[offset + 1] = before[offset + 1];
    constrained[offset + 2] = before[offset + 2]; constrained[offset + 3] = before[offset + 3];
  }
  return constrained;
}

export function contiguousColorSelectionMask(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  seed: Point,
  tolerance: number,
): PixelSelectionMask {
  assertSelectionDimensions(width, height);
  if (rgba.length !== width * height * 4) throw new Error("Invalid pixel buffer length");
  const seedX = Math.max(0, Math.min(width - 1, Math.floor(seed.x)));
  const seedY = Math.max(0, Math.min(height - 1, Math.floor(seed.y)));
  const threshold = Math.max(0, Math.min(255, tolerance));
  const targetOffset = (seedY * width + seedX) * 4;
  const target = [rgba[targetOffset], rgba[targetOffset + 1], rgba[targetOffset + 2], rgba[targetOffset + 3]];
  const pixels = new Uint8Array(width * height);
  const stack = [seedY * width + seedX];
  const matches = (index: number) => {
    const offset = index * 4;
    return Math.max(
      Math.abs(rgba[offset] - target[0]),
      Math.abs(rgba[offset + 1] - target[1]),
      Math.abs(rgba[offset + 2] - target[2]),
      Math.abs(rgba[offset + 3] - target[3]),
    ) <= threshold;
  };

  while (stack.length) {
    const seedIndex = stack.pop() as number;
    if (pixels[seedIndex] || !matches(seedIndex)) continue;
    const y = Math.floor(seedIndex / width);
    let x = seedIndex % width;
    while (x > 0 && !pixels[y * width + x - 1] && matches(y * width + x - 1)) x -= 1;
    let spanAbove = false;
    let spanBelow = false;
    for (; x < width; x += 1) {
      const index = y * width + x;
      if (pixels[index] || !matches(index)) break;
      pixels[index] = 1;
      if (y > 0) {
        const above = index - width;
        if (!pixels[above] && matches(above)) {
          if (!spanAbove) stack.push(above);
          spanAbove = true;
        } else spanAbove = false;
      }
      if (y < height - 1) {
        const below = index + width;
        if (!pixels[below] && matches(below)) {
          if (!spanBelow) stack.push(below);
          spanBelow = true;
        } else spanBelow = false;
      }
    }
  }
  return { width, height, pixels };
}

export function clearSelectedTile(
  rgba: Uint8ClampedArray, selection: PixelSelectionMask, tileX: number, tileY: number, width: number, height: number,
): Uint8ClampedArray {
  assertSelectionDimensions(selection.width, selection.height);
  if (selection.pixels.length !== selection.width * selection.height || rgba.length !== width * height * 4
    || !Number.isInteger(tileX) || !Number.isInteger(tileY) || !Number.isInteger(width) || !Number.isInteger(height)
    || tileX < 0 || tileY < 0 || width < 1 || height < 1 || tileX + width > selection.width || tileY + height > selection.height) {
    throw new Error("Selection dimensions do not match tile buffer");
  }
  const output = new Uint8ClampedArray(rgba);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    if (selection.pixels[(tileY + y) * selection.width + tileX + x]) output.fill(0, (y * width + x) * 4, (y * width + x + 1) * 4);
  }
  return output;
}

export function selectedTileRects(selection: PixelSelectionMask, edge: number): Array<{ x: number; y: number; width: number; height: number }> {
  assertSelectionDimensions(selection.width, selection.height);
  if (selection.pixels.length !== selection.width * selection.height || !Number.isInteger(edge) || edge < 1) {
    throw new Error("Invalid selection tile dimensions");
  }
  const columns = Math.ceil(selection.width / edge);
  const flags = new Uint8Array(columns * Math.ceil(selection.height / edge));
  for (let index = 0; index < selection.pixels.length; index += 1) {
    if (!selection.pixels[index]) continue;
    const x = index % selection.width, y = Math.floor(index / selection.width);
    flags[Math.floor(y / edge) * columns + Math.floor(x / edge)] = 1;
  }
  const rects = [];
  for (let index = 0; index < flags.length; index += 1) {
    if (!flags[index]) continue;
    const x = (index % columns) * edge, y = Math.floor(index / columns) * edge;
    rects.push({ x, y, width: Math.min(edge, selection.width - x), height: Math.min(edge, selection.height - y) });
  }
  return rects;
}

function assertSelectionDimensions(width: number, height: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0
    || width > MAX_IMAGE_EDGE || height > MAX_IMAGE_EDGE || width * height > MAX_IMAGE_PIXELS) {
    throw new Error("Invalid selection dimensions");
  }
}
