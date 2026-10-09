import { webcrypto } from "node:crypto";
import { addLayer } from "../domain/commands";
import { createEmptyDocument, defaultTransform, type RasterLayer } from "../domain/document";
import { parseProjectPackage, serializeProjectPackage } from "../projects/projectPackage";

describe("Image Studio project packages", () => {
  beforeAll(() => { Object.defineProperty(globalThis, "crypto", { configurable: true, value: webcrypto }); });

  it("round-trips document layers and embedded asset relationships", async () => {
    const initial = createEmptyDocument();
    const layer: RasterLayer = { id: "raster-1", type: "raster", name: "Photo", tagColor: "#3b82f6", visible: true, locked: false, opacity: 1, blendMode: "normal",
      transform: defaultTransform(), width: 1, height: 1, source: { kind: "data-url", mimeType: "image/png", value: "data:image/png;base64,iVBORw0KGgo=" } };
    const restored = await parseProjectPackage(await serializeProjectPackage(addLayer(initial, layer)));
    expect(restored.id).not.toBe(initial.id);
    expect(restored.layers[0]).toMatchObject({ id: "raster-1", source: { kind: "data-url", mimeType: "image/png", value: "data:image/png;base64,iVBORw0KGgo=" } });
  });

  it("rejects unknown versions, unsupported payloads and tampered assets", async () => {
    await expect(parseProjectPackage('{"kind":"skillsmaster-image-studio-project","packageVersion":99}')).rejects.toThrow("Unknown");
    const document = createEmptyDocument();
    await expect(parseProjectPackage(JSON.stringify({ kind: "skillsmaster-image-studio-project", packageVersion: 1, document, assets: [{ id: "x", mimeType: "text/html", dataUrl: "data:text/html;base64,AA==", sha256: "0".repeat(64) }] })))
      .rejects.toThrow("supported image");
    const raster: RasterLayer = { id: "raster-1", type: "raster", name: "Photo", tagColor: "#3b82f6", visible: true, locked: false, opacity: 1, blendMode: "normal",
      transform: defaultTransform(), width: 1, height: 1, source: { kind: "data-url", mimeType: "image/png", value: "data:image/png;base64,iVBORw0KGgo=" } };
    const uncheckedDocument = addLayer(createEmptyDocument(), raster);
    await expect(parseProjectPackage(JSON.stringify({ kind: "skillsmaster-image-studio-project", packageVersion: 1, document: uncheckedDocument, assets: [] })))
      .rejects.toThrow("checksummed assets");
  });
});
