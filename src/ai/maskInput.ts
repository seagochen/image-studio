import type { DrawingLayer } from "../domain/document";
import { renderDrawingLayer } from "../domain/exportImage";
import type { PixelSelectionMask } from "../domain/pixelTools";

/** Encodes Image Studio's local mask sources for models whose manifest declares mask_file.
 * White marks the editable region and black protects it; alpha is deliberately opaque so
 * external model runtimes do not have to infer transparency semantics. */
export async function maskInputFromSelection(selection: PixelSelectionMask): Promise<Blob> {
  const canvas = createCanvas(selection.width, selection.height);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Mask encoding is unavailable");
  const image = context.createImageData(selection.width, selection.height);
  for (let index = 0; index < selection.pixels.length; index += 1) {
    const value = selection.pixels[index] ? 255 : 0;
    const offset = index * 4;
    image.data[offset] = value; image.data[offset + 1] = value; image.data[offset + 2] = value; image.data[offset + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  return canvasBlob(canvas);
}

export async function maskInputFromLayer(layer: DrawingLayer, options: { inverted?: boolean; featherPx?: number } = {}): Promise<Blob> {
  const canvas = renderDrawingLayer(layer, createCanvas);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Mask encoding is unavailable");
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  for (let index = 0; index < image.data.length; index += 4) {
    const value = Math.round(image.data[index + 3] / 255 * (image.data[index] + image.data[index + 1] + image.data[index + 2]) / 3);
    const output = options.inverted ? 255 - value : value;
    image.data[index] = output; image.data[index + 1] = output; image.data[index + 2] = output; image.data[index + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  if (options.featherPx && options.featherPx > 0) {
    const source = createCanvas(canvas.width, canvas.height);
    source.getContext("2d")?.drawImage(canvas, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.save(); context.filter = `blur(${options.featherPx}px)`; context.drawImage(source, 0, 0); context.restore();
    source.width = 1; source.height = 1;
  }
  try { return await canvasBlob(canvas); }
  finally { canvas.width = 1; canvas.height = 1; }
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
