import type { ImageStudioDocument, LayerTransform } from "../domain/document";
import { patchLayer, replaceRasterLayer } from "../domain/commands";
import { resizeCanvas, type CanvasAnchor } from "../domain/layoutCommands";
import type { CropRect } from "../domain/rasterAdjustments";

export interface ConventionalEditorInput {
  sourceUrl: string;
  mimeType: string;
  width: number;
  height: number;
  name: string;
  /** The document canvas, which the size tool edits independently of the layer. */
  canvasWidth: number;
  canvasHeight: number;
  /** Raster-local editable weights, captured when the editor opens. */
  coverage?: Uint8Array | null;
}

export interface CanvasResize {
  width: number;
  height: number;
  anchor: CanvasAnchor;
}

export interface ConventionalEditorOutput {
  dataUrl: string;
  mimeType: string;
  width: number;
  height: number;
  /** Source region kept by a crop; the whole source when omitted. */
  crop?: CropRect;
  canvasResize?: CanvasResize;
}

export type ConventionalEditorOutcome =
  | { kind: "saved"; output: ConventionalEditorOutput }
  | { kind: "cancelled" };

/**
 * Layer edits change the layer only: crop and rotation keep the kept region's centre where it was
 * on the canvas, with the layer's own scale and rotation preserved. The canvas changes only through
 * an explicit canvas resize.
 */
export function applyConventionalEditorOutcome(
  document: ImageStudioDocument,
  layerId: string,
  outcome: ConventionalEditorOutcome,
): ImageStudioDocument {
  if (outcome.kind === "cancelled") return document;
  const layer = document.layers.find((candidate) => candidate.id === layerId);
  if (!layer || layer.type !== "raster") return document;
  const { output } = outcome;
  const replaced = replaceRasterLayer(document, layerId, {
    width: output.width,
    height: output.height,
    source: { kind: "data-url", value: output.dataUrl, mimeType: output.mimeType },
  });
  if (replaced === document) return document;
  const crop = output.crop ?? { x: 0, y: 0, width: layer.width, height: layer.height };
  const placed = patchLayer(replaced, layerId, {
    transform: keepRegionCentre(layer.transform, crop, output.width, output.height),
  });
  return output.canvasResize
    ? resizeCanvas(placed, output.canvasResize)
    : placed;
}

function keepRegionCentre(transform: LayerTransform, region: CropRect, width: number, height: number): LayerTransform {
  const angle = transform.rotation * Math.PI / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const toCanvas = (x: number, y: number) => ({
    x: x * transform.scaleX * cos - y * transform.scaleY * sin,
    y: x * transform.scaleX * sin + y * transform.scaleY * cos,
  });
  const before = toCanvas(region.x + region.width / 2, region.y + region.height / 2);
  const after = toCanvas(width / 2, height / 2);
  return { ...transform, x: transform.x + before.x - after.x, y: transform.y + before.y - after.y };
}
