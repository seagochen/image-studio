import type { DrawingLayer, ImageStudioDocument, ImageStudioLayer } from "./document";
import { adjacentMaskLayerIds } from "./adjustmentMasking";
import { ADJUSTMENT_CHUNK_PIXELS, isSpatialAdjustment, spatialRadius } from "./adjustmentEngine";

export const MASK_CHUNK_PIXELS = ADJUSTMENT_CHUNK_PIXELS * 16;
export const SPATIAL_WORK_BYTES_PER_PIXEL = 48;

function maskWork(mask: DrawingLayer, feather: number): number {
  const pixels = mask.width * mask.height;
  const padding = Math.ceil(feather * 3);
  const blurredPixels = (mask.width + padding * 2) * (mask.height + padding * 2);
  const canvas = (feather > 0 ? blurredPixels : pixels) * 4;
  return Math.max(feather > 0 ? pixels * 4 + canvas : canvas,
    canvas + Math.min(blurredPixels, Math.max(mask.width + padding * 2, MASK_CHUNK_PIXELS)) * 4
      + (mask.clipRuns ? pixels : 0));
}

/** Sequential live working-set bound; counts hidden descendants only when rendered. */
export function estimateRenderPeak(document: ImageStudioDocument): number {
  const pixels = document.canvas.width * document.canvas.height;
  const byId = new Map(document.layers.map((layer) => [layer.id, layer]));
  const consumed = new Set(document.layers.filter((layer) => layer.type === "adjustment")
    .flatMap((layer) => adjacentMaskLayerIds(document.layers, layer)));
  for (const layer of document.layers) if (layer.rasterMaskId) consumed.add(layer.rasterMaskId);
  const ownedMaskWork = (layer: ImageStudioLayer) => {
    const mask = layer.rasterMaskId ? byId.get(layer.rasterMaskId) : undefined;
    return mask?.type === "mask" ? maskWork(mask, layer.rasterMaskFeatherPx ?? 0) : 0;
  };
  const stackPeak = (parentId: string | null, ancestors: Set<string>): number => {
    let peak = 0;
    for (const layer of document.layers.filter((candidate) => (candidate.parentId ?? null) === parentId)) {
      if (!layer.visible || layer.opacity <= 0 || layer.type === "mask" && consumed.has(layer.id)) continue;
      const layerBytes = layer.width * layer.height * 4;
      if (layer.type === "group") {
        if (ancestors.has(layer.id)) throw new Error("Cyclic Image Studio layer group");
        peak = Math.max(peak, pixels * 4 + Math.max(stackPeak(layer.id, new Set([...ancestors, layer.id])), ownedMaskWork(layer)));
      } else if (layer.type === "adjustment") {
        const masks = adjacentMaskLayerIds(document.layers, layer).map((id) => byId.get(id)).filter((mask): mask is DrawingLayer => mask?.type === "mask");
        const maskBuild = Math.max(0, ...masks.map((mask) => pixels * 4 + (mask.adjustmentMaskInverted || mask.adjustmentMaskFeatherPx
          ? mask.width * mask.height * 4 + maskWork(mask, mask.adjustmentMaskFeatherPx ?? 0) : mask.width * mask.height * 4)));
        const combine = masks.length > 1 ? pixels * 4 + Math.max(maskBuild, pixels * 4 + Math.min(pixels, MASK_CHUNK_PIXELS) * 4) : maskBuild;
        const maskBytes = masks.length ? pixels * 4 : 0;
        const rows = Math.max(24, Math.floor(ADJUSTMENT_CHUNK_PIXELS / document.canvas.width));
        const work = isSpatialAdjustment(layer.adjustment.kind)
          ? pixels * 4 + document.canvas.width * Math.min(document.canvas.height, rows + spatialRadius(layer.adjustment) * 2) * SPATIAL_WORK_BYTES_PER_PIXEL
          : Math.max(document.canvas.width, ADJUSTMENT_CHUNK_PIXELS) * (masks.length ? 8 : 4);
        peak = Math.max(peak, combine, maskBytes + work);
      } else {
        peak = Math.max(peak, layerBytes + (layer.rasterMaskId ? layerBytes + ownedMaskWork(layer) : 0));
      }
    }
    return peak;
  };
  return pixels * 4 + stackPeak(null, new Set());
}
