import type { ImageStudioDocument, ImageStudioLayer } from "./document";
import { layerIsEditable } from "./layerHierarchy";
import { adjacentMaskLayerIds } from "./adjustmentMasking";

export interface LayerMergePlan {
  source: ImageStudioLayer;
  target: ImageStudioLayer;
  includedIds: Set<string>;
  removedIds: Set<string>;
}

/** Pair flattening is safe only when no omitted backdrop participates in the result. */
export function planLayerMerge(document: ImageStudioDocument, layerId: string, direction: -1 | 1): LayerMergePlan | null {
  const source = document.layers.find((layer) => layer.id === layerId);
  if (!source) return null;
  // Masks aren't ordinary stacked content for pairing purposes (Issue #171): a mask sits
  // above the adjustment it belongs to, which is orthogonal to merging that adjustment with
  // whatever is below it, so masks are excluded from the sibling list used to find a neighbor.
  const masks = new Set(document.layers.filter((layer) => layer.type === "adjustment")
    .flatMap((layer) => adjacentMaskLayerIds(document.layers, layer)));
  for (const layer of document.layers) if (layer.rasterMaskId) masks.add(layer.rasterMaskId);
  const siblings = document.layers.filter((layer) => (layer.parentId ?? null) === (source.parentId ?? null) && !masks.has(layer.id));
  const index = siblings.indexOf(source);
  const target = siblings[index + direction];
  if (index < 0 || !target) return null;
  const pair = direction === 1 ? [source, target] : [target, source];
  if (pair.some((layer) => !layerIsEditable(document.layers, layer.id) || layer.type === "group" || layer.type === "mask" || layer.blendMode !== "normal")) return null;
  // A top adjustment can be baked only with the entire preceding sibling stack.
  if (pair[0].type === "adjustment" || (pair[1].type === "adjustment" && siblings.indexOf(pair[0]) !== 0)) return null;
  const includedIds = new Set(pair.map((layer) => layer.id));
  const removedIds = new Set(includedIds);
  for (const layer of pair) {
    if (layer.rasterMaskId) { includedIds.add(layer.rasterMaskId); removedIds.add(layer.rasterMaskId); }
    if (layer.type !== "adjustment") continue;
    for (const maskId of adjacentMaskLayerIds(document.layers, layer)) { includedIds.add(maskId); removedIds.add(maskId); }
  }
  return { source, target, includedIds, removedIds };
}
