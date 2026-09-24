import { addSelectionMaskedLocalLayer, addLayer, createDrawingLayer, duplicateLayer } from "../domain/commands";
import { createEmptyDocument, parseDocument, serializeDocument } from "../domain/document";
import { encodeSelectionRuns, paintSelectionRuns } from "../domain/selectionMaskRuns";
import { DocumentHistory } from "../domain/history";

describe("Image Studio selection-derived local masks", () => {
  it("encodes a binary selection and draws its exact runs", () => {
    const selection = { width: 3, height: 2, pixels: new Uint8Array([0, 1, 1, 0, 0, 1]) };
    const runs = encodeSelectionRuns(selection);
    expect(runs).toEqual([1, 2, 2, 1]);
    const rects: number[][] = [];
    paintSelectionRuns({ fillRect: (...rect: number[]) => rects.push(rect) } as unknown as CanvasRenderingContext2D, runs, 3, 2);
    expect(rects).toEqual([[1, 0, 2, 1], [2, 1, 1, 1]]);
  });

  it("keeps a Paint source editable while saving and duplicating the new local layer with its private mask", () => {
    const initial = { ...createEmptyDocument(), canvas: { width: 3, height: 2 } };
    const source = { ...createDrawingLayer(initial, "paint", "Original"), width: 3, height: 2 };
    const document = addLayer(initial, source);
    const stroke = { id: "stroke-local", points: [{ x: 1, y: 0 }], size: 1, mode: "paint" as const, value: 255 };
    const next = addSelectionMaskedLocalLayer(document, source.id,
      { width: 3, height: 2, pixels: new Uint8Array([0, 1, 1, 0, 0, 1]) },
      { type: "paint", name: "Local paint", stroke, layerId: "local-paint" });
    expect(next.layers).toHaveLength(3);
    expect(next.layers[0]).toEqual(source);
    expect(next.selection.layerId).toBe("local-paint");
    const local = next.layers.find((layer) => layer.id === "local-paint")!;
    const mask = next.layers.find((layer) => layer.id === local.rasterMaskId)!;
    expect(mask).toMatchObject({ type: "mask", selectionRuns: [1, 2, 2, 1] });
    const restored = parseDocument(serializeDocument(next));
    expect(restored.layers.find((layer) => layer.id === mask.id)).toMatchObject({ selectionRuns: [1, 2, 2, 1] });
    const duplicate = duplicateLayer(restored, local.id);
    expect(duplicate.layers.filter((layer) => layer.type === "mask")).toHaveLength(2);
  });

  it("undoes and redoes a local layer and its mask as one document edit", async () => {
    const initial = { ...createEmptyDocument(), canvas: { width: 2, height: 1 } };
    const source = { ...createDrawingLayer(initial, "paint", "Original"), width: 2, height: 1 };
    const document = addLayer(initial, source);
    const history = new DocumentHistory();
    const next = history.execute(document, addSelectionMaskedLocalLayer(document, source.id,
      { width: 2, height: 1, pixels: new Uint8Array([1, 0]) },
      { type: "annotation", name: "Local shape", element: {
        id: "shape", kind: "rect", x: 0, y: 0, width: 2, height: 1, rotation: 0,
        fill: "#ff0000", stroke: "#ff0000", strokeWidth: 1, cornerRadius: 0,
      } }), "Add selected annotation");
    expect(next.layers).toHaveLength(3);
    expect((await history.undo(next)).layers).toEqual(document.layers);
    expect((await history.redo(document)).layers).toEqual(next.layers);
  });

  it("fails closed for stale dimensions and selections too complex for the document budget", () => {
    const initial = createEmptyDocument();
    const source = createDrawingLayer(initial, "paint", "Original");
    const document = addLayer(initial, source);
    const stroke = { id: "stroke", points: [{ x: 0, y: 0 }], size: 1, mode: "paint" as const, value: 255 };
    expect(addSelectionMaskedLocalLayer(document, source.id, { width: 2, height: 1, pixels: new Uint8Array([1, 1]) },
      { type: "paint", name: "Local", stroke })).toBe(document);
    expect(() => encodeSelectionRuns({ width: 100_001, height: 1, pixels: Uint8Array.from({ length: 100_001 }, (_, index) => index % 2) })).toThrow("too complex");
  });
});
