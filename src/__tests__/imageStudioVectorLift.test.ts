import { createEmptyDocument, parseDocument, serializeDocument, type AnnotationRectElement, type AnnotationLayer, type DrawingLayer } from "../domain/document";
import { addLayer, createAnnotationLayer, createAttachedRasterMask, createDrawingLayer, createGroupLayer,
  liftSelectedVectorLayer, patchLayer, replaceAnnotationElement, setLayerTransform } from "../domain/commands";
import { DocumentHistory } from "../domain/history";
import type { PixelSelectionMask } from "../domain/pixelTools";

const selection = (width: number, pixels: number[]): PixelSelectionMask =>
  ({ width, height: 1, pixels: Uint8Array.from(pixels) });

describe("Image Studio existing vector selection lift", () => {
  it.each(["paint", "annotation"] as const)("splits %s into complementary editable regions in one undo step", (kind) => {
    const empty = { ...createEmptyDocument(), canvas: { width: 4, height: 1 } };
    const group = createGroupLayer(empty, "Nested");
    const source: DrawingLayer | AnnotationLayer = kind === "paint"
      ? { ...createDrawingLayer(empty, "paint", "Original"), width: 4, height: 1, parentId: group.id,
        strokes: [{ id: "stroke-1", points: [{ x: 0, y: 0 }, { x: 3, y: 0 }], size: 1,
          mode: "paint" as const, value: 255, color: "#ff0000" }] }
      : { ...createAnnotationLayer(empty, "Original"), width: 4, height: 1, parentId: group.id,
        elements: [{ id: "rect-1", kind: "rect" as const, x: 0, y: 0, width: 4, height: 1, rotation: 0,
          fill: "#ff0000", stroke: "#ff0000", strokeWidth: 0, cornerRadius: 0 }] };
    const before = addLayer(addLayer(empty, group), source);
    const after = liftSelectedVectorLayer(before, source.id, selection(4, [0, 1, 1, 0]));
    expect(after).not.toBe(before);
    expect(after.layers).toHaveLength(5);
    const outside = after.layers.find((layer) => layer.id === source.id)!;
    const local = after.layers.find((layer) => layer.id === after.selection.layerId)!;
    expect(outside).toMatchObject({ rasterMaskInverted: true, parentId: group.id });
    expect(local).toMatchObject({ type: kind, parentId: group.id, transform: source.transform });
    expect(local.id).not.toBe(source.id);
    expect(after.layers.find((layer) => layer.id === outside.rasterMaskId)).toMatchObject({ selectionRuns: [1, 2, 1] });
    expect(after.layers.find((layer) => layer.id === local.rasterMaskId)).toMatchObject({ selectionRuns: [1, 2, 1] });
    expect(parseDocument(serializeDocument(after))).toEqual(after);
    const history = new DocumentHistory();
    const recorded = history.execute(before, after, "Lift vector selection");
    expect(history.undo(recorded)).toEqual(before);
    expect(history.redo(before)).toEqual(after);
    const moved = setLayerTransform(after, local.id, { ...local.transform, x: 2, scaleX: 1.5, rotation: 20 });
    expect(moved.layers.find((layer) => layer.id === source.id)?.transform).toEqual(source.transform);
    expect(moved.layers.find((layer) => layer.id === local.id)?.transform).toMatchObject({ x: 2, scaleX: 1.5, rotation: 20 });
    expect(moved.layers.find((layer) => layer.id === local.rasterMaskId)?.transform).toEqual(moved.layers.find((layer) => layer.id === local.id)?.transform);
    if (kind === "annotation" && local.type === "annotation") {
      const changed = replaceAnnotationElement(after, local.id, { ...(local.elements[0] as AnnotationRectElement), fill: "#00ff00" });
      expect(changed.layers.find((layer) => layer.id === source.id)).toEqual(outside);
      expect(changed.layers.find((layer) => layer.id === local.id)).toMatchObject({ elements: [expect.objectContaining({ fill: "#00ff00" })] });
    }
  });

  it("preserves an existing owned mask and rejects a locked source", () => {
    const empty = { ...createEmptyDocument(), canvas: { width: 4, height: 1 } };
    const source = { ...createDrawingLayer(empty, "paint", "Original"), width: 4, height: 1,
      strokes: [{ id: "stroke-1", points: [{ x: 1, y: 0 }], size: 1, mode: "paint" as const, value: 255 }] };
    const before = addLayer(empty, source);
    const mask = { ...createAttachedRasterMask(before, source, "Owned"), width: 4, height: 1 };
    const masked = { ...before, layers: [
      { ...source, rasterMaskId: mask.id, rasterMaskInverted: true, rasterMaskFeatherPx: 2 },
      { ...mask, strokes: [], selectionRuns: [0, 4] },
    ] };
    const lifted = liftSelectedVectorLayer(masked, source.id, selection(4, [0, 1, 1, 0]));
    expect(lifted).not.toBe(masked);
    expect(lifted.layers).toHaveLength(4);
    const outside = lifted.layers.find((layer) => layer.id === source.id)!;
    const local = lifted.layers.find((layer) => layer.id === lifted.selection.layerId)!;
    expect(outside).toMatchObject({ rasterMaskId: mask.id, rasterMaskInverted: true, rasterMaskFeatherPx: 2 });
    expect(lifted.layers.find((layer) => layer.id === mask.id)).toMatchObject({ clipRuns: [0, 1, 2, 1] });
    expect(local).toMatchObject({ type: "paint", rasterMaskInverted: true, rasterMaskFeatherPx: 2 });
    expect(lifted.layers.find((layer) => layer.id === local.rasterMaskId)).toMatchObject({ clipRuns: [1, 2, 1] });
    expect(parseDocument(serializeDocument(lifted))).toEqual(lifted);
    const second = liftSelectedVectorLayer(lifted, local.id, selection(4, [0, 0, 1, 0]));
    expect(second).not.toBe(lifted);
    expect(second.layers).toHaveLength(6);
    expect(second.layers.find((layer) => layer.id === local.rasterMaskId)).toMatchObject({ clipRuns: [1, 1, 2] });
    const secondLocal = second.layers.find((layer) => layer.id === second.selection.layerId)!;
    expect(second.layers.find((layer) => layer.id === secondLocal.rasterMaskId)).toMatchObject({ clipRuns: [2, 1, 1] });
    expect(parseDocument(serializeDocument(second))).toEqual(second);
    expect(liftSelectedVectorLayer(lifted, local.id, selection(4, [1, 0, 0, 0]))).toBe(lifted);
    const locked = patchLayer(before, source.id, { locked: true });
    expect(liftSelectedVectorLayer(locked, source.id, selection(4, [0, 1, 1, 0]))).toBe(locked);
  });
});
