import { createEmptyDocument, type AnnotationElement } from "../domain/document";
import { addLayer, createAnnotationLayer, patchLayer, setAnnotationElements } from "../domain/commands";
import { rasterLayerFromImage } from "../domain/importImage";
import { exportFilename, exportImage, planExport, renderImageStudioDocument } from "../domain/exportImage";

describe("Image Studio export", () => {
  it("plans exact output dimensions and rejects unsafe memory use", () => {
    expect(planExport({ format: "png", width: 2000, height: 1000, quality: 1, jpegBackground: "#ffffff" }))
      .toMatchObject({ mimeType: "image/png", estimatedBytes: 16_000_000, memoryRisk: false });
    expect(() => planExport({ format: "webp", width: 10_000, height: 10_000, quality: .9, jpegBackground: "#ffffff" }))
      .toThrow("memory budget");
  });

  it("allows unchanged-size 4K PNG from a simple raster stack without allocating an output canvas", () => {
    const raster = rasterLayerFromImage({ dataUrl: "data:image/png;base64,AA==", mimeType: "image/png",
      width: 4096, height: 4096, name: "4K" });
    const document = { ...createEmptyDocument(), canvas: { width: 4096, height: 4096 }, layers: [raster] };
    const options = { format: "png" as const, width: 4096, height: 4096, quality: 1, jpegBackground: "#ffffff" };
    expect(planExport(options, document).estimatedBytes).toBe(4096 * 4096 * 12);
    expect(() => planExport({ ...options, format: "jpeg" }, document)).toThrow("memory budget");
  });

  it("keeps alpha for PNG and fills the selected background for JPEG", async () => {
    const fills: string[] = [];
    const encodings: Array<[string, number | undefined]> = [];
    const createCanvas = (width: number, height: number) => ({
      width, height,
      getContext: () => ({
        fillStyle: "", fillRect() { fills.push(this.fillStyle); }, save() {}, restore() {}, scale() {}, drawImage() {},
      }),
      toBlob(callback: (blob: Blob) => void, type: string, quality?: number) { encodings.push([type, quality]); callback(new Blob([`${width}x${height}`], { type })); },
    }) as unknown as HTMLCanvasElement;
    const document = createEmptyDocument();
    await exportImage(document, { format: "png", width: 640, height: 360, quality: 1, jpegBackground: "#123456" }, { createCanvas });
    await exportImage(document, { format: "jpeg", width: 320, height: 180, quality: .8, jpegBackground: "#123456" }, { createCanvas });
    expect(fills).toEqual(["#123456"]);
    expect(encodings).toEqual([["image/png", undefined], ["image/jpeg", .8]]);
  });

  it("creates filesystem-safe filenames", () => {
    expect(exportFilename(" bad/name:* ", "jpeg")).toBe("bad-name-.jpg");
  });

  it("rejects a broken linked mask instead of exporting its owner unmasked", async () => {
    const raster = rasterLayerFromImage({ dataUrl: "data:image/png;base64,AA==", mimeType: "image/png", width: 10, height: 10, name: "Layer" });
    const document = { ...createEmptyDocument(), layers: [{ ...raster, rasterMaskId: "missing" }] };
    const createCanvas = (width: number, height: number) => ({
      width, height, getContext: () => ({ scale() {}, save() {}, restore() {}, drawImage() {} }),
    }) as unknown as HTMLCanvasElement;
    await expect(renderImageStudioDocument(document, {
      createCanvas, loadImage: async () => ({}) as CanvasImageSource,
    })).rejects.toThrow("Raster mask binding is invalid");
  });

  it("applies the persisted layer blend mode during export", async () => {
    const modes: string[] = [];
    const context = {
      fillStyle: "", globalAlpha: 1,
      set globalCompositeOperation(value: string) { modes.push(value); },
      save() {}, restore() {}, scale() {}, translate() {}, rotate() {}, drawImage() {},
    };
    const createCanvas = (width: number, height: number) => ({
      width, height, getContext: () => context,
      toBlob(callback: (blob: Blob) => void, type: string) { callback(new Blob([], { type })); },
    }) as unknown as HTMLCanvasElement;
    const raster = rasterLayerFromImage({ dataUrl: "data:image/png;base64,AA==", mimeType: "image/png", width: 10, height: 10, name: "Layer" });
    const document = patchLayer(addLayer(createEmptyDocument(), raster), raster.id, { blendMode: "multiply" });
    await exportImage(document, { format: "png", width: 10, height: 10, quality: 1, jpegBackground: "#ffffff" }, {
      createCanvas, loadImage: async () => ({}) as CanvasImageSource,
    });
    expect(modes).toContain("multiply");
  });

  it("rasterizes annotation elements onto the exported canvas", async () => {
    const calls: string[] = [];
    const context = {
      fillStyle: "", strokeStyle: "", lineWidth: 0, lineCap: "", lineJoin: "", globalAlpha: 1, globalCompositeOperation: "source-over",
      textBaseline: "", textAlign: "", font: "",
      save() {}, restore() {}, scale() {}, translate() {}, rotate() {}, drawImage() {},
      beginPath() { calls.push("beginPath"); }, closePath() {}, moveTo() {}, lineTo() {},
      rect() {}, ellipse() { calls.push("ellipse"); }, stroke() { calls.push("stroke"); }, fill() { calls.push("fill"); },
      fillText(text: string) { calls.push(`fillText:${text}`); }, roundRect: undefined,
    };
    const createCanvas = (width: number, height: number) => ({
      width, height, getContext: () => context,
      toBlob(callback: (blob: Blob) => void, type: string) { callback(new Blob([], { type })); },
    }) as unknown as HTMLCanvasElement;
    const initial = createEmptyDocument();
    const layer = createAnnotationLayer(initial, "Text & shapes");
    const elements: AnnotationElement[] = [
      { id: "t", kind: "text", x: 5, y: 5, width: 100, rotation: 0, text: "Hi", fontFamily: "Arial", fontSize: 20, fill: "#172033", align: "left" },
      { id: "e", kind: "ellipse", x: 20, y: 20, radiusX: 10, radiusY: 8, rotation: 0, fill: "#5f6fed", stroke: "#5f6fed", strokeWidth: 2 },
      { id: "a", kind: "arrow", points: [{ x: 0, y: 0 }, { x: 10, y: 10 }], stroke: "#5f6fed", strokeWidth: 2 },
    ];
    const document = setAnnotationElements(addLayer(initial, layer), layer.id, elements);
    await exportImage(document, { format: "png", width: 10, height: 10, quality: 1, jpegBackground: "#ffffff" }, { createCanvas });
    expect(calls).toEqual(expect.arrayContaining(["fillText:Hi", "ellipse", "stroke", "fill"]));
  });
});
