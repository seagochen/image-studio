import { tracePath } from "./vectorPath";
import { renderLayerFilters } from "./layerFilters";
import { drawLayerEffects } from "./layerEffects";
import { canvasBlendMode, rasterSourceUrl, type DrawingLayer, type ImageStudioDocument, type ImageStudioLayer, type RasterLayer } from "./document";
import { applyRasterMask } from "./rasterMaskRenderer";
import { renderDrawingLayer, renderAnnotationLayer } from "./layerRasterization";
export { renderDrawingLayer } from "./layerRasterization";
import { adjustmentKernel, ADJUSTMENT_CHUNK_PIXELS, applySpatialAdjustment, isSpatialAdjustment, spatialRadius, yieldRenderTask } from "./adjustmentEngine";
import { adjacentMaskLayerIds } from "./adjustmentMasking";
import { MAX_CANVAS_EDGE } from "../shared/imageStudioDomain";
import { RenderMemoryBudget, releaseRenderCanvas, reserveRenderBytes, type RenderMemoryUsage } from "./renderMemory";
import { estimateRenderPeak, MASK_CHUNK_PIXELS, SPATIAL_WORK_BYTES_PER_PIXEL } from "./exportMemoryPlan";

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
  // Rendering and encoding are sequential; encoder allowance includes a pixel copy and output.
  const estimatedBytes = Math.max(outputPixels * 12, document ? estimateRenderPeak(document) : 0,
    document && !canEncodeCompositeDirectly(document, options) ? document.canvas.width * document.canvas.height * 4 + outputPixels * 4 : 0);
  if (estimatedBytes > EXPORT_MEMORY_LIMIT_BYTES) throw new Error("Export exceeds the browser memory budget");
  return {
    mimeType: options.format === "png" ? "image/png" : options.format === "jpeg" ? "image/jpeg" : "image/webp",
    estimatedBytes,
    memoryRisk: estimatedBytes > EXPORT_MEMORY_WARNING_BYTES,
  };
}

function canEncodeCompositeDirectly(document: ImageStudioDocument, options: ExportOptions): boolean {
  return options.width === document.canvas.width && options.height === document.canvas.height;
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
    onMemoryUsage?: (usage: RenderMemoryUsage) => void;
  } = {},
): Promise<Blob> {
  const plan = planExport(options, document);
  const budget = new RenderMemoryBudget(EXPORT_MEMORY_LIMIT_BYTES, dependencies.onMemoryUsage);
  const createCanvas = budget.canvasFactory(dependencies.createCanvas ?? browserCanvas);
  let composite: HTMLCanvasElement | undefined;
  try {
    composite = await renderImageStudioDocument(document, { ...dependencies, createCanvas, memoryBudget: budget });
    let canvas = composite;
    if (!canEncodeCompositeDirectly(document, options)) {
      canvas = createCanvas(options.width, options.height);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas export is unavailable");
      context.drawImage(composite, 0, 0, options.width, options.height);
      releaseRenderCanvas(composite);
      composite = undefined;
    }
    if (options.format === "jpeg") {
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas export is unavailable");
      context.save();
      try {
        context.globalCompositeOperation = "destination-over";
        context.fillStyle = options.jpegBackground;
        context.fillRect(0, 0, options.width, options.height);
      } finally { context.restore(); }
    }
    await yieldRenderTask(dependencies.signal);
    const releaseEncoding = budget.reserve(options.width * options.height * 8);
    try {
      return await canvasBlob(canvas, plan.mimeType, options.format === "png" ? undefined : options.quality, dependencies.signal);
    } finally { releaseEncoding(); }
  } finally { budget.dispose(); }
}

export interface RenderDependencies {
  createCanvas?: (width: number, height: number) => HTMLCanvasElement;
  loadImage?: (source: RasterLayer["source"], signal?: AbortSignal) => Promise<CanvasImageSource>;
  signal?: AbortSignal;
  scale?: number;
  rasterOverrides?: ReadonlyMap<string, HTMLCanvasElement>;
  memoryBudget?: RenderMemoryBudget;
}

export const PREVIEW_MAX_PIXELS = 1_000_000;
export const PREVIEW_MEMORY_BYTES = 64 * 1024 * 1024;

export function previewScale(document: ImageStudioDocument): number {
  const pixels = document.canvas.width * document.canvas.height;
  const largest = Math.max(pixels, ...document.layers.map((layer) => layer.width * layer.height));
  // Root, group recursion, mask, scratch and old displayed preview remain bounded together.
  const bytes = 4 * (pixels * (maximumGroupDepth(document.layers) + 5) + largest * (document.layers.some(layer=>layer.filters?.length)?20:4));
  return Math.min(1, Math.sqrt(PREVIEW_MAX_PIXELS / pixels), Math.sqrt(PREVIEW_MEMORY_BYTES / bytes));
}

export async function renderImageStudioDocument(document: ImageStudioDocument, dependencies: RenderDependencies = {}): Promise<HTMLCanvasElement> {
  dependencies.signal?.throwIfAborted();
  const scale = dependencies.scale ?? 1;
  const createCanvas = dependencies.createCanvas ?? browserCanvas;
  const sizedCanvas = (width: number, height: number) => createCanvas(Math.max(1, Math.ceil(width * scale)), Math.max(1, Math.ceil(height * scale)));
  const canvas = sizedCanvas(document.canvas.width, document.canvas.height);
  const context = canvas.getContext("2d");
  if (!context) { releaseRenderCanvas(canvas); throw new Error("Canvas export is unavailable"); }
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
    releaseRenderCanvas(canvas);
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
      const mask = await renderCombinedAdjustmentMask(document, adjacentMaskLayerIds(document.layers, layer), createCanvas, scale, signal, dependencies.memoryBudget);
      try {
        if (isSpatialAdjustment(layer.adjustment.kind)) {
          const adjustment = scaledSpatialAdjustment(layer.adjustment, scale);
          const halo = spatialRadius(adjustment);
          const rows = Math.max(24, Math.floor(ADJUSTMENT_CHUNK_PIXELS / width));
          const maskContext = mask?.getContext("2d");
          const source = createCanvas(document.canvas.width, document.canvas.height);
          try {
            const sourceContext = source.getContext("2d");
            if (!sourceContext) throw new Error("Canvas export is unavailable");
            sourceContext.drawImage(context.canvas, 0, 0);
            for (let y = 0; y < height; y += rows) {
              await yieldRenderTask(signal);
              const chunkHeight = Math.min(rows, height - y);
              const readY = Math.max(0, y - halo);
              const readEnd = Math.min(height, y + chunkHeight + halo);
              const releaseChunk = reserveRenderBytes(dependencies.memoryBudget, width * (readEnd - readY) * SPATIAL_WORK_BYTES_PER_PIXEL);
              try {
                const image = sourceContext.getImageData(0, readY, width, readEnd - readY);
                const maskData = maskContext?.getImageData(0, readY, width, readEnd - readY).data;
                image.data.set(applySpatialAdjustment(image.data, width, image.height, adjustment, layer.opacity, maskData, layer.blendMode));
                context.putImageData(image, 0, readY, 0, y - readY, width, chunkHeight);
              } finally { releaseChunk(); }
            }
          } finally { releaseRenderCanvas(source); }
          continue;
        }
        const kernel = adjustmentKernel(layer.adjustment, layer.opacity, layer.blendMode);
        const rows = Math.max(1, Math.floor(ADJUSTMENT_CHUNK_PIXELS / width));
        for (let y = 0; y < height; y += rows) {
          await yieldRenderTask(signal);
          const chunkHeight = Math.min(rows, height - y);
          const releaseChunk = reserveRenderBytes(dependencies.memoryBudget, width * chunkHeight * (mask ? 8 : 4));
          try {
            const image = context.getImageData(0, y, width, chunkHeight);
            kernel(image.data, mask?.getContext("2d")?.getImageData(0, y, width, chunkHeight).data);
            context.putImageData(image, 0, y);
          } finally { releaseChunk(); }
        }
      } finally {
        if (mask) releaseRenderCanvas(mask);
      }
      continue;
    }
    if (layer.type === "group") {
      const groupCanvas = createCanvas(document.canvas.width, document.canvas.height);
      try {
        const groupContext = groupCanvas.getContext("2d");
        if (!groupContext) throw new Error("Canvas export is unavailable");
        groupContext.scale(scale, scale);
        await renderLayerStack(document, layer.id, groupContext, createCanvas, dependencies, scale, consumedMaskIds);
        const mask = rasterMaskFor(document, layer);
        if (mask) await applyRasterMask(groupCanvas, mask.layer, createCanvas, scale, mask.inverted, mask.featherPx, dependencies);
        context.save(); applyLayerComposition(context, layer);
        context.drawImage(groupCanvas, 0, 0, document.canvas.width, document.canvas.height); context.restore();
      } finally { releaseRenderCanvas(groupCanvas); }
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
  let filtered: HTMLCanvasElement | undefined;
  let releaseImage = () => {};
  try {
    if (layer.type === "raster") {
      releaseImage = reserveRenderBytes(dependencies.memoryBudget,
        Math.max(1, Math.ceil(layer.width * scale)) * Math.max(1, Math.ceil(layer.height * scale)) * 4);
      if (override) image = override;
      else if (dependencies.loadImage) image = await dependencies.loadImage(layer.source, dependencies.signal);
      else {
        const response = await fetch(rasterSourceUrl(layer.source), { signal: dependencies.signal });
        if (!response.ok) throw new Error("Image export source unavailable");
        const blob = await response.blob();
        const releaseInput = reserveRenderBytes(dependencies.memoryBudget, blob.size);
        try {
          dependencies.signal?.throwIfAborted();
          ownedBitmap = await createImageBitmap(blob, {
            resizeWidth: Math.max(1, Math.ceil(layer.width * scale)), resizeHeight: Math.max(1, Math.ceil(layer.height * scale)),
          });
          image = ownedBitmap;
        } finally { releaseInput(); }
      }
    } else {
      scratch = layer.type === "annotation" ? renderAnnotationLayer(layer, createCanvas, scale) : renderDrawingLayer(layer, createCanvas, scale);
      image = scratch;
    }
    await yieldRenderTask(dependencies.signal);
    if (layer.filters?.some(filter=>filter.enabled&&filter.opacity>0)) {
      filtered=await renderLayerFilters(image,layer.width,layer.height,layer.filters,createCanvas,scale,dependencies.signal,dependencies.memoryBudget);
      image=filtered;
    }
    if (rasterMask || layer.vectorMask) {
      masked = createCanvas(layer.width, layer.height);
      const maskedContext = masked.getContext("2d");
      if (!maskedContext) throw new Error("Canvas export is unavailable");
      maskedContext.scale(scale, scale);
      maskedContext.drawImage(image, 0, 0, layer.width, layer.height);
      if(layer.vectorMask) {
        maskedContext.globalCompositeOperation=layer.vectorMask.inverted?"destination-out":"destination-in";
        tracePath(maskedContext,layer.vectorMask.path);maskedContext.fillStyle="#fff";maskedContext.fill();maskedContext.globalCompositeOperation="source-over";
      }
      if(rasterMask)await applyRasterMask(masked, rasterMask.layer, createCanvas, scale, rasterMask.inverted, rasterMask.featherPx, dependencies);
      image = masked;
    }
    context.save(); applyLayerComposition(context, layer);
    if (layer.effects) drawLayerEffects(context, image, layer.width, layer.height, layer.effects, createCanvas, scale);
    context.drawImage(image, 0, 0, layer.width, layer.height);
    context.restore();
  } finally {
    ownedBitmap?.close();
    releaseImage();
    if (scratch) releaseRenderCanvas(scratch);
    if (masked) releaseRenderCanvas(masked);
    if (filtered) releaseRenderCanvas(filtered);
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


function applyLayerComposition(context: CanvasRenderingContext2D, layer: ImageStudioLayer): void {
  context.globalAlpha = layer.opacity;
  context.globalCompositeOperation = canvasBlendMode(layer.blendMode);
  applyTransform(context, layer.transform);
}

async function renderAdjustmentMask(
  document: ImageStudioDocument,
  layerId: string,
  createCanvas: (width: number, height: number) => HTMLCanvasElement, scale: number,
  signal?: AbortSignal, memoryBudget?: RenderMemoryBudget,
): Promise<HTMLCanvasElement | undefined> {
  await yieldRenderTask(signal);
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
        await applyRasterMask(drawing, layer, createCanvas, scale, layer.adjustmentMaskInverted, layer.adjustmentMaskFeatherPx, { signal, memoryBudget });
      }
      context.drawImage(drawing, 0, 0, layer.width, layer.height);
    } finally { context.restore(); }
    return canvas;
  } catch (error) {
    releaseRenderCanvas(canvas);
    throw error;
  } finally {
    if (drawing) releaseRenderCanvas(drawing);
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
  memoryBudget?: RenderMemoryBudget,
): Promise<HTMLCanvasElement | undefined> {
  if (!maskLayerIds.length) return undefined;
  if (maskLayerIds.length === 1) {
    signal?.throwIfAborted();
    return renderAdjustmentMask(document, maskLayerIds[0], createCanvas, scale, signal, memoryBudget);
  }
  let weights: Float32Array | undefined;
  let width = 0;
  let height = 0;
  let combined: HTMLCanvasElement | undefined;
  let releaseWeights = () => {};
  try {
    for (const id of maskLayerIds) {
      signal?.throwIfAborted();
      // Reserve the full accumulator before rendering the first source mask.
      if (!weights) {
        width = Math.max(1, Math.ceil(document.canvas.width * scale));
        height = Math.max(1, Math.ceil(document.canvas.height * scale));
        releaseWeights = reserveRenderBytes(memoryBudget, width * height * 4);
        weights = new Float32Array(width * height).fill(1);
      }
      const canvas = await renderAdjustmentMask(document, id, createCanvas, scale, signal, memoryBudget);
      if (!canvas) throw new Error("Adjustment mask is unavailable");
      try {
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) throw new Error("Adjustment mask canvas is unavailable");
        if (canvas.width !== width || canvas.height !== height) {
          throw new Error("Adjustment mask dimensions do not match");
        }
        const rows = Math.max(1, Math.floor(MASK_CHUNK_PIXELS / width));
        for (let y = 0; y < height; y += rows) {
          await yieldRenderTask(signal);
          const chunkHeight = Math.min(rows, height - y);
          const releaseChunk = reserveRenderBytes(memoryBudget, width * chunkHeight * 4);
          try {
            const data = context.getImageData(0, y, width, chunkHeight).data;
            for (let pixel = 0; pixel < width * chunkHeight; pixel += 1) {
              const index = pixel * 4;
              weights[y * width + pixel] *= data[index + 3] / 255
                * (data[index] + data[index + 1] + data[index + 2]) / 765;
            }
          } finally { releaseChunk(); }
        }
      } finally { releaseRenderCanvas(canvas); }
    }
    if (!weights) return undefined;
    combined = createCanvas(document.canvas.width, document.canvas.height);
    const context = combined.getContext("2d");
    if (!context || combined.width !== width || combined.height !== height) {
      throw new Error("Adjustment mask canvas is unavailable");
    }
    const rows = Math.max(1, Math.floor(MASK_CHUNK_PIXELS / width));
    for (let y = 0; y < height; y += rows) {
      await yieldRenderTask(signal);
      const chunkHeight = Math.min(rows, height - y);
      const releaseChunk = reserveRenderBytes(memoryBudget, width * chunkHeight * 4);
      try {
        const image = context.createImageData(width, chunkHeight);
        for (let pixel = 0; pixel < width * chunkHeight; pixel += 1) {
          const value = Math.round(Math.max(0, Math.min(1, weights[y * width + pixel])) * 255);
          const index = pixel * 4;
          image.data[index] = value; image.data[index + 1] = value;
          image.data[index + 2] = value; image.data[index + 3] = 255;
        }
        context.putImageData(image, 0, y);
      } finally { releaseChunk(); }
    }
    return combined;
  } catch (error) {
    if (combined) releaseRenderCanvas(combined);
    throw error;
  } finally { weights = undefined; releaseWeights(); }
}

export function exportFilename(title: string, format: ExportFormat): string {
  const safe = title.trim().replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-").slice(0, 80) || "image-studio";
  return `${safe}.${format === "jpeg" ? "jpg" : format}`;
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

async function canvasBlob(canvas: HTMLCanvasElement, type: string, quality?: number, signal?: AbortSignal): Promise<Blob> {
  signal?.throwIfAborted();
  // Native encoding cannot be interrupted safely; retain its canvas until the callback settles.
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
    (blob) => blob ? resolve(blob) : reject(new Error("The browser could not encode this image format")),
    type,
    quality,
  ));
  signal?.throwIfAborted();
  return blob;
}
