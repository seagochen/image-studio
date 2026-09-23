import type { ImageStudioLayer } from "./document";

/**
 * An adjustment layer's mask is derived from position (Issue #171), not a stored
 * reference: every mask-type layer directly above it, within the same parent, with no
 * gap, is collected and combined (multiplied) at render time. This is the single place
 * that walks that scan, so rendering, duplication and merge all agree on what "this
 * adjustment layer's masks" means.
 */
export function adjacentMaskLayerIds(layers: ImageStudioLayer[], layer: ImageStudioLayer): string[] {
  const parentId = layer.parentId ?? null;
  const siblings = layers.filter((candidate) => (candidate.parentId ?? null) === parentId);
  const index = siblings.indexOf(layer);
  if (index < 0) return [];
  const ids: string[] = [];
  for (let i = index + 1; i < siblings.length; i += 1) {
    if (siblings[i].type !== "mask") break;
    ids.push(siblings[i].id);
  }
  return ids;
}
