import { createEmptyDocument, type ImageStudioDocument } from "../domain/document";
import { createDrawingLayer, createGroupLayer } from "../domain/commands";
import { createAdjustmentLayer } from "../domain/adjustmentEngine";
import { EXPORT_MEMORY_LIMIT_BYTES, exportImage, planExport } from "../domain/exportImage";
import { RenderMemoryBudget, releaseRenderCanvas, type RenderMemoryUsage } from "../domain/renderMemory";
import { exportOpenRaster } from "../projects/openRaster";
import { applyRasterMask } from "../domain/rasterMaskRenderer";

const options = { format: "png" as const, width: 8, height: 8, quality: 1, jpegBackground: "#ffffff" };
const mockCanvas = (width: number, height: number) => ({ width, height,
  getContext: () => ({ scale() {}, save() {}, restore() {}, drawImage() {} }),
  toBlob(callback: BlobCallback, type: string) { callback(new Blob([], { type })); },
}) as unknown as HTMLCanvasElement;

describe("Image Studio export resource lifecycle", () => {
  it("rejects an allocation before invoking the factory and releases leases only once", () => {
    const usage: RenderMemoryUsage[] = [];
    const budget = new RenderMemoryBudget(256, (value) => usage.push(value));
    const original = jest.fn(mockCanvas);
    const factory = budget.canvasFactory(original);
    const canvas = factory(8, 8);
    expect(() => factory(1, 1)).toThrow("memory budget");
    expect(original).toHaveBeenCalledTimes(1);
    releaseRenderCanvas(canvas); releaseRenderCanvas(canvas); budget.dispose();
    expect(usage.at(-1)).toEqual({ currentBytes: 0, peakBytes: 256 });
  });

  it("budgets complex UHD stacks while rejecting over-budget square 4K recursion", () => {
    const document = { ...createEmptyDocument(), canvas: { width: 3840, height: 2160 } };
    const group = createGroupLayer(document, "Outer");
    const inner = { ...createGroupLayer(document, "Inner"), parentId: group.id };
    const paint = { ...createDrawingLayer(document, "paint", "Content"), parentId: inner.id };
    const adjustment = { ...createAdjustmentLayer(document, "invert", "Adjustment"), parentId: inner.id };
    const masks = [0, 1, 2].map(() => ({ ...createDrawingLayer(document, "mask", "Mask"), parentId: inner.id }));
    const complex: ImageStudioDocument = { ...document, layers: [group, inner, paint, adjustment, ...masks] };
    const plan = planExport({ ...options, width: 3840, height: 2160 }, complex);
    expect(plan.estimatedBytes).toBeLessThan(EXPORT_MEMORY_LIMIT_BYTES);
    expect(plan.memoryRisk).toBe(true);
    const square = { ...complex, canvas: { width: 4096, height: 4096 },
      layers: complex.layers.map((layer) => ({ ...layer, width: 4096, height: 4096 })) };
    expect(() => planExport({ ...options, width: 4096, height: 4096 }, square)).toThrow("memory budget");
  });

  it("releases every canvas when root context acquisition fails", async () => {
    const canvases: HTMLCanvasElement[] = [];
    const usage: RenderMemoryUsage[] = [];
    await expect(exportImage(createEmptyDocument(), options, {
      createCanvas: (width, height) => {
        const canvas = { ...mockCanvas(width, height), getContext: () => null } as unknown as HTMLCanvasElement;
        canvases.push(canvas); return canvas;
      }, onMemoryUsage: (value) => usage.push(value),
    })).rejects.toThrow("unavailable");
    expect(canvases.every((canvas) => canvas.width === 1 && canvas.height === 1)).toBe(true);
    expect(usage.at(-1)?.currentBytes).toBe(0);
  });

  it("does not apply the relaxed flat-image planning bound to complex OpenRaster archives", async () => {
    const document = { ...createEmptyDocument(), canvas: { width: 4096, height: 4096 } };
    const grouped = { ...document, layers: [createGroupLayer(document, "Group")] };
    expect(planExport({ ...options, width: 4096, height: 4096 }, grouped).estimatedBytes).toBeLessThan(EXPORT_MEMORY_LIMIT_BYTES);
    const factory = jest.fn(mockCanvas);
    await expect(exportOpenRaster(grouped, { createCanvas: factory })).rejects.toThrow("OpenRaster export exceeds memory budget");
    expect(factory).not.toHaveBeenCalled();
  });

  it("releases group and drawing canvases when vector rasterization fails", async () => {
    const document = { ...createEmptyDocument(), canvas: { width: 8, height: 8 } };
    const group = createGroupLayer(document, "Group");
    const layer = { ...createDrawingLayer(document, "paint", "Paint"), parentId: group.id,
      strokes: [{ id: "stroke", points: [{ x: 0, y: 0 }], size: 4, mode: "paint" as const, value: 255 }] };
    const canvases: HTMLCanvasElement[] = [];
    let usage: RenderMemoryUsage | undefined;
    await expect(exportImage({ ...document, layers: [group, layer] }, options, {
      createCanvas: (width, height) => {
        const canvas = mockCanvas(width, height);
        canvases.push(canvas); return canvas;
      }, onMemoryUsage: (value) => { usage = value; },
    })).rejects.toThrow();
    expect(usage?.currentBytes).toBe(0);
    expect(canvases).toHaveLength(3);
    expect(canvases.every((canvas) => canvas.width === 1 && canvas.height === 1)).toBe(true);
  });

  it("waits for native encoding before releasing the canvas and rejects a cancelled result", async () => {
    const controller = new AbortController();
    const usage: RenderMemoryUsage[] = [];
    let complete!: BlobCallback;
    let canvas!: HTMLCanvasElement;
    const document = { ...createEmptyDocument(), canvas: { width: 8, height: 8 } };
    const exporting = exportImage(document, options, {
      signal: controller.signal, onMemoryUsage: (value) => usage.push(value),
      createCanvas: (width, height) => {
        canvas = { ...mockCanvas(width, height), toBlob(callback: BlobCallback) { complete = callback; } } as HTMLCanvasElement;
        return canvas;
      },
    });
    const rejected = expect(exporting).rejects.toMatchObject({ name: "AbortError" });
    while (!complete) await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort();
    expect(canvas.width).toBe(8);
    expect(usage.at(-1)?.currentBytes).toBe(8 * 8 * 12);
    complete(new Blob([], { type: "image/png" }));
    await rejected;
    expect(canvas.width).toBe(1);
    expect(usage.at(-1)?.currentBytes).toBe(0);
  });

  it("sizes feather scratch buffers in physical pixels without scaling them twice", async () => {
    const document = { ...createEmptyDocument(), canvas: { width: 64, height: 64 } };
    const mask = createDrawingLayer(document, "mask", "Mask");
    const dimensions: number[][] = [];
    const canvases: HTMLCanvasElement[] = [];
    const context = { scale() {}, save() {}, restore() {}, setTransform() {}, drawImage() {}, putImageData() {},
      getImageData: (_x: number, _y: number, width: number, height: number) => ({ data: new Uint8ClampedArray(width * height * 4) }),
    };
    await applyRasterMask({ ...mockCanvas(32, 32), getContext: () => context } as unknown as HTMLCanvasElement,
      mask, (width, height) => {
        dimensions.push([Math.ceil(width / 2), Math.ceil(height / 2)]);
        const canvas = { ...mockCanvas(Math.ceil(width / 2), Math.ceil(height / 2)), getContext: () => context } as unknown as HTMLCanvasElement;
        canvases.push(canvas); return canvas;
      }, .5, false, 4);
    expect(dimensions).toEqual([[32, 32], [44, 44]]);
    expect(canvases.every((canvas) => canvas.width === 1 && canvas.height === 1)).toBe(true);
  });
});
