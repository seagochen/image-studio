import type { AdjustmentDefinition, AdjustmentLayer, DrawingLayer, ImageStudioDocument, LayerBlendMode, RasterLayer } from "./document";
import { layerIsEditable } from "./layerHierarchy";
import { adjustmentKernel, isSpatialAdjustment } from "./adjustmentEngine";
import { renderDrawingLayer } from "./exportImage";
import { clearSelectedTile, selectedTileRects, type PixelSelectionMask } from "./pixelTools";
import { applyPixelTileDiffs, PIXEL_HISTORY_TILE_EDGE, PixelTileRecorder, type PixelTileDiff } from "./pixelTileHistory";
import { decodeSelectionRuns } from "./selectionMaskRuns";

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
  try {
    if (featherPx > 0) {
      const padding = Math.ceil(featherPx * 3);
      const blurred = createCanvas(mask.width + padding * 2, mask.height + padding * 2);
      try {
        const context = blurred.getContext("2d");
        if (!context) throw new Error("Raster mask canvas is unavailable");
        context.filter = `blur(${featherPx}px)`;
        context.drawImage(canvas, padding, padding);
      } catch (error) { blurred.width = 1; blurred.height = 1; throw error; }
      canvas.width = 1; canvas.height = 1;
      canvas = blurred;
    }
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Raster mask canvas is unavailable");
    const padding = featherPx > 0 ? Math.ceil(featherPx * 3) : 0;
    const coverage = new Uint8Array(mask.width * mask.height);
    const clip = mask.clipRuns ? decodeSelectionRuns(mask.clipRuns, mask.width, mask.height) : null;
    const rowsPerChunk = Math.max(1, Math.floor(1_048_576 / mask.width));
    for (let y = 0; y < mask.height; y += rowsPerChunk) {
      const rows = Math.min(rowsPerChunk, mask.height - y);
      const image = context.getImageData(padding, padding + y, mask.width, rows).data;
      for (let index = 0; index < mask.width * rows; index += 1) {
        const offset = index * 4;
        const value = Math.round(image[offset + 3] * (image[offset] + image[offset + 1] + image[offset + 2]) / 765);
        const position = y * mask.width + index;
        coverage[position] = clip && (clip[position] !== 0) === (mask.clipInverted === true) ? 0 : inverted ? 255 - value : value;
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

/** A selected bake changes only one raw Raster; complex stacks keep the non-destructive layer path. */
export function canBakeSelectedAdjustment(document: ImageStudioDocument, sourceId: string,
  selection: PixelSelectionMask, adjustment: AdjustmentLayer): boolean {
  const source = document.layers.find((layer) => layer.id === sourceId);
  if (!source || source.type !== "raster" || !source.visible || !layerIsEditable(document.layers, sourceId)
    || source.opacity !== 1 || source.blendMode !== "normal" || adjustment.locked
    || isSpatialAdjustment(adjustment.adjustment.kind)
    || source.width !== selection.width || source.height !== selection.height
    || selection.pixels.length !== source.width * source.height) return false;
  return !document.layers.some((layer) => layer.id !== sourceId && layer.type !== "mask"
    && layer.visible && layer.opacity > 0 && (layer.parentId ?? null) === (source.parentId ?? null));
}

/** Bakes a color adjustment only into selected, mask-authorized raster tiles. */
export function bakeSelectedAdjustmentTiles(
  canvas: HTMLCanvasElement, selection: PixelSelectionMask, coverage: Uint8Array,
  adjustment: AdjustmentDefinition, opacity: number, blendMode: LayerBlendMode,
  canRecordBytes: (bytes: number) => boolean, canRecordDiffs: (diffs: readonly PixelTileDiff[]) => boolean,
): PixelTileDiff[] {
  if (isSpatialAdjustment(adjustment.kind)) throw new Error("Spatial adjustment requires a halo-aware bake");
  if (canvas.width !== selection.width || canvas.height !== selection.height
    || selection.pixels.length !== canvas.width * canvas.height || coverage.length !== selection.pixels.length) {
    throw new Error("Selection dimensions do not match raster canvas");
  }
  const tiles = selectedTileRects(selection, PIXEL_HISTORY_TILE_EDGE);
  const bytes = tiles.reduce((total, tile) => total + tile.width * tile.height * 8, 0);
  if (!tiles.length || !canRecordBytes(bytes)) throw new Error("Selection adjustment exceeds history budget");
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Pixel history canvas is unavailable");
  const kernel = adjustmentKernel(adjustment, opacity, blendMode);
  const recorder = new PixelTileRecorder(canvas);
  try {
    for (const tile of tiles) {
      recorder.capture(tile.x, tile.y, tile.width, tile.height);
      const before = context.getImageData(tile.x, tile.y, tile.width, tile.height);
      const adjusted = new Uint8ClampedArray(before.data);
      kernel(adjusted);
      before.data.set(constrainRgbaToCoverage(before.data, adjusted, coverage,
        canvas.width, canvas.height, tile.x, tile.y, tile.width, tile.height));
      context.putImageData(before, tile.x, tile.y);
    }
    const diffs = recorder.finish();
    if (diffs.length && !canRecordDiffs(diffs)) throw new Error("Selection adjustment exceeds history budget");
    return diffs;
  } catch (error) {
    applyPixelTileDiffs(canvas, recorder.finish(), "before");
    throw error;
  }
}

/** Copies selected visible pixels into a cropped image without changing the source. */
export function copySelectedRasterTiles(
  canvas: HTMLCanvasElement, selection: PixelSelectionMask, coverage: Uint8Array | null,
  canRecordBytes: (bytes: number) => boolean,
  createCanvas: (width: number, height: number) => HTMLCanvasElement = defaultCanvas,
): { image: HTMLCanvasElement; x: number; y: number } {
  if (canvas.width !== selection.width || canvas.height !== selection.height
    || selection.pixels.length !== canvas.width * canvas.height
    || (coverage && coverage.length !== selection.pixels.length)) throw new Error("Selection dimensions do not match raster canvas");
  const tiles = selectedTileRects(selection, PIXEL_HISTORY_TILE_EDGE);
  const tileBytes = tiles.reduce((total, tile) => total + tile.width * tile.height * 8, 0);
  if (!tiles.length || !canRecordBytes(tileBytes)) throw new Error("Selection edit exceeds history budget");
  let left = canvas.width, top = canvas.height, right = 0, bottom = 0;
  for (let y = 0; y < canvas.height; y += 1) for (let x = 0; x < canvas.width; x += 1) {
    const index = y * canvas.width + x;
    if (!selection.pixels[index] || (coverage && !coverage[index])) continue;
    left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x + 1); bottom = Math.max(bottom, y + 1);
  }
  if (right <= left || bottom <= top) throw new Error("Selection has no visible pixels");
  const image = createCanvas(right - left, bottom - top);
  const sourceContext = canvas.getContext("2d", { willReadFrequently: true });
  const imageContext = image.getContext("2d", { willReadFrequently: true });
  try {
    if (!sourceContext || !imageContext) throw new Error("Pixel canvas is unavailable");
    const rowsPerChunk = Math.max(1, Math.floor(1_048_576 / image.width));
    for (let row = 0; row < image.height; row += rowsPerChunk) {
      const rows = Math.min(rowsPerChunk, image.height - row);
      const pixels = sourceContext.getImageData(left, top + row, image.width, rows);
      for (let index = 0; index < image.width * rows; index += 1) {
        const localX = index % image.width, localY = Math.floor(index / image.width);
        const coverageIndex = (top + row + localY) * canvas.width + left + localX;
        const weight = selection.pixels[coverageIndex] ? (coverage?.[coverageIndex] ?? 255) : 0;
        const offset = index * 4;
        pixels.data[offset + 3] = Math.round(pixels.data[offset + 3] * weight / 255);
        if (!pixels.data[offset + 3]) pixels.data.fill(0, offset, offset + 4);
      }
      imageContext.putImageData(pixels, 0, row);
    }
    return { image, x: left, y: top };
  } catch (error) {
    image.width = 1; image.height = 1;
    throw error;
  }
}

/** Copies before erasing so a failed extraction never changes the source. */
export function liftSelectedRasterTiles(
  canvas: HTMLCanvasElement, selection: PixelSelectionMask, coverage: Uint8Array | null,
  canRecordBytes: (bytes: number) => boolean, canRecordDiffs: (diffs: readonly PixelTileDiff[]) => boolean,
  createCanvas: (width: number, height: number) => HTMLCanvasElement = defaultCanvas,
): { image: HTMLCanvasElement; x: number; y: number; diffs: PixelTileDiff[] } {
  const copied = copySelectedRasterTiles(canvas, selection, coverage, canRecordBytes, createCanvas);
  try {
    const diffs = eraseSelectedRasterTiles(canvas, selection, null, canRecordBytes, canRecordDiffs);
    return { ...copied, diffs };
  } catch (error) {
    copied.image.width = 1; copied.image.height = 1;
    throw error;
  }
}

function defaultCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = window.document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  return canvas;
}
