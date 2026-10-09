import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { addLayer, createAnnotationLayer, createDrawingLayer, createGroupLayer, duplicateLayer } from "../domain/commands";
import { createEmptyDocument, layerTagColor, parseDocument, serializeDocument } from "../domain/document";
import { rasterLayerFromImage } from "../domain/importImage";
import { overlayScale } from "../studio/useLayerTagOverlay";

const HEX = /^#[0-9a-f]{6}$/;

describe("layer tag colours (image-studio#25)", () => {
  it("generates vivid hex colours across the hue circle", () => {
    expect(layerTagColor(() => 0)).toBe("#eb1f1f");
    const colors = [0, .25, .5, .75].map((value) => layerTagColor(() => value));
    colors.forEach((color) => expect(color).toMatch(HEX));
    expect(new Set(colors).size).toBe(4);
  });

  it("gives every newly created layer a colour, and a duplicate its own colour", () => {
    const empty = createEmptyDocument();
    const raster = rasterLayerFromImage({ dataUrl: "data:image/png;base64,AAAA", mimeType: "image/png", width: 4, height: 4, name: "a.png" });
    const created = [raster, createDrawingLayer(empty, "paint", "Paint"), createAnnotationLayer(empty, "Text"), createGroupLayer(empty, "Group")];
    created.forEach((layer) => expect(layer.tagColor).toMatch(HEX));
    const document = addLayer(empty, raster);
    const duplicated = duplicateLayer(document, raster.id);
    const copy = duplicated.layers.find((layer) => layer.id !== raster.id)!;
    expect(copy.tagColor).toMatch(HEX);
    expect(copy.tagColor).not.toBe(raster.tagColor);
  });

  it("persists colors, deterministically migrates untagged v14 layers and rejects invalid colors", () => {
    const raster = { ...rasterLayerFromImage({ dataUrl: "data:image/png;base64,AAAA", mimeType: "image/png", width: 4, height: 4, name: "a.png" }), tagColor: "#A1B2C3" };
    const document = addLayer(createEmptyDocument(), raster);
    expect(parseDocument(serializeDocument(document)).layers[0].tagColor).toBe("#a1b2c3");
    const { tagColor: _removed, ...untagged } = raster;
    const legacy = serializeDocument({ ...document, layers: [untagged as typeof raster] });
    const migrated = parseDocument(legacy);
    expect(migrated.layers[0].tagColor).toMatch(HEX);
    expect(parseDocument(legacy).layers[0].tagColor).toBe(migrated.layers[0].tagColor);
    expect(parseDocument(serializeDocument(migrated)).layers[0].tagColor).toBe(migrated.layers[0].tagColor);
    expect(() => parseDocument(serializeDocument({ ...document, layers: [{ ...raster, tagColor: "red" }] }))).toThrow("tag color");
  });

  it("shows the dot after the lock toggle and edits it as one undoable change per drag", () => {
    const panel = readFileSync(resolve(__dirname, "../studio/LayerPanel.tsx"), "utf8");
    expect(panel.indexOf("<LayerTagSwatch")).toBeGreaterThan(panel.indexOf('variant="row"'));
    expect(panel.indexOf("<LayerTagSwatch")).toBeLessThan(panel.indexOf("<LayerThumbnail"));
    expect(panel).toContain("`tag-color:${layer.id}`");
  });

  it("tints the selected layer's pixels at 30% only in the editor overlay", () => {
    const studio = readFileSync(resolve(__dirname, "../studio/Studio.tsx"), "utf8");
    expect(studio).toContain('useLayerTagOverlay(selected, tool === "select")');
    const overlayLayer = studio.slice(studio.indexOf("name={UI_OVERLAY_LAYER_NAME}"));
    expect(overlayLayer).toContain("image={layerTagOverlay}");
    expect(overlayScale(1000, 1000)).toBe(1);
    expect(overlayScale(4000, 4000)).toBeCloseTo(Math.sqrt(2_000_000 / 16_000_000));
  });
});
