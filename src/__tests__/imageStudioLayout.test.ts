import { recenterViewport } from "../studio/useCanvasViewport";
import { alignLayers, cropCanvas, layerBounds, snapLayer } from "../domain/layoutCommands";
import { createEmptyDocument, parseDocument, serializeDocument, type RasterLayer } from "../domain/document";
import { createDrawingLayer, createAttachedRasterMask, addLayer, patchLayer } from "../domain/commands";
import { DocumentHistory } from "../domain/history";
const fixture = () => {
    const empty = createEmptyDocument();
    const paint = { ...createDrawingLayer(empty, "paint", "Paint"), width: 40, height: 20, transform: { x: 10, y: 20, scaleX: 1, scaleY: 1, rotation: 90 } };
    return { paint, document: addLayer(empty, paint) };
};
describe("layout commands", () => {
    it("aligns rotated and flipped layers by their visible bounds and moves the owned mask", () => {
        const { paint, document } = fixture();
        const mask = createAttachedRasterMask(document, paint, "Mask");
        const linked = patchLayer(addLayer(document, mask), paint.id, { rasterMaskId: mask.id });
        const next = alignLayers(linked, [paint.id], "left");
        expect(layerBounds(next.layers[0]).left).toBeCloseTo(0);
        expect(next.layers.find(l => l.id === mask.id)?.transform).toEqual(next.layers[0].transform);
        const flipped = { ...paint, transform: { ...paint.transform, scaleX: -2 } };
        const centered = alignLayers({ ...document, layers: [flipped] }, [paint.id], "center");
        const bounds = layerBounds(centered.layers[0]);
        expect((bounds.left + bounds.right) / 2).toBeCloseTo(document.canvas.width / 2);
    });
    it("distributes unequal widths with equal gaps while preserving outer edges", () => {
        const { paint, document } = fixture();
        const layers = [0, 1, 2].map((n) => ({ ...paint, id: `p${n}`, width: 10 + n * 10, transform: { ...paint.transform, x: n * 55, y: 0, rotation: 0 } }));
        const next = alignLayers({ ...document, layers }, layers.map(l => l.id), "horizontal");
        const boxes = next.layers.map(l => layerBounds(l));
        expect(boxes[1].left - boxes[0].right).toBeCloseTo(boxes[2].left - boxes[1].right);
        expect(boxes[0].left).toBe(0);
        expect(boxes[2].right).toBe(140);
    });
    it("does not partially align locked or unrelated parent selections", () => {
        const { paint, document } = fixture();
        const locked = { ...document, layers: [{ ...paint, locked: true }] };
        expect(alignLayers(locked, [paint.id], "center")).toBe(locked);
        const mixed = { ...document, layers: [paint, { ...paint, id: "other", parentId: "group" }] };
        expect(alignLayers(mixed, [paint.id, "other"], "left")).toBe(mixed);
    });
    it("snaps within tolerance and leaves nested layers alone", () => {
        const { paint, document } = fixture();
        const near = { ...paint.transform, x: 22 };
        expect(snapLayer(document, paint.id, near, 3).x).toBeCloseTo(20);
        expect(snapLayer(document, paint.id, near, 1)).toEqual(near);
        expect(snapLayer({ ...document, layers: [{ ...paint, parentId: "g" }] }, paint.id, near, 3)).toEqual(near);
    });
    it("crops without destroying layer content, keeps masks aligned and can undo", () => {
        const { paint, document } = fixture();
        const mask = createAttachedRasterMask(document, paint, "Mask");
        const linked = patchLayer(addLayer(document, mask), paint.id, { rasterMaskId: mask.id });
        const history = new DocumentHistory();
        const cropped = cropCanvas(linked, { x: 5, y: 6, width: 80, height: 70 });
        history.execute(linked, cropped, "Crop");
        expect(cropped.canvas).toEqual({ width: 80, height: 70 });
        expect(cropped.layers[0].strokes).toBe(paint.strokes);
        expect(cropped.layers[0].transform.x).toBe(5);
        expect(cropped.layers[1].transform).toEqual(cropped.layers[0].transform);
        expect(parseDocument(serializeDocument(cropped)).canvas).toEqual(cropped.canvas);
        expect(history.undo(cropped)).toBe(linked);
        expect(cropCanvas(linked, { x: -1, y: 0, width: 10, height: 10 })).toBe(linked);
    });
});
describe("history jumps and effects persistence", () => {
    it("crosses asynchronous pixel and document entries in either direction", async () => {
        const { document } = fixture();
        const raster: RasterLayer = { ...document.layers[0], type: "raster", source: { kind: "data-url", value: "before", mimeType: "image/png" } };
        const start = { ...document, layers: [raster] }, painted = { ...start, layers: [{ ...raster, source: { ...raster.source, value: "after" } as RasterLayer["source"] }] };
        const h = new DocumentHistory();
        const diff = { x: 0, y: 0, width: 1, height: 1, before: new Uint8ClampedArray(4), after: new Uint8ClampedArray(4) };
        h.executePixel(start, painted, "Brush", raster.id, [diff]);
        const named = { ...painted, title: "Named" };
        h.execute(painted, named, "Rename");
        const resolver = jest.fn(async (current, _id, _diff, direction) => ({ ...current, layers: direction === "before" ? start.layers : painted.layers }));
        const restored = await h.seek(named, 0, resolver);
        expect(restored.layers).toEqual(start.layers);
        expect(h.timeline.undo).toEqual([]);
        const redone = await h.seek(restored, 2, resolver);
        expect(redone).toEqual(named);
        expect(resolver).toHaveBeenCalledTimes(2);
    });
    it("restores history stacks after a resolver fails midway", async () => {
        const { document } = fixture();
        const h = new DocumentHistory(), a = { ...document, title: "A" }, b = { ...a, title: "B" };
        const diff = { x: 0, y: 0, width: 1, height: 1, before: new Uint8ClampedArray(4), after: new Uint8ClampedArray(4) };
        h.executePixel(document, a, "Brush", "pixel", [diff]);
        h.execute(a, b, "Rename");
        const timeline = h.timeline;
        await expect(h.seek(b, 0, async () => { throw new Error("Unavailable archive"); })).rejects.toThrow("Unavailable");
        expect(h.timeline).toEqual(timeline);
        expect(h.undo(b)).toBe(a);
    });
    it("preserves validated live effects in v13 and rejects unsafe parameters", () => {
        const { paint, document } = fixture();
        const effects = { shadow: { color: "#000000", opacity: .35, blur: 8, offsetX: 6, offsetY: 6 }, stroke: { color: "#ffffff", opacity: 1, width: 2 } };
        const styled = { ...document, layers: [{ ...paint, effects }] };
        expect(parseDocument(serializeDocument(styled)).layers[0].effects).toEqual(effects);
        expect(parseDocument(JSON.stringify({ ...document, version: 12 })).version).toBe(13);
        expect(() => parseDocument(JSON.stringify({ ...styled, layers: [{ ...paint, effects: { stroke: { color: "red", opacity: 1, width: 2 } } }] }))).toThrow("effect");
        expect(() => parseDocument(JSON.stringify({ ...styled, layers: [{ ...paint, effects: { ...effects, stroke: { ...effects.stroke, width: 17 } } }] }))).toThrow("stroke");
    });
});

it("preserves the viewed world center when the workbench resizes", () => {
 const original = {offsetX:300,offsetY:200,scale:2,devicePixelRatio:1};
 const resized = recenterViewport(original,{width:1000,height:800},{width:300,height:400});
 expect((500-original.offsetX)/original.scale).toBe((150-resized.offsetX)/resized.scale);
 expect((400-original.offsetY)/original.scale).toBe((200-resized.offsetY)/resized.scale);
 expect(resized.scale).toBe(2);
});
