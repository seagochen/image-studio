import type { DrawingLayer } from "./document";
import { decodeSelectionRuns } from "./selectionMaskRuns";
import { yieldRenderTask } from "./adjustmentEngine";
import { MASK_CHUNK_PIXELS } from "./exportMemoryPlan";
import { renderDrawingLayer } from "./layerRasterization";
import { releaseRenderCanvas, reserveRenderBytes, type RenderMemoryBudget } from "./renderMemory";

/** Applies grayscale×alpha mask weight, not merely its alpha channel. */
export async function applyRasterMask(
  target: HTMLCanvasElement, mask: DrawingLayer,
  createCanvas: (width: number, height: number) => HTMLCanvasElement, scale: number, inverted = false, featherPx = 0,
  dependencies: { signal?: AbortSignal; memoryBudget?: RenderMemoryBudget } = {},
): Promise<void> {
  await yieldRenderTask(dependencies.signal);
  let maskCanvas = renderDrawingLayer(mask, createCanvas, scale);
  const padding = featherPx > 0 ? Math.ceil(featherPx * scale * 3) : 0;
  let releaseClip = () => {};
  try {
    if (featherPx > 0) {
      const blurred = createCanvas(mask.width + padding * 2 / scale, mask.height + padding * 2 / scale);
      try {
        const blurredContext = blurred.getContext("2d");
        if (!blurredContext) throw new Error("Raster mask canvas is unavailable");
        blurredContext.filter = `blur(${featherPx * scale}px)`;
        blurredContext.drawImage(maskCanvas, padding, padding);
      } catch (error) { releaseRenderCanvas(blurred); throw error; }
      releaseRenderCanvas(maskCanvas);
      maskCanvas = blurred;
    }
    const maskContext = maskCanvas.getContext("2d", { willReadFrequently: true });
    const targetContext = target.getContext("2d");
    if (!maskContext || !targetContext) throw new Error("Raster mask canvas is unavailable");
    releaseClip = reserveRenderBytes(dependencies.memoryBudget, mask.clipRuns ? mask.width * mask.height : 0);
    const clip = mask.clipRuns ? decodeSelectionRuns(mask.clipRuns, mask.width, mask.height) : null;
    const contentWidth = maskCanvas.width - padding * 2, contentHeight = maskCanvas.height - padding * 2;
    const rows = Math.max(1, Math.floor(MASK_CHUNK_PIXELS / maskCanvas.width));
    for (let y = 0; y < maskCanvas.height; y += rows) {
      await yieldRenderTask(dependencies.signal);
      const chunkHeight = Math.min(rows, maskCanvas.height - y);
      const releaseChunk = reserveRenderBytes(dependencies.memoryBudget, maskCanvas.width * chunkHeight * 4);
      try {
        const image = maskContext.getImageData(0, y, maskCanvas.width, chunkHeight);
        for (let row = 0; row < chunkHeight; row += 1) for (let x = 0; x < maskCanvas.width; x += 1) {
          const index = (row * maskCanvas.width + x) * 4;
          const weight = image.data[index + 3] / 255 * (image.data[index] + image.data[index + 1] + image.data[index + 2]) / 765;
          let alpha = Math.round((inverted ? 1 - weight : weight) * 255);
          if (clip && x >= padding && x < padding + contentWidth && y + row >= padding && y + row < padding + contentHeight) {
            const sourceX = Math.min(mask.width - 1, Math.floor((x - padding) * mask.width / contentWidth));
            const sourceY = Math.min(mask.height - 1, Math.floor((y + row - padding) * mask.height / contentHeight));
            if ((clip[sourceY * mask.width + sourceX] !== 0) === (mask.clipInverted === true)) alpha = 0;
          }
          image.data[index] = 255; image.data[index + 1] = 255; image.data[index + 2] = 255; image.data[index + 3] = alpha;
        }
        maskContext.putImageData(image, 0, y);
      } finally { releaseChunk(); }
    }
    targetContext.save();
    try {
      // Both buffers are physical pixels; do not reuse the target's scaled context transform.
      targetContext.setTransform(1, 0, 0, 1, 0, 0);
      targetContext.globalCompositeOperation = "destination-in";
      targetContext.drawImage(maskCanvas, padding, padding, contentWidth, contentHeight, 0, 0, target.width, target.height);
    } finally { targetContext.restore(); }
  } finally {
    releaseClip();
    releaseRenderCanvas(maskCanvas);
  }
}
