import { createDrawingLayer } from "../domain/commands";
import { createEmptyDocument } from "../domain/document";
import { copySelectedRasterTiles, bakeSelectedAdjustmentTiles, constrainRgbaToCoverage, editedRasterMimeType, eraseSelectedRasterTiles, liftSelectedRasterTiles, resolveRasterEditCoverage } from "../domain/editCoverage";
import { rasterLayerFromImage } from "../domain/importImage";

describe("Image Studio effective edit coverage", () => {
  class TestImageData {
    constructor(public readonly data: Uint8ClampedArray, public readonly width: number, public readonly height: number) {}
  }

  function pixelCanvas(width: number, height: number) {
    const pixels = new Uint8ClampedArray(width * height * 4);
    const context = {
      getImageData: (x: number, y: number, tileWidth: number, tileHeight: number) => {
        const data = new Uint8ClampedArray(tileWidth * tileHeight * 4);
        for (let row = 0; row < tileHeight; row += 1) {
          data.set(pixels.subarray(((y + row) * width + x) * 4, ((y + row) * width + x + tileWidth) * 4), row * tileWidth * 4);
        }
        return new TestImageData(data, tileWidth, tileHeight);
      },
      putImageData: (image: TestImageData, x: number, y: number) => {
        for (let row = 0; row < image.height; row += 1) {
          pixels.set(image.data.subarray(row * image.width * 4, (row + 1) * image.width * 4), ((y + row) * width + x) * 4);
        }
      },
    };
    return { canvas: { width, height, getContext: () => context } as unknown as HTMLCanvasElement, pixels };
  }

  beforeEach(() => { Object.assign(globalThis, { ImageData: TestImageData }); });

  it("intersects a temporary selection with a linked soft mask", () => {
    const empty = { ...createEmptyDocument(), canvas: { width: 3, height: 1 } };
    const raster = rasterLayerFromImage({ dataUrl: "data:image/png;base64,AAAA", mimeType: "image/png", width: 3, height: 1, name: "test" });
    const mask = createDrawingLayer(empty, "mask", "linked mask");
    const layer = { ...raster, rasterMaskId: mask.id };
    const document = { ...empty, layers: [layer, mask] };
    const pixels = new Uint8ClampedArray([255, 255, 255, 255, 128, 128, 128, 255, 64, 64, 64, 255]);
    const canvas = { width: 3, height: 1, getContext: () => ({ scale: () => undefined, getImageData: () => ({ data: pixels }) }) } as unknown as HTMLCanvasElement;
    const coverage = resolveRasterEditCoverage(document, layer, { width: 3, height: 1, pixels: new Uint8Array([1, 1, 0]) }, () => canvas);
    expect([...coverage!]).toEqual([255, 128, 0]);
  });

  it("blends soft coverage only in the changed tile", () => {
    const before = new Uint8ClampedArray([10, 20, 30, 255, 40, 50, 60, 255]);
    const after = new Uint8ClampedArray([110, 120, 130, 0, 140, 150, 160, 0]);
    const result = constrainRgbaToCoverage(before, after, new Uint8Array([0, 128, 255]), 3, 1, 1, 0, 2, 1);
    expect([...result]).toEqual([10, 20, 30, 127, 140, 150, 160, 0]);
    expect([...before]).toEqual([10, 20, 30, 255, 40, 50, 60, 255]);
  });

  it("preserves color when a soft mask partially erases or paints transparency", () => {
    const opaqueRed = new Uint8ClampedArray([255, 0, 0, 255]);
    const clear = new Uint8ClampedArray([0, 0, 0, 0]);
    const half = new Uint8Array([128]);
    expect([...constrainRgbaToCoverage(opaqueRed, clear, half, 1, 1, 0, 0, 1, 1)]).toEqual([255, 0, 0, 127]);
    expect([...constrainRgbaToCoverage(clear, opaqueRed, half, 1, 1, 0, 0, 1, 1)]).toEqual([255, 0, 0, 128]);
  });

  it("bakes a color adjustment only inside the selected soft-mask coverage", () => {
    const source = pixelCanvas(3, 1);
    source.pixels.set([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255]);
    const selection = { width: 3, height: 1, pixels: new Uint8Array([0, 1, 0]) };
    const diffs = bakeSelectedAdjustmentTiles(source.canvas, selection, new Uint8Array([0, 128, 0]),
      { kind: "invert", parameters: {} }, 1, "normal", () => true, () => true);
    expect([...source.pixels]).toEqual([255, 0, 0, 255, 128, 127, 128, 255, 0, 0, 255, 255]);
    expect(diffs).toHaveLength(1);
    source.canvas.getContext("2d")!.putImageData(new TestImageData(diffs[0].before, 3, 1) as ImageData, 0, 0);
    expect([...source.pixels]).toEqual([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255]);
  });

  it("copies a cropped non-rectangular selection without changing source pixels", () => {
    const source = pixelCanvas(4, 3);
    for (let index = 0; index < 12; index += 1) source.pixels.set([index, 20, 30, 255], index * 4);
    const before = new Uint8ClampedArray(source.pixels);
    const selection = { width: 4, height: 3, pixels: new Uint8Array([0,0,0,0, 0,1,1,0, 0,1,0,0]) };
    const coverage = new Uint8Array(12).fill(255); coverage[5] = 128;
    const copied = copySelectedRasterTiles(source.canvas, selection, coverage, () => true,
      (width, height) => pixelCanvas(width, height).canvas);
    expect([copied.x, copied.y, copied.image.width, copied.image.height]).toEqual([1,1,2,2]);
    const pixels = copied.image.getContext("2d")!.getImageData(0,0,2,2).data;
    expect([...pixels]).toEqual([5,20,30,128, 6,20,30,255, 9,20,30,255, 0,0,0,0]);
    expect(source.pixels).toEqual(before);
  });

  it("lifts only selected visible pixels and erases the source with tile undo", () => {
    const source = pixelCanvas(3, 1);
    source.pixels.set([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255]);
    const selection = { width: 3, height: 1, pixels: new Uint8Array([0, 1, 0]) };
    const lifted = liftSelectedRasterTiles(source.canvas, selection, new Uint8Array([0, 128, 0]),
      () => true, () => true, (width, height) => pixelCanvas(width, height).canvas);
    expect([lifted.x, lifted.y, lifted.image.width, lifted.image.height]).toEqual([1, 0, 1, 1]);
    expect([...(lifted.image.getContext("2d")!.getImageData(0, 0, 1, 1).data)]).toEqual([0, 255, 0, 128]);
    expect([...source.pixels]).toEqual([255, 0, 0, 255, 0, 0, 0, 0, 0, 0, 255, 255]);
    expect(lifted.diffs).toHaveLength(1);
    const restored = source.canvas.getContext("2d")!;
    restored.putImageData(new TestImageData(lifted.diffs[0].before, 3, 1) as ImageData, 0, 0);
    expect([...source.pixels]).toEqual([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255]);
  });

  it("rejects an unaffordable lift before changing source pixels", () => {
    const source = pixelCanvas(2, 1);
    source.pixels.set([255, 0, 0, 255, 0, 255, 0, 255]);
    expect(() => liftSelectedRasterTiles(source.canvas,
      { width: 2, height: 1, pixels: new Uint8Array([1, 0]) }, null,
      () => false, () => true, () => { throw new Error("should not allocate"); })).toThrow("history budget");
    expect([...source.pixels]).toEqual([255, 0, 0, 255, 0, 255, 0, 255]);
  });

  it("reads large masks in bounded rows without changing their coverage", () => {
    const empty = { ...createEmptyDocument(), canvas: { width: 1024, height: 1025 } };
    const raster = rasterLayerFromImage({ dataUrl: "data:image/png;base64,AAAA", mimeType: "image/png", width: 1024, height: 1025, name: "test" });
    const mask = createDrawingLayer(empty, "mask", "large mask");
    const layer = { ...raster, rasterMaskId: mask.id };
    const reads: number[] = [];
    const canvas = { width: 1024, height: 1025, getContext: () => ({
      scale: () => undefined,
      getImageData: (_x: number, y: number, width: number, height: number) => {
        reads.push(height);
        const data = new Uint8ClampedArray(width * height * 4);
        if (y + height === 1025) data.fill(255, data.length - 4);
        return { data };
      },
    }) } as unknown as HTMLCanvasElement;
    const coverage = resolveRasterEditCoverage({ ...empty, layers: [layer, mask] }, layer, null, () => canvas);
    expect(reads).toEqual([1024, 1]);
    expect(coverage?.[0]).toBe(0);
    expect(coverage?.[1024 * 1025 - 1]).toBe(255);
  });

  it("rejects missing mask bindings and stale selection sizes", () => {
    const document = createEmptyDocument();
    const raster = rasterLayerFromImage({ dataUrl: "data:image/png;base64,AAAA", mimeType: "image/png", width: 2, height: 1, name: "test" });
    expect(() => resolveRasterEditCoverage(document, { ...raster, rasterMaskId: "missing" }, null)).toThrow("Raster mask binding is invalid");
    expect(() => resolveRasterEditCoverage(document, raster, { width: 1, height: 1, pixels: new Uint8Array([1]) })).toThrow("Selection dimensions do not match raster layer");
  });

  it("applies owned binary clips after grayscale inversion for local editing", () => {
    const empty = { ...createEmptyDocument(), canvas: { width: 3, height: 1 } };
    const raster = rasterLayerFromImage({ dataUrl: "data:image/png;base64,AAAA", mimeType: "image/png", width: 3, height: 1, name: "Source" });
    const mask = { ...createDrawingLayer(empty, "mask", "Mask"), clipRuns: [1, 1, 1] };
    const target = { ...raster, rasterMaskId: mask.id, rasterMaskInverted: true };
    const canvas = { width: 3, height: 1, getContext: () => ({ scale: () => {},
      getImageData: () => ({ data: new Uint8ClampedArray([128, 128, 128, 255, 128, 128, 128, 255, 128, 128, 128, 255]) }),
    }) } as unknown as HTMLCanvasElement;
    const coverage = (clipInverted: boolean) => resolveRasterEditCoverage({ ...empty,
      layers: [target, { ...mask, clipInverted }] }, target, null, () => canvas);
    expect([...coverage(false)!]).toEqual([0, 127, 0]);
    expect([...coverage(true)!]).toEqual([127, 0, 127]);
  });

  it("uses lossless encoding for scoped edits and erasure", () => {
    expect(editedRasterMimeType("image/jpeg", true)).toBe("image/png");
    expect(editedRasterMimeType("image/webp", true)).toBe("image/png");
    expect(editedRasterMimeType("image/jpeg", false, true)).toBe("image/png");
    expect(editedRasterMimeType("image/jpeg", false)).toBe("image/jpeg");
  });

  it("preflights selection history bytes before touching the canvas", () => {
    const { canvas, pixels } = pixelCanvas(512, 1);
    pixels.fill(255);
    const selection = { width: 512, height: 1, pixels: new Uint8Array(512).fill(1) };
    const before = new Uint8ClampedArray(pixels);
    expect(() => eraseSelectedRasterTiles(canvas, selection, null, (bytes) => bytes < 4096, () => true)).toThrow("history budget");
    expect(pixels).toEqual(before);
  });

  it("rolls back selected tiles when the final history check rejects an edit", () => {
    const { canvas, pixels } = pixelCanvas(2, 1);
    pixels.set([255, 0, 0, 255, 0, 0, 255, 255]);
    const before = new Uint8ClampedArray(pixels);
    const selection = { width: 2, height: 1, pixels: new Uint8Array([1, 0]) };
    expect(() => eraseSelectedRasterTiles(canvas, selection, null, () => true, () => false)).toThrow("history budget");
    expect(pixels).toEqual(before);
  });

  it("erases only selected pixels inside the effective soft coverage", () => {
    const { canvas, pixels } = pixelCanvas(3, 1);
    pixels.set([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255]);
    const selection = { width: 3, height: 1, pixels: new Uint8Array([1, 1, 0]) };
    const diffs = eraseSelectedRasterTiles(canvas, selection, new Uint8Array([128, 0, 255]), () => true, () => true);
    expect(diffs).toHaveLength(1);
    expect([...pixels]).toEqual([255, 0, 0, 127, 0, 255, 0, 255, 0, 0, 255, 255]);
  });
});
