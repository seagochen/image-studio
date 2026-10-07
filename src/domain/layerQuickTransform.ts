import { setLayerTransform } from "./commands";
import { layerIsEditable } from "./layerHierarchy";
import type { ImageStudioDocument, LayerTransform } from "./document";

export type QuickTransform = "rotate-left" | "rotate-right" | "flip-horizontal" | "flip-vertical";

/** Keep the layer center fixed and let the shared command move its linked mask. */
export function quickTransformLayer(document: ImageStudioDocument, layerId: string, operation: QuickTransform): ImageStudioDocument {
  const layer = document.layers.find((candidate) => candidate.id === layerId);
  if (!layer || layer.type === "adjustment" || layer.type === "mask" || !layerIsEditable(document.layers, layerId)) return document;
  const before = layer.transform;
  const after = { ...before };
  if (operation === "rotate-left") after.rotation -= 90;
  else if (operation === "rotate-right") after.rotation += 90;
  else if (operation === "flip-horizontal") after.scaleX *= -1;
  else after.scaleY *= -1;
  const offset = (transform: LayerTransform) => {
    const angle = transform.rotation * Math.PI / 180;
    const x = layer.width * transform.scaleX / 2;
    const y = layer.height * transform.scaleY / 2;
    return { x: x * Math.cos(angle) - y * Math.sin(angle), y: x * Math.sin(angle) + y * Math.cos(angle) };
  };
  const previousOffset = offset(before), nextOffset = offset(after);
  after.x += previousOffset.x - nextOffset.x;
  after.y += previousOffset.y - nextOffset.y;
  return setLayerTransform(document, layerId, after);
}
