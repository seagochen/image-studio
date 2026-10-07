import { addLayer } from "./commands";
import type { ImageStudioDocument } from "./document";
import { rasterLayerFromImage, validateImageDimensions, type DecodedImage } from "./importImage";
import { layerMatrix, matrixPoint } from "./layerGeometry";

/** Apply native result pixels and their required canvas extent in one undoable change. */
export function applyAiResult(document: ImageStudioDocument, image: DecodedImage, inputLayerId: string) {
  const source = document.layers.find((layer) => layer.id === inputLayerId);
  if (!source || source.type !== "raster") throw new Error("AI source layer is missing");
  const layer = { ...rasterLayerFromImage(image), parentId: source.parentId, transform: { ...source.transform } };
  const added = addLayer(document, layer);
  if (source.width === image.width && source.height === image.height) return { document: added, resultLayerId: layer.id };
  const matrix = layerMatrix(added, layer);
  const corners = [[0, 0], [image.width, 0], [0, image.height], [image.width, image.height]]
    .map(([x, y]) => matrixPoint(matrix, { x, y }));
  const left = Math.min(0, Math.floor(Math.min(...corners.map((point) => point.x))));
  const top = Math.min(0, Math.floor(Math.min(...corners.map((point) => point.y))));
  const canvas = {
    width: Math.max(document.canvas.width, Math.ceil(Math.max(...corners.map((point) => point.x)))) - left,
    height: Math.max(document.canvas.height, Math.ceil(Math.max(...corners.map((point) => point.y)))) - top,
  };
  if (validateImageDimensions(canvas.width, canvas.height)) throw new Error("AI result would exceed canvas size limits");
  const expanded = { ...added, canvas,
    layers: !left && !top ? added.layers : added.layers.map((item) => item.parentId ? item : {
      ...item, transform: { ...item.transform, x: item.transform.x - left, y: item.transform.y - top },
    }),
    ...(added.guides ? { guides: added.guides.map((guide) => ({ ...guide, position: guide.position - (guide.axis === "x" ? left : top) })) } : {}),
  };
  return { document: expanded, resultLayerId: layer.id };
}
