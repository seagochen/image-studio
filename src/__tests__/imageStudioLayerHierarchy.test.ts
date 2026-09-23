import { createEmptyDocument, parseDocument } from "../domain/document";
import {
  addLayer, canGroupLayers, createGroupLayer, duplicateLayer, patchLayer, createDrawingLayer, deleteLayer, groupLayers, moveLayer, reorderLayer, replaceAdjacentLayers, ungroupLayer,
} from "../domain/commands";
import { rasterLayerFromImage } from "../domain/importImage";
import { createAdjustmentLayer } from "../domain/adjustmentEngine";
import { adjacentMaskLayerIds } from "../domain/adjustmentMasking";

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
