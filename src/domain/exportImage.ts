import { canvasBlendMode, rasterSourceUrl, type AnnotationLayer, type DrawingLayer, type ImageStudioDocument, type ImageStudioLayer, type RasterLayer } from "./document";
import { paintSelectionRuns } from "./selectionMaskRuns";
import { createBrushDabs, renderBrushDabs } from "./brushEngine";
import { adjustmentKernel, ADJUSTMENT_CHUNK_PIXELS, applySpatialAdjustment, isSpatialAdjustment, spatialRadius, yieldRenderTask } from "./adjustmentEngine";
import { adjacentMaskLayerIds } from "./adjustmentMasking";
import { MAX_CANVAS_EDGE } from "../../../../frontend/src/shared/imageStudioDomain";

export type ExportFormat = "png" | "jpeg" | "webp";

export interface ExportOptions {
  format: ExportFormat;
  width: number;
  height: number;
  quality: number;
  jpegBackground: string;
}

export interface ExportPlan {
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  estimatedBytes: number;
  memoryRisk: boolean;
}

export const EXPORT_MEMORY_WARNING_BYTES = 128 * 1024 * 1024;
export const EXPORT_MEMORY_LIMIT_BYTES = 256 * 1024 * 1024;
export const EXPORT_MAX_EDGE = MAX_CANVAS_EDGE;

export function planExport(options: ExportOptions, document?: ImageStudioDocument): ExportPlan {
  if (!Number.isInteger(options.width) || !Number.isInteger(options.height) || options.width < 1 || options.height < 1
    || options.width > EXPORT_MAX_EDGE || options.height > EXPORT_MAX_EDGE) {
    throw new Error("Invalid export dimensions");
  }
  if (!Number.isFinite(options.quality) || options.quality < 0.1 || options.quality > 1) {
    throw new Error("Invalid export quality");
  }
  if (!/^#[0-9a-f]{6}$/i.test(options.jpegBackground)) throw new Error("Invalid JPEG background");
  const outputPixels = options.width * options.height;
  const largestDecodedLayer = document?.layers.reduce((largest, layer) => Math.max(largest, layer.width * layer.height), 0) ?? 0;
  const documentPixels = document ? document.canvas.width * document.canvas.height : 0;
  const groupBuffers = document ? 1 + maximumGroupDepth(document.layers) : 0;
  const estimatedBytes = outputPixels * 8 + largestDecodedLayer * 4 + documentPixels * (groupBuffers + 2) * 4;
  if (estimatedBytes > EXPORT_MEMORY_LIMIT_BYTES) throw new Error("Export exceeds the browser memory budget");
  return {
    mimeType: options.format === "png" ? "image/png" : options.format === "jpeg" ? "image/jpeg" : "image/webp",
    estimatedBytes,
    memoryRisk: estimatedBytes > EXPORT_MEMORY_WARNING_BYTES,
  };
}

export function maximumGroupDepth(layers: ImageStudioLayer[]): number {
  const groups = new Map(layers.filter((layer) => layer.type === "group").map((layer) => [layer.id, layer]));
  let maximum = 0;
  for (const layer of groups.values()) {
    let depth = 1;
    let parentId = layer.parentId ?? null;
    const visited = new Set([layer.id]);
    while (parentId && groups.has(parentId) && !visited.has(parentId)) {
      visited.add(parentId); depth += 1; parentId = groups.get(parentId)?.parentId ?? null;
    }
    maximum = Math.max(maximum, depth);
  }
  return maximum;
}

export async function exportImage(
  document: ImageStudioDocument,
  options: ExportOptions,
  dependencies: {
    createCanvas?: (width: number, height: number) => HTMLCanvasElement;
    loadImage?: (source: RasterLayer["source"], signal?: AbortSignal) => Promise<CanvasImageSource>;
    signal?: AbortSignal;
  } = {},
): Promise<Blob> {
  const plan = planExport(options, document);
  const createCanvas = dependencies.createCanvas ?? browserCanvas;
  const composite = await renderImageStudioDocument(document, dependencies);
  const canvas = createCanvas(options.width, options.height);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas export is unavailable");

  if (options.format === "jpeg") {
    context.fillStyle = options.jpegBackground;
    context.fillRect(0, 0, options.width, options.height);
  }
  context.drawImage(composite, 0, 0, options.width, options.height);
  return canvasBlob(canvas, plan.mimeType, options.format === "png" ? undefined : options.quality);
}

export interface RenderDependencies {
  createCanvas?: (width: number, height: number) => HTMLCanvasElement;
  loadImage?: (source: RasterLayer["source"], signal?: AbortSignal) => Promise<CanvasImageSource>;
  signal?: AbortSignal;
  scale?: number;
  rasterOverrides?: ReadonlyMap<string, HTMLCanvasElement>;
}

export const PREVIEW_MAX_PIXELS = 1_000_000;
export const PREVIEW_MEMORY_BYTES = 64 * 1024 * 1024;

export function previewScale(document: ImageStudioDocument): number {
  const pixels = document.canvas.width * document.canvas.height;
  const largest = Math.max(pixels, ...document.layers.map((layer) => layer.width * layer.height));
  // Root, group recursion, mask, scratch and old displayed preview remain bounded together.
  const bytes = 4 * (pixels * (maximumGroupDepth(document.layers) + 5) + largest * 2);
  return Math.min(1, Math.sqrt(PREVIEW_MAX_PIXELS / pixels), Math.sqrt(PREVIEW_MEMORY_BYTES / bytes));
}

export async function renderImageStudioDocument(document: ImageStudioDocument, dependencies: RenderDependencies = {}): Promise<HTMLCanvasElement> {
  dependencies.signal?.throwIfAborted();
  const scale = dependencies.scale ?? 1;
  const createCanvas = dependencies.createCanvas ?? browserCanvas;
  const sizedCanvas = (width: number, height: number) => createCanvas(Math.max(1, Math.ceil(width * scale)), Math.max(1, Math.ceil(height * scale)));
  const canvas = sizedCanvas(document.canvas.width, document.canvas.height);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas export is unavailable");
  context.scale(scale, scale);
  // A mask's own visibility as ordinary content depends on whether some adjustment layer
  // claims it (Issue #171: claimed by position, not a stored reference). This depends only on
  // the whole document's layers, not on which group is being rendered, so it's computed once
  // here rather than on every recursive renderLayerStack call.
  const consumedMaskIds = new Set(document.layers.filter((candidate) => candidate.type === "adjustment")
    .flatMap((candidate) => adjacentMaskLayerIds(document.layers, candidate)));
  for (const layer of document.layers) if (layer.rasterMaskId) consumedMaskIds.add(layer.rasterMaskId);
  try {
    await renderLayerStack(document, null, context, sizedCanvas, dependencies, scale, consumedMaskIds);
    dependencies.signal?.throwIfAborted();
    return canvas;
  } catch (error) {
    canvas.width = 1; canvas.height = 1;
    throw error;
  }
}

async function renderLayerStack(
  document: ImageStudioDocument, parentId: string | null, context: CanvasRenderingContext2D,
  createCanvas: (width: number, height: number) => HTMLCanvasElement, dependencies: RenderDependencies, scale: number,
  consumedMaskIds: Set<string>,
): Promise<void> {
  const { signal } = dependencies;
  for (const layer of document.layers.filter((candidate) => (candidate.parentId ?? null) === parentId)) {
    signal?.throwIfAborted();
    if (!layer.visible || layer.opacity <= 0) continue;
    if (layer.type === "mask" && consumedMaskIds.has(layer.id)) continue;
    if (layer.type === "adjustment") {
      const width = Math.max(1, Math.ceil(document.canvas.width * scale));
      const height = Math.max(1, Math.ceil(document.canvas.height * scale));
      const mask = await renderCombinedAdjustmentMask(document, adjacentMaskLayerIds(document.layers, layer), createCanvas, scale, signal);
      try {
        if (isSpatialAdjustment(layer.adjustment.kind)) {
          const adjustment = scaledSpatialAdjustment(layer.adjustment, scale);
          const halo = spatialRadius(adjustment);
          const rows = Math.max(24, Math.floor(ADJUSTMENT_CHUNK_PIXELS / width));
          const maskContext = mask?.getContext("2d");
          const source = createCanvas(document.canvas.width, document.canvas.height);
          const sourceContext = source.getContext("2d");
          if (!sourceContext) throw new Error("Canvas export is unavailable");
          sourceContext.drawImage(context.canvas, 0, 0);
          try {
            for (let y = 0; y < height; y += rows) {
              await yieldRenderTask(signal);
              const chunkHeight = Math.min(rows, height - y);
              const readY = Math.max(0, y - halo);
              const readEnd = Math.min(height, y + chunkHeight + halo);
              const image = sourceContext.getImageData(0, readY, width, readEnd - readY);
              const maskData = maskContext?.getImageData(0, readY, width, readEnd - readY).data;
              image.data.set(applySpatialAdjustment(image.data, width, image.height, adjustment, layer.opacity, maskData, layer.blendMode));
              context.putImageData(image, 0, readY, 0, y - readY, width, chunkHeight);
            }
          } finally { source.width = 1; source.height = 1; }
          continue;
        }
        const kernel = adjustmentKernel(layer.adjustment, layer.opacity, layer.blendMode);
        const rows = Math.max(1, Math.floor(ADJUSTMENT_CHUNK_PIXELS / width));
        for (let y = 0; y < height; y += rows) {
          await yieldRenderTask(signal);
          const chunkHeight = Math.min(rows, height - y);
          const image = context.getImageData(0, y, width, chunkHeight);
          kernel(image.data, mask?.getContext("2d")?.getImageData(0, y, width, chunkHeight).data);
          context.putImageData(image, 0, y);
        }
      } finally {
        if (mask) { mask.width = 1; mask.height = 1; }
      }
      continue;
    }
    if (layer.type === "group") {
      const groupCanvas = createCanvas(document.canvas.width, document.canvas.height);
      const groupContext = groupCanvas.getContext("2d");
      if (!groupContext) throw new Error("Canvas export is unavailable");
      groupContext.scale(scale, scale);
      try {
        await renderLayerStack(document, layer.id, groupContext, createCanvas, dependencies, scale, consumedMaskIds);
        const mask = rasterMaskFor(document, layer);
        if (mask) applyRasterMask(groupCanvas, mask.layer, createCanvas, scale, mask.inverted, mask.featherPx);
        context.save(); applyLayerComposition(context, layer);
        context.drawImage(groupCanvas, 0, 0, document.canvas.width, document.canvas.height); context.restore();
      } finally { groupCanvas.width = 1; groupCanvas.height = 1; }
      continue;
    }
    await renderSingleLayer(layer, context, createCanvas, dependencies, scale, rasterMaskFor(document, layer));
  }
}

function scaledSpatialAdjustment(adjustment: import("./document").AdjustmentDefinition, scale: number): import("./document").AdjustmentDefinition {
  return { ...adjustment, parameters: { ...adjustment.parameters, radius: Math.max(1, Math.round(spatialRadius(adjustment) * scale)) } };
}

async function renderSingleLayer(
  layer: Exclude<ImageStudioLayer, { type: "group" | "adjustment" }>, context: CanvasRenderingContext2D,
  createCanvas: (width: number, height: number) => HTMLCanvasElement, dependencies: RenderDependencies, scale: number,
  rasterMask?: { layer: DrawingLayer; inverted: boolean; featherPx: number },
): Promise<void> {
  const override = dependencies.rasterOverrides?.get(layer.id);
  let image: CanvasImageSource;
  let ownedBitmap: ImageBitmap | undefined;
  let scratch: HTMLCanvasElement | undefined;
  let masked: HTMLCanvasElement | undefined;
  if (layer.type === "raster") {
    if (override) image = override;
    else if (dependencies.loadImage) image = await dependencies.loadImage(layer.source, dependencies.signal);
    else {
      const response = await fetch(rasterSourceUrl(layer.source), { signal: dependencies.signal });
      if (!response.ok) throw new Error("Image export source unavailable");
      ownedBitmap = await createImageBitmap(await response.blob(), {
        resizeWidth: Math.max(1, Math.ceil(layer.width * scale)), resizeHeight: Math.max(1, Math.ceil(layer.height * scale)),
      });
      image = ownedBitmap;
    }
  } else {
    scratch = layer.type === "annotation" ? renderAnnotationLayer(layer, createCanvas, scale) : renderDrawingLayer(layer, createCanvas, scale);
    image = scratch;
  }
  try {
    dependencies.signal?.throwIfAborted();
    if (rasterMask) {
      masked = createCanvas(layer.width, layer.height);
      const maskedContext = masked.getContext("2d");
      if (!maskedContext) throw new Error("Canvas export is unavailable");
      maskedContext.scale(scale, scale);
      maskedContext.drawImage(image, 0, 0, layer.width, layer.height);
      applyRasterMask(masked, rasterMask.layer, createCanvas, scale, rasterMask.inverted, rasterMask.featherPx);
      image = masked;
    }
    context.save(); applyLayerComposition(context, layer);
    context.drawImage(image, 0, 0, layer.width, layer.height);
    context.restore();
  } finally {
    ownedBitmap?.close();
    if (scratch) { scratch.width = 1; scratch.height = 1; }
    if (masked) { masked.width = 1; masked.height = 1; }
  }
}

function rasterMaskFor(document: ImageStudioDocument, layer: ImageStudioLayer): { layer: DrawingLayer; inverted: boolean; featherPx: number } | undefined {
  if (!layer.rasterMaskId) return undefined;
  const mask = document.layers.find((candidate) => candidate.id === layer.rasterMaskId);
  if (!mask || mask.type !== "mask" || mask.parentId !== layer.parentId
    || mask.width !== layer.width || mask.height !== layer.height) {
    throw new Error("Raster mask binding is invalid");
  }
  return { layer: mask, inverted: layer.rasterMaskInverted === true, featherPx: layer.rasterMaskFeatherPx ?? 0 };
}

/** Applies grayscale×alpha mask weight, not merely its alpha channel. */
function applyRasterMask(
  target: HTMLCanvasElement, mask: DrawingLayer,
  createCanvas: (width: number, height: number) => HTMLCanvasElement, scale: number, inverted = false, featherPx = 0,
): void {
  let maskCanvas = renderDrawingLayer(mask, createCanvas, scale);
  if (featherPx > 0) {
    const padding = Math.ceil(featherPx * scale * 3);
    const blurred = createCanvas(maskCanvas.width + padding * 2, maskCanvas.height + padding * 2);
    const blurredContext = blurred.getContext("2d");
    if (!blurredContext) throw new Error("Raster mask canvas is unavailable");
    blurredContext.filter = `blur(${featherPx * scale}px)`;
    blurredContext.drawImage(maskCanvas, padding, padding);
    maskCanvas.width = 1; maskCanvas.height = 1;
    maskCanvas = blurred;
  }
  const maskContext = maskCanvas.getContext("2d", { willReadFrequently: true });
  const targetContext = target.getContext("2d");
  if (!maskContext || !targetContext) { maskCanvas.width = 1; maskCanvas.height = 1; throw new Error("Raster mask canvas is unavailable"); }
  const image = maskContext.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
  for (let index = 0; index < image.data.length; index += 4) {
    const weight = image.data[index + 3] / 255 * (image.data[index] + image.data[index + 1] + image.data[index + 2]) / 765;
    const output = inverted ? 1 - weight : weight;
    image.data[index] = 255; image.data[index + 1] = 255; image.data[index + 2] = 255; image.data[index + 3] = Math.round(output * 255);
  }
  maskContext.putImageData(image, 0, 0);
  targetContext.save();
  // The destination may be a group or layer scratch canvas whose logical drawing
  // context is already scaled. Both bitmaps are physical-pixel buffers here.
  targetContext.setTransform(1, 0, 0, 1, 0, 0);
  targetContext.globalCompositeOperation = "destination-in";
  const padding = featherPx > 0 ? Math.ceil(featherPx * scale * 3) : 0;
  targetContext.drawImage(maskCanvas, padding, padding, maskCanvas.width - padding * 2, maskCanvas.height - padding * 2, 0, 0, target.width, target.height);
  targetContext.restore();
  maskCanvas.width = 1; maskCanvas.height = 1;
}

function applyLayerComposition(context: CanvasRenderingContext2D, layer: ImageStudioLayer): void {
  context.globalAlpha = layer.opacity;
  context.globalCompositeOperation = canvasBlendMode(layer.blendMode);
  applyTransform(context, layer.transform);
}

function renderAdjustmentMask(
  document: ImageStudioDocument,
  layerId: string,
  createCanvas: (width: number, height: number) => HTMLCanvasElement, scale: number,
): HTMLCanvasElement | undefined {
  const layer = document.layers.find((candidate) => candidate.id === layerId);
  if (!layer || layer.type !== "mask") return undefined;
  const canvas = createCanvas(document.canvas.width, document.canvas.height);
  let drawing: HTMLCanvasElement | undefined;
  try {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Adjustment mask canvas is unavailable");
    context.scale(scale, scale);
    context.save();
    try {
      applyLayerComposition(context, layer);
      const hasEffects = layer.adjustmentMaskInverted === true || (layer.adjustmentMaskFeatherPx ?? 0) > 0;
      drawing = hasEffects ? createCanvas(layer.width, layer.height) : renderDrawingLayer(layer, createCanvas, scale);
      if (hasEffects) {
        const drawingContext = drawing.getContext("2d");
        if (!drawingContext) throw new Error("Adjustment mask canvas is unavailable");
        drawingContext.fillStyle = "#fff";
        drawingContext.fillRect(0, 0, drawing.width, drawing.height);
        applyRasterMask(drawing, layer, createCanvas, scale, layer.adjustmentMaskInverted, layer.adjustmentMaskFeatherPx);
      }
      context.drawImage(drawing, 0, 0, layer.width, layer.height);
    } finally { context.restore(); }
    return canvas;
  } catch (error) {
    canvas.width = 1; canvas.height = 1;
    throw error;
  } finally {
    if (drawing) { drawing.width = 1; drawing.height = 1; }
  }
}

/**
 * Multiplies the per-pixel weight of every mask layer's rendered data — each weight decodes
 * as alpha × average-RGB, matching how adjustmentKernel/applySpatialAdjustment read a mask —
 * and re-encodes the product as opaque grayscale so the result is itself readable by that same
 * decode formula. A pure function of raw pixel buffers (Issue #171), so the combination math is
 * directly testable without a canvas.
 */
export function combineMaskData(datas: Uint8ClampedArray[]): Uint8ClampedArray {
  const combined = new Uint8ClampedArray(datas[0]?.length ?? 0);
  for (let index = 0; index < combined.length; index += 4) {
    let weight = 1;
    for (const data of datas) weight *= (data[index + 3] / 255) * ((data[index] + data[index + 1] + data[index + 2]) / 765);
    const value = Math.round(Math.max(0, Math.min(1, weight)) * 255);
    combined[index] = value; combined[index + 1] = value; combined[index + 2] = value; combined[index + 3] = 255;
  }
  return combined;
}

/** Combines adjacent masks with one source canvas and bounded row buffers at a time.
 * The weight buffer is independent of mask count; rounding happens only after all masks. */
export async function renderCombinedAdjustmentMask(
  document: ImageStudioDocument,
  maskLayerIds: string[],
  createCanvas: (width: number, height: number) => HTMLCanvasElement, scale: number, signal?: AbortSignal,
): Promise<HTMLCanvasElement | undefined> {
  if (!maskLayerIds.length) return undefined;
  if (maskLayerIds.length === 1) {
    signal?.throwIfAborted();
    return renderAdjustmentMask(document, maskLayerIds[0], createCanvas, scale);
  }
  let weights: Float32Array | undefined;
  let width = 0;
  let height = 0;
  let combined: HTMLCanvasElement | undefined;
  try {
    for (const id of maskLayerIds) {
      signal?.throwIfAborted();
      const canvas = renderAdjustmentMask(document, id, createCanvas, scale);
      if (!canvas) continue;
      try {
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) throw new Error("Adjustment mask canvas is unavailable");
        if (!weights) {
          width = canvas.width; height = canvas.height;
          weights = new Float32Array(width * height).fill(1);
        } else if (canvas.width !== width || canvas.height !== height) {
          throw new Error("Adjustment mask dimensions do not match");
        }
        const rows = Math.max(1, Math.floor(ADJUSTMENT_CHUNK_PIXELS * 16 / width));
        for (let y = 0; y < height; y += rows) {
          await yieldRenderTask(signal);
          const chunkHeight = Math.min(rows, height - y);
          const data = context.getImageData(0, y, width, chunkHeight).data;
          for (let pixel = 0; pixel < width * chunkHeight; pixel += 1) {
            const index = pixel * 4;
            weights[y * width + pixel] *= data[index + 3] / 255
              * (data[index] + data[index + 1] + data[index + 2]) / 765;
          }
        }
      } finally { canvas.width = 1; canvas.height = 1; }
    }
    if (!weights) return undefined;
    combined = createCanvas(document.canvas.width, document.canvas.height);
    const context = combined.getContext("2d");
    if (!context || combined.width !== width || combined.height !== height) {
      throw new Error("Adjustment mask canvas is unavailable");
    }
    const rows = Math.max(1, Math.floor(ADJUSTMENT_CHUNK_PIXELS * 16 / width));
    for (let y = 0; y < height; y += rows) {
      await yieldRenderTask(signal);
      const chunkHeight = Math.min(rows, height - y);
      const image = context.createImageData(width, chunkHeight);
      for (let pixel = 0; pixel < width * chunkHeight; pixel += 1) {
        const value = Math.round(Math.max(0, Math.min(1, weights[y * width + pixel])) * 255);
        const index = pixel * 4;
        image.data[index] = value; image.data[index + 1] = value;
        image.data[index + 2] = value; image.data[index + 3] = 255;
      }
      context.putImageData(image, 0, y);
    }
    return combined;
  } catch (error) {
    if (combined) { combined.width = 1; combined.height = 1; }
    throw error;
  }
}

export function exportFilename(title: string, format: ExportFormat): string {
  const safe = title.trim().replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-").slice(0, 80) || "image-studio";
  return `${safe}.${format === "jpeg" ? "jpg" : format}`;
}

export function renderDrawingLayer(layer: DrawingLayer, createCanvas: (width: number, height: number) => HTMLCanvasElement, scale = 1): HTMLCanvasElement {
  const canvas = createCanvas(layer.width, layer.height);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas export is unavailable");
  context.scale(scale, scale);
  if (layer.type === "mask" && layer.selectionRuns) paintSelectionRuns(context, layer.selectionRuns, layer.width, layer.height);
  for (const stroke of layer.strokes) {
    if (!stroke.points.length) continue;
    const color = layer.type === "mask" ? `rgb(${stroke.value},${stroke.value},${stroke.value})` : stroke.color ?? "#111827";
    if (stroke.brush && stroke.samples) {
      renderBrushDabs(context, createBrushDabs(stroke.samples, stroke.size, stroke.brush), color, stroke.mode === "erase");
      continue;
    }
    context.save();
    context.globalCompositeOperation = stroke.mode === "erase" ? "destination-out" : "source-over";
    context.strokeStyle = color;
    context.lineWidth = stroke.size;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.beginPath();
    context.moveTo(stroke.points[0].x, stroke.points[0].y);
    for (const point of stroke.points.slice(1)) context.lineTo(point.x, point.y);
    if (stroke.points.length === 1) context.lineTo(stroke.points[0].x + 0.01, stroke.points[0].y);
    context.stroke();
    context.restore();
  }
  return canvas;
}

function renderAnnotationLayer(layer: AnnotationLayer, createCanvas: (width: number, height: number) => HTMLCanvasElement, scale = 1): HTMLCanvasElement {
  const canvas = createCanvas(layer.width, layer.height);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas export is unavailable");
  context.scale(scale, scale);
  for (const element of layer.elements) {
    context.save();
    if ("stroke" in element) { context.strokeStyle = element.stroke; context.lineWidth = element.strokeWidth; context.lineCap = "round"; context.lineJoin = "round"; }
    if ("fill" in element) context.fillStyle = element.fill;
    switch (element.kind) {
      case "text": {
        context.translate(element.x, element.y);
        context.rotate(element.rotation * Math.PI / 180);
        context.textBaseline = "top";
        context.textAlign = element.align;
        context.font = `${element.fontSize}px ${element.fontFamily}`;
        const originX = element.align === "center" ? element.width / 2 : element.align === "right" ? element.width : 0;
        element.text.split("\n").forEach((line, index) => context.fillText(line, originX, index * element.fontSize * 1.2));
        break;
      }
      case "rect": {
        context.translate(element.x, element.y);
        context.rotate(element.rotation * Math.PI / 180);
        context.beginPath();
        context.roundRect ? context.roundRect(0, 0, element.width, element.height, element.cornerRadius) : context.rect(0, 0, element.width, element.height);
        if (element.fill !== "transparent") context.fill();
        if (element.strokeWidth > 0) context.stroke();
        break;
      }
      case "ellipse": {
        context.translate(element.x, element.y);
        context.rotate(element.rotation * Math.PI / 180);
        context.beginPath();
        context.ellipse(0, 0, element.radiusX, element.radiusY, 0, 0, Math.PI * 2);
        if (element.fill !== "transparent") context.fill();
        if (element.strokeWidth > 0) context.stroke();
        break;
      }
      case "polygon": {
        context.translate(element.x, element.y);
        context.rotate(element.rotation * Math.PI / 180);
        context.beginPath();
        for (let index = 0; index < element.sides; index += 1) {
          const angle = (index / element.sides) * Math.PI * 2 - Math.PI / 2;
          const point = { x: Math.cos(angle) * element.radius, y: Math.sin(angle) * element.radius };
          if (index === 0) context.moveTo(point.x, point.y); else context.lineTo(point.x, point.y);
        }
        context.closePath();
        if (element.fill !== "transparent") context.fill();
        if (element.strokeWidth > 0) context.stroke();
        break;
      }
      case "freehand":
      case "line": {
        if (element.points.length) {
          context.beginPath();
          context.moveTo(element.points[0].x, element.points[0].y);
          for (const point of element.points.slice(1)) context.lineTo(point.x, point.y);
          context.stroke();
        }
        break;
      }
      case "arrow": {
        const [start, end] = element.points;
        const angle = Math.atan2(end.y - start.y, end.x - start.x);
        const headLength = Math.max(10, element.strokeWidth * 4);
        context.beginPath();
        context.moveTo(start.x, start.y);
        context.lineTo(end.x, end.y);
        context.stroke();
        context.beginPath();
        context.fillStyle = element.stroke;
        context.moveTo(end.x, end.y);
        context.lineTo(end.x - headLength * Math.cos(angle - Math.PI / 7), end.y - headLength * Math.sin(angle - Math.PI / 7));
        context.lineTo(end.x - headLength * Math.cos(angle + Math.PI / 7), end.y - headLength * Math.sin(angle + Math.PI / 7));
        context.closePath();
        context.fill();
        break;
      }
    }
    context.restore();
  }
  return canvas;
}

function applyTransform(context: CanvasRenderingContext2D, transform: RasterLayer["transform"]): void {
  context.translate(transform.x, transform.y);
  context.rotate(transform.rotation * Math.PI / 180);
  context.scale(transform.scaleX, transform.scaleY);
}

function browserCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = window.document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob(
    (blob) => blob ? resolve(blob) : reject(new Error("The browser could not encode this image format")),
    type,
    quality,
  ));
}
