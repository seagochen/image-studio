import type { DrawingLayer, ImageStudioDocument, RasterLayer } from "./document";
import { renderDrawingLayer } from "./exportImage";
import { clearSelectedTile, selectedTileRects, type PixelSelectionMask } from "./pixelTools";
import { applyPixelTileDiffs, PIXEL_HISTORY_TILE_EDGE, PixelTileRecorder, type PixelTileDiff } from "./pixelTileHistory";

export function editedRasterMimeType(sourceMimeType: string, scoped: boolean, requiresAlpha = false): string {
  return scoped || requiresAlpha ? "image/png"
    : (["image/png", "image/jpeg", "image/webp"].includes(sourceMimeType) ? sourceMimeType : "image/png");
}

/** Resolves the editable fraction of each raster pixel. Null means unrestricted. */
export function resolveRasterEditCoverage(
  document: ImageStudioDocument, layer: RasterLayer, selection: PixelSelectionMask | null,
  createCanvas: (width: number, height: number) => HTMLCanvasElement = defaultCanvas,
): Uint8Array | null {
  const length = layer.width * layer.height;
  if (selection && (selection.width !== layer.width || selection.height !== layer.height || selection.pixels.length !== length)) {
    throw new Error("Selection dimensions do not match raster layer");
  }
  let coverage: Uint8Array | null = null;
  if (layer.rasterMaskId) {
    const mask = document.layers.find((candidate) => candidate.id === layer.rasterMaskId);
    if (!mask || mask.type !== "mask" || mask.parentId !== layer.parentId || mask.width !== layer.width || mask.height !== layer.height) {
      throw new Error("Raster mask binding is invalid");
    }
    coverage = coverageFromDrawingMask(mask, layer.rasterMaskInverted === true, layer.rasterMaskFeatherPx ?? 0, createCanvas);
  }
  if (selection) {
    coverage ??= new Uint8Array(length).fill(255);
    for (let index = 0; index < length; index += 1) if (!selection.pixels[index]) coverage[index] = 0;
  }
  return coverage;
}

/** Blends an operation with the unchanged source in premultiplied alpha space. */
export function constrainRgbaToCoverage(
  before: Uint8ClampedArray, after: Uint8ClampedArray, coverage: Uint8Array,
  rasterWidth: number, rasterHeight: number, tileX: number, tileY: number, width: number, height: number,
): Uint8ClampedArray {
  if (coverage.length !== rasterWidth * rasterHeight || before.length !== after.length || before.length !== width * height * 4) {
    throw new Error("Edit coverage and pixel buffer dimensions do not match");
  }
  const output = new Uint8ClampedArray(after);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const rasterX = tileX + x, rasterY = tileY + y;
    const weight = rasterX < 0 || rasterY < 0 || rasterX >= rasterWidth || rasterY >= rasterHeight
      ? 0 : coverage[rasterY * rasterWidth + rasterX];
    if (weight === 255) continue;
    const offset = (y * width + x) * 4;
    if (weight === 0) { output.set(before.subarray(offset, offset + 4), offset); continue; }
    const beforeAlpha = before[offset + 3], afterAlpha = after[offset + 3];
    const weightedAlpha = beforeAlpha * (255 - weight) + afterAlpha * weight;
    const outputAlpha = Math.round(weightedAlpha / 255);
    for (let channel = 0; channel < 3; channel += 1) {
      output[offset + channel] = outputAlpha === 0 ? 0 : Math.round(
        (before[offset + channel] * beforeAlpha * (255 - weight) + after[offset + channel] * afterAlpha * weight) / weightedAlpha,
      );
    }
    output[offset + 3] = outputAlpha;
  }
  return output;
}

export function coverageFromDrawingMask(
  mask: DrawingLayer, inverted: boolean, featherPx: number,
  createCanvas: (width: number, height: number) => HTMLCanvasElement,
): Uint8Array {
  if (!Number.isFinite(featherPx) || featherPx < 0 || featherPx > 256) throw new Error("Invalid raster mask feather");
  let canvas = renderDrawingLayer(mask, createCanvas);
  if (featherPx > 0) {
    const padding = Math.ceil(featherPx * 3);
    const blurred = createCanvas(mask.width + padding * 2, mask.height + padding * 2);
    const context = blurred.getContext("2d");
    if (!context) throw new Error("Raster mask canvas is unavailable");
    context.filter = `blur(${featherPx}px)`;
    context.drawImage(canvas, padding, padding);
    canvas.width = 1; canvas.height = 1;
    canvas = blurred;
  }
  try {
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Raster mask canvas is unavailable");
    const padding = featherPx > 0 ? Math.ceil(featherPx * 3) : 0;
    const coverage = new Uint8Array(mask.width * mask.height);
    const rowsPerChunk = Math.max(1, Math.floor(1_048_576 / mask.width));
    for (let y = 0; y < mask.height; y += rowsPerChunk) {
      const rows = Math.min(rowsPerChunk, mask.height - y);
      const image = context.getImageData(padding, padding + y, mask.width, rows).data;
      for (let index = 0; index < mask.width * rows; index += 1) {
        const offset = index * 4;
        const value = Math.round(image[offset + 3] * (image[offset] + image[offset + 1] + image[offset + 2]) / 765);
        coverage[y * mask.width + index] = inverted ? 255 - value : value;
      }
    }
    return coverage;
  } finally { canvas.width = 1; canvas.height = 1; }
}

/** Erases selected tiles transactionally; the caller handles source encoding and document history. */
export function eraseSelectedRasterTiles(
  canvas: HTMLCanvasElement, selection: PixelSelectionMask, coverage: Uint8Array | null,
  canRecordBytes: (bytes: number) => boolean, canRecordDiffs: (diffs: readonly PixelTileDiff[]) => boolean,
): PixelTileDiff[] {
  if (canvas.width !== selection.width || canvas.height !== selection.height
    || (coverage && coverage.length !== selection.width * selection.height)) {
    throw new Error("Selection dimensions do not match raster canvas");
  }
  const tiles = selectedTileRects(selection, PIXEL_HISTORY_TILE_EDGE);
  if (!tiles.length) return [];
  const historyBytes = tiles.reduce((total, tile) => total + tile.width * tile.height * 8, 0);
  if (!canRecordBytes(historyBytes)) throw new Error("Selection edit exceeds history budget");
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Pixel history canvas is unavailable");
  const recorder = new PixelTileRecorder(canvas);
  try {
    for (const tile of tiles) {
      recorder.capture(tile.x, tile.y, tile.width, tile.height);
      const image = context.getImageData(tile.x, tile.y, tile.width, tile.height);
      const candidate = clearSelectedTile(image.data, selection, tile.x, tile.y, tile.width, tile.height);
      image.data.set(coverage ? constrainRgbaToCoverage(image.data, candidate, coverage,
        canvas.width, canvas.height, tile.x, tile.y, tile.width, tile.height) : candidate);
      context.putImageData(image, tile.x, tile.y);
    }
    const diffs = recorder.finish();
    if (diffs.length && !canRecordDiffs(diffs)) throw new Error("Selection edit exceeds history budget");
    return diffs;
  } catch (error) {
    applyPixelTileDiffs(canvas, recorder.finish(), "before");
    throw error;
  }
}

function defaultCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = window.document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  return canvas;
}
