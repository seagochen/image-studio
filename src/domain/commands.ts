import { layerAncestors, layerIsEditable } from "./layerHierarchy";
import { planLayerMerge } from "./layerMerge";
import { adjacentMaskLayerIds } from "./adjustmentMasking";
import { encodeSelectionRuns } from "./selectionMaskRuns";
import type { PixelSelectionMask } from "./pixelTools";
import {
  cloneDocument,
  createId,
  defaultTransform,
  touchDocument,
  type AnnotationElement,
  type AnnotationLayer,
  type DrawingLayer,
  type GroupLayer,
  type ImageStudioDocument,
  type ImageStudioLayer,
  type LayerTransform,
  type RasterLayer,
  type Stroke,
} from "./document";

type LayerPatch = ImageStudioLayer extends infer Layer
  ? Layer extends ImageStudioLayer ? Partial<Omit<Layer, "id" | "type">> : never
  : never;

export function addLayer(document: ImageStudioDocument, layer: ImageStudioLayer): ImageStudioDocument {
  return update(document, { layers: [...document.layers, layer], selection: { layerId: layer.id } });
}

// Adjustment-layer masking is position-derived (Issue #171: a mask must sit directly above
// its adjustment to take effect), so adding a mask needs precise placement, unlike addLayer's
// always-append-on-top.
export function insertLayerAfter(document: ImageStudioDocument, afterLayerId: string, layer: ImageStudioLayer): ImageStudioDocument {
  const index = document.layers.findIndex((candidate) => candidate.id === afterLayerId);
  if (index < 0) return document;
  const layers = [...document.layers];
  layers.splice(index + 1, 0, layer);
  return update(document, { layers });
}

export function createDrawingLayer(document: ImageStudioDocument, type: "paint" | "mask", name: string): DrawingLayer {
  return {
    id: createId(type), type, name, visible: true, locked: false, opacity: type === "mask" ? 0.55 : 1, blendMode: "normal",
    parentId: null, transform: defaultTransform(), width: document.canvas.width, height: document.canvas.height, strokes: [],
  };
}

/** A newly attached raster mask follows the conventional white-reveals default.
 * Position-derived adjustment masks keep createDrawingLayer's empty/black behavior. */
export function createAttachedRasterMask(document: ImageStudioDocument, owner: ImageStudioLayer, name: string): DrawingLayer {
  const width = owner.width;
  const height = owner.height;
  return {
    ...createDrawingLayer(document, "mask", name), parentId: owner.parentId, width, height,
    strokes: [{
      id: createId("mask-fill"), points: [{ x: width / 2, y: height / 2 }],
      size: Math.hypot(width, height) + 2, mode: "paint", value: 255,
    }],
  };
}

export function attachPaintAsRasterMask(document: ImageStudioDocument, paintId: string, ownerId: string): ImageStudioDocument {
  const paint = document.layers.find((layer) => layer.id === paintId);
  const owner = document.layers.find((layer) => layer.id === ownerId);
  if (!paint || paint.type !== "paint" || !owner || !["raster", "paint", "annotation", "group"].includes(owner.type)
    || owner.id === paint.id || owner.locked || paint.locked || owner.rasterMaskId
    || paint.parentId !== owner.parentId || paint.width !== owner.width || paint.height !== owner.height
    || !sameTransform(paint.transform, owner.transform)) return document;
  const layers = document.layers.map((layer) => layer.id === paint.id ? { ...paint, type: "mask" as const } : layer.id === owner.id ? { ...owner, rasterMaskId: paint.id } : layer);
  return updateStructure(document, layers);
}

export function createAnnotationLayer(document: ImageStudioDocument, name: string): AnnotationLayer {
  return {
    id: createId("annotation"), type: "annotation", name, visible: true, locked: false, opacity: 1, blendMode: "normal",
    parentId: null, transform: defaultTransform(), width: document.canvas.width, height: document.canvas.height, elements: [],
  };
}

/** Keeps existing vector content editable while a new local layer carries a frozen selection mask. */
export function addSelectionMaskedLocalLayer(
  document: ImageStudioDocument, sourceId: string, selection: PixelSelectionMask,
  content: { type: "paint"; name: string; stroke: Stroke; layerId?: string } | { type: "annotation"; name: string; element: AnnotationElement; layerId?: string },
): ImageStudioDocument {
  const source = document.layers.find((layer) => layer.id === sourceId);
  if (!source || !["raster", "paint", "annotation"].includes(source.type) || !layerIsEditable(document.layers, sourceId)
    || source.width !== selection.width || source.height !== selection.height) return document;
  const runs = encodeSelectionRuns(selection);
  const base = content.type === "paint" ? createDrawingLayer(document, "paint", content.name) : createAnnotationLayer(document, content.name);
  const layer = {
    ...base, id: content.layerId ?? base.id, parentId: source.parentId, transform: { ...source.transform }, width: source.width, height: source.height,
    ...(content.type === "paint" ? { strokes: [content.stroke] } : { elements: [content.element] }),
  } as DrawingLayer | AnnotationLayer;
  const mask: DrawingLayer = {
    ...createDrawingLayer(document, "mask", `${content.name} selection`), parentId: source.parentId,
    transform: { ...source.transform }, width: source.width, height: source.height, opacity: 1, selectionRuns: runs,
  };
  layer.rasterMaskId = mask.id;
  return updateStructure(document, [...document.layers, layer, mask], { layerId: layer.id });
}

/** Freeze a temporary selection as the adjacent mask of a new adjustment layer. */
export function addSelectionMaskedAdjustmentLayer(
  document: ImageStudioDocument, sourceId: string, selection: PixelSelectionMask, adjustment: ImageStudioLayer,
): ImageStudioDocument {
  const source = document.layers.find((layer) => layer.id === sourceId);
  if (!source || !["raster", "paint", "annotation"].includes(source.type) || !layerIsEditable(document.layers, sourceId)
    || source.rasterMaskId || adjustment.type !== "adjustment" || (adjustment.parentId ?? null) !== (source.parentId ?? null)
    || source.width !== selection.width || source.height !== selection.height) return document;
  const runs = encodeSelectionRuns(selection);
  const mask: DrawingLayer = {
    ...createDrawingLayer(document, "mask", `${adjustment.name} selection`), parentId: source.parentId,
    transform: { ...source.transform }, width: source.width, height: source.height, opacity: 1, selectionRuns: runs,
  };
  return updateStructure(document, [...document.layers, adjustment, mask], { layerId: adjustment.id });
}

export function createGroupLayer(document: ImageStudioDocument, name: string, parentId: string | null = null): GroupLayer {
  return {
    id: createId("group"), type: "group", name, visible: true, locked: false, opacity: 1, blendMode: "normal",
    parentId, transform: defaultTransform(), width: document.canvas.width, height: document.canvas.height, collapsed: false,
  };
}

export function setAnnotationElements(document: ImageStudioDocument, layerId: string, elements: AnnotationElement[]): ImageStudioDocument {
  const layer = document.layers.find((candidate) => candidate.id === layerId);
  if (!layer || layer.type !== "annotation" || layer.locked) return document;
  return patchLayer(document, layerId, { elements } as Partial<AnnotationLayer>);
}

export function replaceAnnotationElement(document: ImageStudioDocument, layerId: string, element: AnnotationElement): ImageStudioDocument {
  const layer = document.layers.find((candidate) => candidate.id === layerId);
  if (!layer || layer.type !== "annotation" || !layerIsEditable(document.layers, layerId)) return document;
  const previous = layer.elements.find((candidate) => candidate.id === element.id);
  if (!previous || previous.kind !== element.kind || JSON.stringify(previous) === JSON.stringify(element)) return document;
  return patchLayer(document, layerId, { elements: layer.elements.map((candidate) => candidate.id === element.id ? element : candidate) });
}

export function patchLayer(
  document: ImageStudioDocument,
  layerId: string,
  patch: LayerPatch,
): ImageStudioDocument {
  const layers = document.layers.map((layer) => layer.id === layerId ? { ...layer, ...patch } as ImageStudioLayer : layer);
  return update(document, { layers });
}

export function setLayerTransform(document: ImageStudioDocument, layerId: string, transform: LayerTransform): ImageStudioDocument {
  return patchLayer(document, layerId, { transform });
}

export function selectLayer(document: ImageStudioDocument, layerId: string | null): ImageStudioDocument {
  if (document.selection.layerId === layerId) return document;
  return { ...document, selection: { layerId } };
}

export function deleteLayer(document: ImageStudioDocument, layerId: string): ImageStudioDocument {
  const index = document.layers.findIndex((layer) => layer.id === layerId);
  if (index < 0) return document;
  const removed = new Set([layerId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const layer of document.layers) {
      if (layer.parentId && removed.has(layer.parentId) && !removed.has(layer.id)) {
        removed.add(layer.id);
        changed = true;
      }
      if (removed.has(layer.id) && layer.rasterMaskId && !removed.has(layer.rasterMaskId)) {
        removed.add(layer.rasterMaskId);
        changed = true;
      }
    }
  }
  // Deleting an owner removes its companion; deleting the mask alone clears the binding.
  const layers = document.layers.filter((layer) => !removed.has(layer.id)).map((layer) => (
    layer.rasterMaskId && removed.has(layer.rasterMaskId)
      ? { ...layer, rasterMaskId: undefined, rasterMaskInverted: undefined, rasterMaskFeatherPx: undefined } : layer
  ));
  const nextSelection = document.selection.layerId && removed.has(document.selection.layerId)
    ? layers[Math.min(index, layers.length - 1)]?.id ?? null
    : document.selection.layerId;
  return update(document, { layers, selection: { layerId: nextSelection } });
}

export function duplicateLayer(document: ImageStudioDocument, layerId: string): ImageStudioDocument {
  const index = document.layers.findIndex((layer) => layer.id === layerId);
  if (index < 0) return document;
  const original = document.layers[index];
  // An adjustment layer's mask(s) are its immediate upward neighbors (Issue #171); duplicate
  // them along with it so the copy keeps its own mask instead of silently inheriting the
  // original's (which would otherwise become the copy's nearest mask post-insertion, leaving
  // the original unmasked).
  const adjustmentMaskIds = original.type === "adjustment" ? adjacentMaskLayerIds(document.layers, original) : [];
  const copiedIds = new Set(document.layers.filter((layer) =>
    layer.id === layerId || adjustmentMaskIds.includes(layer.id) || isDescendant(document.layers, layer.id, layerId)).map((layer) => layer.id));
  for (const layer of document.layers) if (copiedIds.has(layer.id) && layer.rasterMaskId) copiedIds.add(layer.rasterMaskId);
  const subtree = document.layers.filter((layer) => copiedIds.has(layer.id));
  const ids = new Map(subtree.map((layer) => [layer.id, createId(layer.type)]));
  const copies = cloneDocument({ ...document, layers: subtree }).layers.map((layer) => {
    const copy = { ...layer, id: ids.get(layer.id)!, parentId: ids.get(layer.parentId ?? "") ?? layer.parentId ?? null,
      rasterMaskId: layer.rasterMaskId ? ids.get(layer.rasterMaskId) : undefined };
    if (layer.id === layerId) {
      copy.name = `${original.name} copy`;
      copy.transform = { ...copy.transform, x: copy.transform.x + 16, y: copy.transform.y + 16 };
    }
    return copy;
  });
  const lastBundleLayer = subtree.reduce((last, layer) => document.layers.indexOf(layer) > document.layers.indexOf(last) ? layer : last, original);
  const layers = [...document.layers];
  layers.splice(document.layers.indexOf(lastBundleLayer) + 1, 0, ...copies);
  return updateStructure(document, layers, { layerId: ids.get(layerId)! });
}

export function moveLayer(document: ImageStudioDocument, layerId: string, direction: -1 | 1): ImageStudioDocument {
  const index = document.layers.findIndex((layer) => layer.id === layerId);
  if (index < 0) return document;
  const parentId = document.layers[index].parentId ?? null;
  const siblings = document.layers.filter((layer) => (layer.parentId ?? null) === parentId);
  const siblingIndex = siblings.findIndex((layer) => layer.id === layerId);
  const target = siblings[siblingIndex + direction];
  if (!target) return document;
  const nextIndex = document.layers.findIndex((layer) => layer.id === target.id);
  const layers = [...document.layers];
  [layers[index], layers[nextIndex]] = [layers[nextIndex], layers[index]];
  return updateStructure(document, layers);
}

export type LayerDropPosition = "before" | "after" | "inside";

export function reorderLayer(document: ImageStudioDocument, layerId: string, targetId: string, position: LayerDropPosition): ImageStudioDocument {
  if (layerId === targetId) return document;
  const source = document.layers.find((layer) => layer.id === layerId);
  const target = document.layers.find((layer) => layer.id === targetId);
  if (!source || !target || source.locked || (position === "inside" && target.type !== "group")) return document;
  if (isDescendant(document.layers, target.id, source.id)) return document;
  if (!layerIsEditable(document.layers, source.id) || layerAncestors(document.layers, target.id).some((layer) => layer.locked)
    || (position === "inside" && target.locked)) return document;
  const layers = document.layers.filter((layer) => layer.id !== layerId);
  const targetIndex = layers.findIndex((layer) => layer.id === targetId);
  const parentId = position === "inside" ? target.id : target.parentId ?? null;
  layers.splice(position === "after" ? targetIndex + 1 : targetIndex, 0, { ...source, parentId });
  return updateStructure(document, layers);
}

// Dry-runs groupLayers itself so the UI's enabled/disabled state can never drift from what
// actually happens on click (Issue #169) — groupLayers returns the same document reference,
// unchanged, whenever it declines to group, so a reference check is a correct "would it work?".
export function canGroupLayers(document: ImageStudioDocument, layerIds: string[]): boolean {
  return layerIds.length >= 2 && groupLayers(document, layerIds, "") !== document;
}

export function groupLayers(document: ImageStudioDocument, layerIds: string[], name: string): ImageStudioDocument {
  const unique = [...new Set(layerIds)];
  const selected = document.layers.filter((layer) => unique.includes(layer.id));
  if (!selected.length || selected.some((layer) => layer.locked)) return document;
  const parentId = selected[0].parentId ?? null;
  if (selected.some((layer) => (layer.parentId ?? null) !== parentId)) return document;
  const siblings = document.layers.filter((layer) => (layer.parentId ?? null) === parentId);
  const positions = selected.map((layer) => siblings.findIndex((candidate) => candidate.id === layer.id)).sort((a, b) => a - b);
  if (positions.some((position, index) => position < 0 || (index > 0 && position !== positions[index - 1] + 1))) return document;
  const group = createGroupLayer(document, name, parentId);
  const insertAt = Math.min(...selected.map((layer) => document.layers.findIndex((candidate) => candidate.id === layer.id)));
  const layers = document.layers.map((layer) => unique.includes(layer.id) ? { ...layer, parentId: group.id } : layer);
  layers.splice(insertAt, 0, group);
  return updateStructure(document, layers, { layerId: group.id });
}

export function ungroupLayer(document: ImageStudioDocument, layerId: string): ImageStudioDocument {
  const layer = document.layers.find((candidate) => candidate.id === layerId);
  if (!layer || layer.locked) return document;
  if (layer.type !== "group") {
    if (!layer.parentId) return document;
    const parent = document.layers.find((candidate) => candidate.id === layer.parentId);
    const layers = document.layers.map((candidate) => candidate.id === layer.id ? { ...candidate, parentId: parent?.parentId ?? null } : candidate);
    return updateStructure(document, layers);
  }
  if (layer.rasterMaskId) return document;
  const children = document.layers.filter((candidate) => candidate.parentId === layer.id);
  const childIds = new Set(children.map((child) => child.id));
  const layers = document.layers.filter((candidate) => !childIds.has(candidate.id));
  const index = layers.findIndex((candidate) => candidate.id === layerId);
  layers.splice(index, 1, ...children.map((child) => ({ ...child, parentId: layer.parentId ?? null })));
  return updateStructure(document, layers, { layerId: children[0]?.id ?? null });
}

export function canUngroupLayer(document: ImageStudioDocument, layerId: string): boolean {
  return ungroupLayer(document, layerId) !== document;
}

export function replaceAdjacentLayers(
  document: ImageStudioDocument,
  layerId: string,
  direction: -1 | 1,
  merged: RasterLayer,
  expected?: ImageStudioDocument,
): ImageStudioDocument {
  if (expected && (document.id !== expected.id || document.layers !== expected.layers)) return document;
  const plan = planLayerMerge(document, layerId, direction);
  if (!plan) return document;
  const insertAt = Math.min(...[plan.source, plan.target].map((layer) => document.layers.indexOf(layer)));
  const layers = document.layers.flatMap((layer, index) => [
    ...(index === insertAt ? [{ ...merged, parentId: plan.source.parentId ?? null }] : []),
    ...(plan.removedIds.has(layer.id) ? [] : [layer]),
  ]);
  return updateStructure(document, layers, { layerId: merged.id });
}

export function addStroke(document: ImageStudioDocument, layerId: string, stroke: Stroke): ImageStudioDocument {
  const layer = document.layers.find((candidate) => candidate.id === layerId);
  if (!layer || (layer.type !== "paint" && layer.type !== "mask") || layer.locked) return document;
  return patchLayer(document, layerId, { strokes: [...layer.strokes, stroke] } as Partial<DrawingLayer>);
}

export function replaceLastStroke(document: ImageStudioDocument, layerId: string, stroke: Stroke): ImageStudioDocument {
  const layer = document.layers.find((candidate) => candidate.id === layerId);
  if (!layer || (layer.type !== "paint" && layer.type !== "mask") || layer.strokes.at(-1)?.id !== stroke.id) return document;
  return patchLayer(document, layerId, { strokes: [...layer.strokes.slice(0, -1), stroke] } as Partial<DrawingLayer>);
}

export function alignLayer(document: ImageStudioDocument, layerId: string, axis: "horizontal" | "vertical"): ImageStudioDocument {
  const layer = document.layers.find((candidate) => candidate.id === layerId);
  if (!layer || layer.locked) return document;
  const transform = { ...layer.transform };
  if (axis === "horizontal") transform.x = (document.canvas.width - layer.width * transform.scaleX) / 2;
  else transform.y = (document.canvas.height - layer.height * transform.scaleY) / 2;
  return setLayerTransform(document, layerId, transform);
}

export function cropToLayer(document: ImageStudioDocument, layerId: string): ImageStudioDocument {
  const layer = document.layers.find((candidate) => candidate.id === layerId);
  if (!layer || layer.transform.rotation % 360 !== 0) return document;
  const width = Math.max(1, Math.round(layer.width * Math.abs(layer.transform.scaleX)));
  const height = Math.max(1, Math.round(layer.height * Math.abs(layer.transform.scaleY)));
  const offsetX = layer.transform.x;
  const offsetY = layer.transform.y;
  const layers = document.layers.map((candidate) => ({
    ...candidate,
    transform: { ...candidate.transform, x: candidate.transform.x - offsetX, y: candidate.transform.y - offsetY },
  }));
  return update(document, { canvas: { width, height }, layers });
}

export function replaceRasterLayer(
  document: ImageStudioDocument,
  layerId: string,
  replacement: Pick<RasterLayer, "width" | "height" | "source"> & { resetPosition?: boolean },
): ImageStudioDocument {
  const layer = document.layers.find((candidate) => candidate.id === layerId);
  if (!layer || layer.type !== "raster" || layer.locked) return document;
  if (layer.rasterMaskId && (replacement.width !== layer.width || replacement.height !== layer.height)) return document;
  // Most callers replace a layer's own local pixels, so keeping its x/y anchor is correct.
  // A caller compositing a full-canvas, already-absolutely-positioned result (e.g. baking an
  // adjustment) passes resetPosition so that position isn't applied a second time on top.
  const transform = replacement.resetPosition
    ? { ...layer.transform, x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 }
    : { ...layer.transform, scaleX: 1, scaleY: 1, rotation: 0 };
  return patchLayer(document, layerId, {
    width: replacement.width,
    height: replacement.height,
    source: replacement.source,
    transform,
  } as Partial<RasterLayer>);
}

export function replaceRasterPixels(
  document: ImageStudioDocument,
  layerId: string,
  source: RasterLayer["source"],
): ImageStudioDocument {
  const layer = document.layers.find((candidate) => candidate.id === layerId);
  if (!layer || layer.type !== "raster" || layer.locked) return document;
  return patchLayer(document, layerId, { source } as Partial<RasterLayer>);
}

function update(document: ImageStudioDocument, patch: Partial<ImageStudioDocument>): ImageStudioDocument {
  return touchDocument({ ...document, ...patch });
}

function updateStructure(document: ImageStudioDocument, layers: ImageStudioLayer[], selection = document.selection): ImageStudioDocument {
  const byId = new Map(layers.map((layer) => [layer.id, layer]));
  const claimed = new Set(layers.filter((layer) => layer.type === "adjustment")
    .flatMap((layer) => adjacentMaskLayerIds(layers, layer)));
  const owned = new Set<string>();
  for (const layer of layers) {
    if (!layer.rasterMaskId) continue;
    if (!["raster", "paint", "annotation", "group"].includes(layer.type)) return document;
    const mask = byId.get(layer.rasterMaskId);
    if (!mask || mask.type !== "mask" || (mask.parentId ?? null) !== (layer.parentId ?? null)
      || mask.width !== layer.width || mask.height !== layer.height
      || claimed.has(mask.id) || owned.has(mask.id)) return document;
    owned.add(mask.id);
  }
  return update(document, { layers, selection });
}

function sameTransform(left: LayerTransform, right: LayerTransform): boolean {
  return left.x === right.x && left.y === right.y && left.scaleX === right.scaleX
    && left.scaleY === right.scaleY && left.rotation === right.rotation;
}

function isDescendant(layers: ImageStudioLayer[], candidateId: string, ancestorId: string): boolean {
  let current = layers.find((layer) => layer.id === candidateId);
  const visited = new Set<string>();
  while (current?.parentId) {
    if (current.parentId === ancestorId) return true;
    if (visited.has(current.parentId)) return false;
    visited.add(current.parentId);
    current = layers.find((layer) => layer.id === current?.parentId);
  }
  return false;
}
