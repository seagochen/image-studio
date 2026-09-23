import type { ImageStudioLayer } from "./document";

export function layerAncestors(layers: ImageStudioLayer[], layerId: string): ImageStudioLayer[] {
  const ancestors: ImageStudioLayer[] = [];
  let current = layers.find((layer) => layer.id === layerId);
  const visited = new Set([layerId]);
  while (current?.parentId && !visited.has(current.parentId)) {
    visited.add(current.parentId);
    const parentId = current.parentId;
    current = layers.find((layer) => layer.id === parentId);
    if (current) ancestors.push(current);
  }
  return ancestors;
}

export function layerIsEditable(layers: ImageStudioLayer[], layerId: string): boolean {
  const layer = layers.find((candidate) => candidate.id === layerId);
  return Boolean(layer && [layer, ...layerAncestors(layers, layerId)].every((candidate) => !candidate.locked && candidate.visible));
}
