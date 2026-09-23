import { createId, defaultTransform, type ImageStudioDocument, type RasterLayer } from "./document";
import { MAX_CANVAS_EDGE, MAX_CANVAS_PIXELS } from "../../../../frontend/src/shared/imageStudioDomain";

export const ACCEPTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export const MAX_IMAGE_PIXELS = MAX_CANVAS_PIXELS;
export const MAX_IMAGE_EDGE = MAX_CANVAS_EDGE;
export const MAX_IMAGE_BYTES = 50 * 1024 * 1024;

export type ImageImportError = "unsupported" | "too-large" | "decode-failed";

export interface DecodedImage { dataUrl: string; mimeType: string; width: number; height: number; name: string }

export function validateImageFile(file: Pick<File, "type" | "size">): ImageImportError | null {
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type as typeof ACCEPTED_IMAGE_TYPES[number])) return "unsupported";
  return file.size > MAX_IMAGE_BYTES ? "too-large" : null;
}

export function validateImageDimensions(width: number, height: number): ImageImportError | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return "decode-failed";
  return width > MAX_IMAGE_EDGE || height > MAX_IMAGE_EDGE || width * height > MAX_IMAGE_PIXELS ? "too-large" : null;
}

export function rasterLayerFromImage(image: DecodedImage): RasterLayer {
  return {
    id: createId("raster"), type: "raster", name: image.name, visible: true, locked: false, opacity: 1, blendMode: "normal",
    parentId: null, transform: defaultTransform(), width: image.width, height: image.height,
    source: { kind: "data-url", value: image.dataUrl, mimeType: image.mimeType },
  };
}

export function documentFromImage(document: ImageStudioDocument, image: DecodedImage): ImageStudioDocument {
  const layer = rasterLayerFromImage(image);
  const now = new Date().toISOString();
  return {
    ...document,
    title: image.name.replace(/\.[^.]+$/, "").slice(0,160) || "Untitled",
    canvas: { width: image.width, height: image.height },
    layers: [layer],
    selection: { layerId: layer.id },
    metadata: { ...document.metadata, updatedAt: now },
  };
}
