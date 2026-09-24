import { createEmptyDocument, parseDocument, serializeDocument } from "../domain/document";
import {
  addLayer, attachPaintAsRasterMask, canGroupLayers, canUngroupLayer, createAttachedRasterMask, createGroupLayer, duplicateLayer, patchLayer, createDrawingLayer, deleteLayer, groupLayers, moveLayer, reorderLayer, replaceAdjacentLayers, ungroupLayer,
} from "../domain/commands";
import { rasterLayerFromImage } from "../domain/importImage";
import { createAdjustmentLayer } from "../domain/adjustmentEngine";
import { adjacentMaskLayerIds } from "../domain/adjustmentMasking";
import { planLayerMerge } from "../domain/layerMerge";
import { DocumentHistory } from "../domain/history";

describe("Image Studio layer hierarchy", () => {
  const layers = () => {
    const initial = createEmptyDocument();
    const first = createDrawingLayer(initial, "paint", "First");
    const second = createDrawingLayer(initial, "paint", "Second");
    return { first, second, document: addLayer(addLayer(initial, first), second) };
  };

  it("groups, nests, reorders and ungroups layers reversibly", () => {
    const setup = layers();
    const grouped = groupLayers(setup.document, [setup.first.id, setup.second.id], "Group");
    const group = grouped.layers.find((layer) => layer.type === "group")!;
    expect(grouped.layers.filter((layer) => layer.parentId === group.id)).toHaveLength(2);
    const reordered = moveLayer(grouped, setup.first.id, 1);
    expect(reordered).not.toBe(grouped);
    const nested = reorderLayer(reordered, setup.first.id, group.id, "inside");
    expect(nested.layers.find((layer) => layer.id === setup.first.id)?.parentId).toBe(group.id);
    const ungrouped = ungroupLayer(nested, group.id);
    expect(ungrouped.layers.some((layer) => layer.type === "group")).toBe(false);
    expect(ungrouped.layers.every((layer) => !layer.parentId)).toBe(true);
  });

  it("deletes group descendants and rejects cyclic documents", () => {
    const setup = layers();
    const grouped = groupLayers(setup.document, [setup.first.id, setup.second.id], "Group");
    const group = grouped.layers.find((layer) => layer.type === "group")!;
    const selectedChild = { ...grouped, selection: { layerId: setup.first.id } };
    const deleted = deleteLayer(selectedChild, group.id);
    expect(deleted.layers).toHaveLength(0);
    expect(deleted.selection.layerId).toBeNull();
    const cyclic = { ...grouped, layers: grouped.layers.map((layer) => layer.id === group.id ? { ...layer, parentId: setup.first.id } : layer) };
    expect(() => parseDocument(JSON.stringify(cyclic))).toThrow();
  });

  it("loses its mask when the adjacent mask is deleted (position-derived, Issue #171)", () => {
    const initial = createEmptyDocument();
    const adjustment = createAdjustmentLayer(initial, "exposure", "Exposure");
    const mask = createDrawingLayer(initial, "mask", "Mask");
    const document = addLayer(addLayer(initial, adjustment), mask); // mask directly above the adjustment
    expect(adjacentMaskLayerIds(document.layers, adjustment)).toEqual([mask.id]);
    const deleted = deleteLayer(document, mask.id);
    expect(adjacentMaskLayerIds(deleted.layers, adjustment)).toEqual([]);
  });

  it("removes the mask alongside its adjustment when merged", () => {
    const initial = createEmptyDocument();
    const raster = rasterLayerFromImage({ dataUrl: "data:image/png;base64,AA==", mimeType: "image/png", width: 10, height: 10, name: "Raster" });
    const adjustment = createAdjustmentLayer(initial, "exposure", "Exposure");
    const mask = createDrawingLayer(initial, "mask", "Mask");
    const document = addLayer(addLayer(addLayer(initial, raster), adjustment), mask); // raster, adjustment, mask directly above it
    const merged = rasterLayerFromImage({ dataUrl: "data:image/png;base64,AA==", mimeType: "image/png", width: 10, height: 10, name: "Merged" });
    const result = replaceAdjacentLayers(document, adjustment.id, -1, merged);
    expect(result.layers).toEqual([expect.objectContaining({ id: merged.id })]);
  });

  it("computes group eligibility without mutating the document (canGroupLayers, Issue #169)", () => {
    const setup = layers();
    expect(canGroupLayers(setup.document, [setup.first.id])).toBe(false);
    expect(canGroupLayers(setup.document, [setup.first.id, setup.second.id])).toBe(true);
    const locked = patchLayer(setup.document, setup.first.id, { locked: true });
    expect(canGroupLayers(locked, [setup.first.id, setup.second.id])).toBe(false);
    expect(setup.document.layers).toHaveLength(2);
  });

  it("replaces adjacent siblings with the rasterized merge result", () => {
    const setup = layers();
    const merged = rasterLayerFromImage({ dataUrl: "data:image/png;base64,AA==", mimeType: "image/png", width: 10, height: 10, name: "Merged" });
    const result = replaceAdjacentLayers(setup.document, setup.first.id, 1, merged);
    expect(result.layers).toHaveLength(1);
    expect(result.layers[0]).toMatchObject({ id: merged.id, name: "Merged" });
  });
});

describe("layer structure regression boundaries", () => {
  function setup() {
    let document = createEmptyDocument();
    const group = createGroupLayer(document, "Group");
    const nested = createGroupLayer(document, "Nested", group.id);
    const child = { ...createDrawingLayer(document, "paint", "Child"), parentId: nested.id };
    for (const layer of [group, nested, child]) document = addLayer(document, layer);
    return { document, group, nested, child };
  }
  it.each(["before", "after", "inside"] as const)("rejects %s drops against descendants", (position) => {
    const { document, group, nested, child } = setup();
    for (const target of [nested, child]) expect(reorderLayer(document, group.id, target.id, position)).toBe(document);
    expect(parseDocument(JSON.stringify(document))).toEqual(document);
  });
  it("duplicates a nested subtree and preserves adjustment/mask adjacency (Issue #171)", () => {
    const { document, group, nested } = setup();
    const adjustment = createAdjustmentLayer(document, "invert", "Invert", nested.id);
    const mask = { ...createDrawingLayer(document, "mask", "Mask"), parentId: nested.id };
    const source = addLayer(addLayer(document, adjustment), mask); // mask directly above the adjustment
    const duplicate = duplicateLayer(source, group.id);
    const copies = duplicate.layers.filter((layer) => !source.layers.some((original) => original.id === layer.id));
    expect(copies).toHaveLength(source.layers.length);
    expect(new Set(duplicate.layers.map((layer) => layer.id)).size).toBe(duplicate.layers.length);
    const copiedAdjustment = copies.find((layer) => layer.type === "adjustment")!;
    const copiedMask = copies.find((layer) => layer.type === "mask")!;
    const ids = duplicate.layers.map((layer) => layer.id);
    expect(ids.indexOf(copiedMask.id)).toBe(ids.indexOf(copiedAdjustment.id) + 1);
    expect(copiedMask.parentId).toBe(copiedAdjustment.parentId);
    expect(parseDocument(JSON.stringify(duplicate))).toEqual(duplicate);
    expect(copies.find((layer) => layer.name === "Child")?.transform).toEqual(source.layers.find((layer) => layer.name === "Child")?.transform);
  });
  it("keeps mask adjacency across a group move but lets a lone reorder split it (Issue #171)", () => {
    const { document, group, nested } = setup();
    const adjustment = createAdjustmentLayer(document, "invert", "Invert");
    const mask = createDrawingLayer(document, "mask", "Mask");
    const source = addLayer(addLayer(document, adjustment), mask); // adjustment then its mask, both top-level
    expect(adjacentMaskLayerIds(source.layers, adjustment)).toEqual([mask.id]);

    // Position is the only source of truth now (no explicit reference to protect), so moving
    // just the adjustment into another group is structurally allowed — it simply ends up
    // unmasked, since its old mask stays behind at the top level.
    const split = reorderLayer(source, adjustment.id, group.id, "inside");
    expect(split).not.toBe(source);
    const splitAdjustment = split.layers.find((layer) => layer.id === adjustment.id)!;
    expect(adjacentMaskLayerIds(split.layers, splitAdjustment)).toEqual([]);

    // Grouping the adjustment with its mask keeps them adjacent, and moving that group
    // preserves the adjacency inside it — no special-case handling needed for groups.
    expect(canGroupLayers(source, [adjustment.id, mask.id])).toBe(true);
    const grouped = groupLayers(source, [adjustment.id, mask.id], "Pair");
    expect(grouped).not.toBe(source);
    const pairGroupId = grouped.selection.layerId!;
    const moved = reorderLayer(grouped, pairGroupId, nested.id, "inside");
    const movedAdjustment = moved.layers.find((layer) => layer.id === adjustment.id)!;
    expect(adjacentMaskLayerIds(moved.layers, movedAdjustment)).toEqual([mask.id]);
    expect(parseDocument(JSON.stringify(moved))).toEqual(moved);
  });
});

describe("general raster mask structure", () => {
  function maskedRaster() {
    const empty = createEmptyDocument();
    const raster = rasterLayerFromImage({ dataUrl: "data:image/png;base64,AA==", mimeType: "image/png", width: 10, height: 10, name: "Raster" });
    const mask = createAttachedRasterMask(empty, raster, "Owned mask");
    const document = addLayer(addLayer(empty, { ...raster, rasterMaskId: mask.id }), mask);
    return { document, raster, mask };
  }

  it("duplicates an owner and its private mask with remapped IDs across save and undo", () => {
    const { document, raster, mask } = maskedRaster();
    const next = duplicateLayer(document, raster.id);
    const copy = next.layers.find((layer) => layer.name === "Raster copy")!;
    expect(copy.rasterMaskId).toBeTruthy();
    expect(copy.rasterMaskId).not.toBe(mask.id);
    expect(next.layers.find((layer) => layer.id === copy.rasterMaskId)).toMatchObject({ type: "mask", parentId: null });
    expect(parseDocument(serializeDocument(next))).toEqual(next);
    const history = new DocumentHistory();
    const recorded = history.execute(document, next, "Duplicate masked layer");
    expect(history.undo(recorded)).toEqual(document);
    expect(history.redo(document)).toEqual(next);
  });

  it("preserves nested private masks when duplicating a group", () => {
    const { document, raster, mask } = maskedRaster();
    const grouped = groupLayers(document, [raster.id, mask.id], "Masked group");
    const group = grouped.layers.find((layer) => layer.type === "group")!;
    const copied = duplicateLayer(grouped, group.id);
    const copiedGroup = copied.layers.find((layer) => layer.name === "Masked group copy")!;
    const copiedRaster = copied.layers.find((layer) => layer.type === "raster" && layer.parentId === copiedGroup.id)!;
    expect(copiedRaster.rasterMaskId).not.toBe(mask.id);
    expect(copied.layers.find((layer) => layer.id === copiedRaster.rasterMaskId)?.parentId).toBe(copiedGroup.id);
    expect(parseDocument(serializeDocument(copied))).toEqual(copied);
  });

  it("duplicates a masked Group together with its external companion", () => {
    const empty = createEmptyDocument();
    const group = createGroupLayer(empty, "Masked group");
    const paint = { ...createDrawingLayer(empty, "paint", "Paint"), parentId: group.id };
    const mask = createAttachedRasterMask(empty, group, "Group mask");
    const document = { ...empty, layers: [{ ...group, rasterMaskId: mask.id }, paint, mask] };
    const duplicated = duplicateLayer(document, group.id);
    const copy = duplicated.layers.find((layer) => layer.name === "Masked group copy")!;
    expect(copy.rasterMaskId).not.toBe(mask.id);
    expect(duplicated.layers.find((layer) => layer.id === copy.rasterMaskId)).toMatchObject({ type: "mask", parentId: null });
    expect(duplicated.layers.find((layer) => layer.name === "Paint" && layer.parentId === copy.id)).toBeTruthy();
    expect(parseDocument(serializeDocument(duplicated))).toEqual(duplicated);
  });

  it("rejects structural moves that split owner and mask, while allowing their joint group", () => {
    const { document, raster, mask } = maskedRaster();
    const group = createGroupLayer(document, "Target");
    const withGroup = addLayer(document, group);
    expect(canGroupLayers(document, [raster.id])).toBe(false);
    expect(groupLayers(document, [raster.id, mask.id], "Valid")).not.toBe(document);
    expect(reorderLayer(withGroup, raster.id, group.id, "inside")).toBe(withGroup);
    expect(reorderLayer(withGroup, mask.id, group.id, "inside")).toBe(withGroup);
    expect(parseDocument(serializeDocument(withGroup))).toEqual(withGroup);
    const grouped = groupLayers(document, [raster.id, mask.id], "Masked group");
    const ownedGroup = grouped.layers.find((layer) => layer.type === "group")!;
    const groupMask = createAttachedRasterMask(grouped, ownedGroup, "Group mask");
    const withGroupMask = { ...grouped, layers: [...grouped.layers.map((layer) => layer.id === ownedGroup.id ? { ...layer, rasterMaskId: groupMask.id } : layer), groupMask] };
    expect(canUngroupLayer(withGroupMask, ownedGroup.id)).toBe(false);
    expect(ungroupLayer(withGroupMask, ownedGroup.id)).toBe(withGroupMask);
  });

  it("deletes an owner's mask, or clears the binding when only the mask is deleted", () => {
    const { document, raster, mask } = maskedRaster();
    expect(deleteLayer(document, raster.id).layers).toEqual([]);
    const withoutMask = deleteLayer(document, mask.id);
    expect(withoutMask.layers).toHaveLength(1);
    expect(withoutMask.layers[0].rasterMaskId).toBeUndefined();
    expect(parseDocument(serializeDocument(withoutMask))).toEqual(withoutMask);
  });

  it("includes owned masks in the merge image and removes them atomically", () => {
    const { document, raster, mask } = maskedRaster();
    const other = rasterLayerFromImage({ dataUrl: "data:image/png;base64,AA==", mimeType: "image/png", width: 10, height: 10, name: "Other" });
    const withOther = addLayer(document, other);
    const plan = planLayerMerge(withOther, raster.id, 1)!;
    expect(plan.target.id).toBe(other.id);
    expect(plan.includedIds.has(mask.id)).toBe(true);
    expect(plan.removedIds.has(mask.id)).toBe(true);
    const merged = replaceAdjacentLayers(withOther, raster.id, 1, other);
    expect(merged.layers).toHaveLength(1);
    expect(parseDocument(serializeDocument(merged))).toEqual(merged);
  });

  it("does not reinterpret a displaced or locked Paint layer as an owned mask", () => {
    const { document, raster } = maskedRaster();
    const owner = { ...raster, rasterMaskId: undefined };
    const paint = createDrawingLayer(document, "paint", "Brush mask");
    const candidate = { ...document, layers: [owner, paint] };
    expect(attachPaintAsRasterMask(candidate, paint.id, owner.id)).toBe(candidate);
    const sameSize = { ...paint, width: owner.width, height: owner.height };
    const aligned = { ...candidate, layers: [owner, sameSize] };
    expect(attachPaintAsRasterMask(aligned, paint.id, owner.id)).not.toBe(aligned);
    const displaced = { ...aligned, layers: [owner, { ...sameSize, transform: { ...sameSize.transform, x: 12 } }] };
    expect(attachPaintAsRasterMask(displaced, paint.id, owner.id)).toBe(displaced);
    const locked = { ...aligned, layers: [owner, { ...sameSize, locked: true }] };
    expect(attachPaintAsRasterMask(locked, paint.id, owner.id)).toBe(locked);
  });
});
