import type { DrawingLayer } from "../domain/document";
import { coverageFromDrawingMask } from "../domain/editCoverage";
import type { PixelSelectionMask } from "../domain/pixelTools";

/** Encodes Image Studio's local mask sources for models whose manifest declares mask_file.
 * White marks the editable region and black protects it; alpha is deliberately opaque so
 * external model runtimes do not have to infer transparency semantics. */
export async function maskInputFromSelection(selection: PixelSelectionMask): Promise<Blob> {
  const canvas = createCanvas(selection.width, selection.height);
  try {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Mask encoding is unavailable");
    const image = context.createImageData(selection.width, selection.height);
    for (let index = 0; index < selection.pixels.length; index += 1) {
      const value = selection.pixels[index] ? 255 : 0;
      const offset = index * 4;
      image.data[offset] = value; image.data[offset + 1] = value; image.data[offset + 2] = value; image.data[offset + 3] = 255;
    }
    context.putImageData(image, 0, 0);
    return await canvasBlob(canvas);
  } finally { canvas.width = 1; canvas.height = 1; }
}

export async function maskInputFromLayer(
  layer: DrawingLayer, options: { inverted?: boolean; featherPx?: number } = {}, selection?: PixelSelectionMask | null,
): Promise<Blob> {
  const coverage = coverageFromDrawingMask(layer, options.inverted === true, options.featherPx ?? 0, createCanvas);
  const canvas = createCanvas(layer.width, layer.height);
  try {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Mask encoding is unavailable");
    const image = context.createImageData(layer.width, layer.height);
    for (let index = 0; index < coverage.length; index += 1) {
      const value = coverage[index];
      const offset = index * 4;
      image.data[offset] = value; image.data[offset + 1] = value; image.data[offset + 2] = value; image.data[offset + 3] = 255;
    }
    if (selection) {
      intersectOpaqueMaskData(image.data, canvas.width, canvas.height, selection);
    }
    context.putImageData(image, 0, 0);
    return await canvasBlob(canvas);
  }
  finally { canvas.width = 1; canvas.height = 1; }
}

/** A temporary selection narrows a durable mask; it must never replace it. */
export function intersectOpaqueMaskData(
  rgba: Uint8ClampedArray, width: number, height: number, selection: PixelSelectionMask,
): void {
  if (selection.width !== width || selection.height !== height || selection.pixels.length !== width * height || rgba.length !== width * height * 4) {
    throw new Error("Selection and mask dimensions do not match");
  }
  for (let index = 0; index < selection.pixels.length; index += 1) {
    if (selection.pixels[index]) continue;
    const offset = index * 4;
    rgba[offset] = 0; rgba[offset + 1] = 0; rgba[offset + 2] = 0; rgba[offset + 3] = 255;
  }
}

function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = window.document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob(
    (blob) => blob ? resolve(blob) : reject(new Error("The browser could not encode the mask")), "image/png",
  ));
}
