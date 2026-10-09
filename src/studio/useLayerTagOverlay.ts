import { useEffect, useState } from "react";
import { rasterSourceUrl, type AnnotationLayer, type DrawingLayer, type ImageStudioLayer, type RasterLayer } from "../domain/document";
import { renderAnnotationLayer, renderDrawingLayer } from "../domain/layerRasterization";

/** The overlay is a selection hint, so it is rendered at most at this many pixels. */
const OVERLAY_MAX_PIXELS = 2_000_000;
export const LAYER_TAG_OVERLAY_OPACITY = 0.3;

export function overlayScale(width: number, height: number): number {
  const pixels = width * height;
  return pixels > OVERLAY_MAX_PIXELS ? Math.sqrt(OVERLAY_MAX_PIXELS / pixels) : 1;
}

/** Fills the opaque pixels of a layer-local rendering with one colour, keeping their alpha. */
export function tintOpaquePixels(source: CanvasImageSource, width: number, height: number, color: string): HTMLCanvasElement {
  const canvas = window.document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return canvas;
  context.drawImage(source, 0, 0, width, height);
  context.globalCompositeOperation = "source-in";
  context.fillStyle = color;
  context.fillRect(0, 0, width, height);
  return canvas;
}

/** Mask layers are excluded by the guard below; they own no visible artwork. */
type OverlayLayer = RasterLayer | DrawingLayer | AnnotationLayer;

export function isOverlayLayer(layer: ImageStudioLayer | null): layer is OverlayLayer {
  return Boolean(layer && layer.visible && (layer.type === "raster" || layer.type === "paint" || layer.type === "annotation"));
}

/**
 * Layer-local canvas marking which pixels belong to `layer` in its tag colour. It covers the
 * layer's own content (not its bounding box) and never enters composition or export.
 */
export function useLayerTagOverlay(layer: ImageStudioLayer | null, enabled: boolean): HTMLCanvasElement | null {
  const [overlay, setOverlay] = useState<HTMLCanvasElement | null>(null);
  const target = enabled && isOverlayLayer(layer) ? layer : null;
  const content = !target ? null : target.type === "raster" ? target.source : target.type === "annotation" ? target.elements : target.strokes;

  useEffect(() => {
    if (!target) { setOverlay(null); return; }
    const scale = overlayScale(target.width, target.height);
    const width = Math.max(1, Math.round(target.width * scale));
    const height = Math.max(1, Math.round(target.height * scale));
    if (target.type !== "raster") {
      const createCanvas = () => {
        const canvas = window.document.createElement("canvas");
        canvas.width = width; canvas.height = height;
        return canvas;
      };
      try {
        const local = target.type === "annotation" ? renderAnnotationLayer(target, createCanvas, scale) : renderDrawingLayer(target, createCanvas, scale);
        setOverlay(tintOpaquePixels(local, width, height, target.tagColor));
      } catch { setOverlay(null); }
      return;
    }
    let active = true;
    const image = new window.Image();
    image.onload = () => { if (active) setOverlay(tintOpaquePixels(image, width, height, target.tagColor)); };
    image.onerror = () => { if (active) setOverlay(null); };
    image.src = rasterSourceUrl(target.source);
    return () => { active = false; image.onload = null; image.onerror = null; };
  // Rebuild only when the pixels, size or colour change, not on every transform.
  }, [target?.id, target?.type, target?.width, target?.height, target?.tagColor, content]);

  return overlay;
}
