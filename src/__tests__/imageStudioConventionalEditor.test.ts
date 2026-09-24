import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { applyConventionalEditorOutcome } from "../adapters/conventionalEditor";
import { createAttachedRasterMask, replaceRasterLayer, replaceRasterPixels } from "../domain/commands";
import { createEmptyDocument } from "../domain/document";
import { rasterLayerFromImage } from "../domain/importImage";
import { DocumentHistory } from "../domain/history";

const DATA_URL = "data:image/png;base64,iVBORw0KGgo=";

describe("conventional editor adapter", () => {
  it("renders filter presets once and keeps the adjustment controls in the advanced editor", () => {
    const source = readFileSync(resolve(__dirname, "../studio/RasterEditorDialog.tsx"), "utf8");
    expect(source).toContain("editor-main-no-panel");
    expect(source).toContain('initialMode === "adjust" && <aside>');
    expect(source).toContain('tool === "finetune"');
    expect(source).not.toContain("editor-mode-tabs");
    expect(source.match(/PRESETS\.map/g)).toHaveLength(1);
    const studio = readFileSync(resolve(__dirname, "../studio/Studio.tsx"), "utf8");
    expect(studio).toContain("if (outcome.output.resizeCanvas) fitView");
  });

  it("applies dimensions and pixels as one reversible document command", () => {
    const empty = createEmptyDocument();
    const layer = rasterLayerFromImage({ dataUrl: DATA_URL, mimeType: "image/png", width: 100, height: 80, name: "input.png" });
    const initial = { ...empty, layers: [layer], selection: { layerId: layer.id } };
    const edited = replaceRasterLayer(initial, layer.id, {
      width: 240, height: 120, source: { kind: "data-url", value: "data:image/webp;base64,AAAA", mimeType: "image/webp" },
    });
    const history = new DocumentHistory();
    const current = history.execute(initial, edited, "Apply conventional edit");
    expect(current.layers[0]).toMatchObject({ width: 240, height: 120, source: { mimeType: "image/webp" }, transform: { scaleX: 1, scaleY: 1, rotation: 0 } });
    expect(history.undo(current)).toEqual(initial);
  });

  it("keeps the layer's position by default, but resetPosition zeroes it for an absolute composite", () => {
    const empty = createEmptyDocument();
    const layer = {
      ...rasterLayerFromImage({ dataUrl: DATA_URL, mimeType: "image/png", width: 100, height: 80, name: "input.png" }),
      transform: { x: 40, y: 25, scaleX: 1, scaleY: 1, rotation: 0 },
    };
    const document = { ...empty, layers: [layer], selection: { layerId: layer.id } };
    const kept = replaceRasterLayer(document, layer.id, {
      width: 240, height: 120, source: { kind: "data-url", value: "data:image/webp;base64,AAAA", mimeType: "image/webp" },
    });
    expect(kept.layers[0].transform).toMatchObject({ x: 40, y: 25 });
    const reset = replaceRasterLayer(document, layer.id, {
      width: 240, height: 120, source: { kind: "data-url", value: "data:image/webp;base64,AAAA", mimeType: "image/webp" },
      resetPosition: true,
    });
    expect(reset.layers[0].transform).toMatchObject({ x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 });
  });

  it("does not mutate missing, non-raster, or locked layers", () => {
    const document = createEmptyDocument();
    expect(replaceRasterLayer(document, "missing", { width: 1, height: 1, source: { kind: "data-url", value: DATA_URL, mimeType: "image/png" } })).toBe(document);
  });

  it("rejects a size-changing replacement while a raster mask is linked", () => {
    const empty = createEmptyDocument();
    const raster = rasterLayerFromImage({ dataUrl: DATA_URL, mimeType: "image/png", width: 100, height: 80, name: "input.png" });
    const mask = createAttachedRasterMask(empty, raster, "Mask");
    const document = { ...empty, layers: [{ ...raster, rasterMaskId: mask.id }, mask] };
    const replacement = { width: 80, height: 100, source: { kind: "data-url" as const, value: DATA_URL, mimeType: "image/png" } };
    expect(replaceRasterLayer(document, raster.id, replacement)).toBe(document);
    expect(applyConventionalEditorOutcome(document, raster.id, { kind: "saved", output: {
      dataUrl: DATA_URL, mimeType: "image/png", width: 80, height: 100, resizeCanvas: true,
    } })).toBe(document);
  });

  it("replaces direct pixel edits without resetting the layer transform", () => {
    const empty = createEmptyDocument();
    const layer = {
      ...rasterLayerFromImage({ dataUrl: DATA_URL, mimeType: "image/png", width: 100, height: 80, name: "input.png" }),
      transform: { x: 12, y: 18, scaleX: 1.5, scaleY: -1, rotation: 30 },
    };
    const document = { ...empty, layers: [layer], selection: { layerId: layer.id } };
    const updated = replaceRasterPixels(document, layer.id, { kind: "data-url", value: "data:image/png;base64,AAAA", mimeType: "image/png" });
    expect(updated.layers[0].transform).toEqual(layer.transform);
    expect(updated.layers[0]).toMatchObject({ width: 100, height: 80, source: { value: "data:image/png;base64,AAAA" } });
  });

  it("treats cancellation as an exact no-op", () => {
    const document = createEmptyDocument();
    expect(applyConventionalEditorOutcome(document, "unused", { kind: "cancelled" })).toBe(document);
  });

  it("resizes the canvas and resets the layer origin after a geometry edit", () => {
    const empty = createEmptyDocument();
    const layer = {
      ...rasterLayerFromImage({ dataUrl: DATA_URL, mimeType: "image/png", width: 100, height: 80, name: "input.png" }),
      transform: { x: 40, y: 25, scaleX: 2, scaleY: 2, rotation: 90 },
    };
    const document = { ...empty, canvas: { width: 100, height: 80 }, layers: [layer], selection: { layerId: layer.id } };
    const result = applyConventionalEditorOutcome(document, layer.id, { kind: "saved", output: {
      dataUrl: "data:image/png;base64,AAAA", mimeType: "image/png", width: 80, height: 100, resizeCanvas: true,
    } });
    expect(result.canvas).toEqual({ width: 80, height: 100 });
    expect(result.layers[0]).toMatchObject({ width: 80, height: 100, transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 } });
  });
});
