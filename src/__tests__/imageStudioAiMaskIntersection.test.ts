import { intersectOpaqueMaskData, maskInputFromSelection, maskInputFromLayer } from "../ai/maskInput";

jest.mock("../domain/editCoverage", () => ({ coverageFromDrawingMask: () => new Uint8ClampedArray([128, 220]) }));

describe("Image Studio AI mask intersection", () => {
  it("keeps soft linked-mask coverage only inside the temporary selection", () => {
    const rgba = new Uint8ClampedArray([
      128, 128, 128, 255,
      220, 220, 220, 255,
      40, 40, 40, 255,
    ]);
    intersectOpaqueMaskData(rgba, 3, 1, { width: 3, height: 1, pixels: new Uint8Array([1, 0, 1]) });
    expect([...rgba]).toEqual([
      128, 128, 128, 255,
      0, 0, 0, 255,
      40, 40, 40, 255,
    ]);
  });

  it("fails closed on a stale selection without touching the mask", () => {
    const rgba = new Uint8ClampedArray([255, 255, 255, 255]);
    expect(() => intersectOpaqueMaskData(rgba, 1, 1, { width: 2, height: 1, pixels: new Uint8Array([1, 1]) }))
      .toThrow("Selection and mask dimensions do not match");
    expect([...rgba]).toEqual([255, 255, 255, 255]);
  });

  it("keeps the encoding canvas alive until native PNG completion, then releases it", async () => {
    let complete!: BlobCallback;
    const canvas = { width: 0, height: 0, getContext: () => ({
      createImageData: () => ({ data: new Uint8ClampedArray(8) }), putImageData: () => {},
    }), toBlob: (callback: BlobCallback) => { complete = callback; } } as unknown as HTMLCanvasElement;
    const create = jest.spyOn(document, "createElement").mockReturnValue(canvas);
    try {
      const result = maskInputFromSelection({ width: 2, height: 1, pixels: new Uint8Array([1, 0]) });
      expect(canvas.width).toBe(2);
      complete(new Blob(["png"], { type: "image/png" }));
      await expect(result).resolves.toBeInstanceOf(Blob);
      expect([canvas.width, canvas.height]).toEqual([1, 1]);
    } finally { create.mockRestore(); }
  });

  it("detects an empty intersection even when the linked mask itself is nonempty", async () => {
    const onCoverage = jest.fn();
    const canvas = { width: 0, height: 0, getContext: () => ({
      createImageData: () => ({ data: new Uint8ClampedArray(8) }), putImageData: () => {},
    }), toBlob: (callback: BlobCallback) => callback(new Blob(["png"])) } as unknown as HTMLCanvasElement;
    const create = jest.spyOn(document, "createElement").mockReturnValue(canvas);
    try {
      await maskInputFromLayer({ width: 2, height: 1 } as any, { onCoverage }, { width: 2, height: 1, pixels: new Uint8Array([0, 0]) });
      expect(onCoverage).toHaveBeenLastCalledWith(false);
      await maskInputFromLayer({ width: 2, height: 1 } as any, { onCoverage }, { width: 2, height: 1, pixels: new Uint8Array([1, 0]) });
      expect(onCoverage).toHaveBeenLastCalledWith(true);
    } finally { create.mockRestore(); }
  });

  it("releases a selection encoding canvas when native PNG encoding fails", async () => {
    const canvas = { width: 0, height: 0, getContext: () => ({
      createImageData: () => ({ data: new Uint8ClampedArray(8) }), putImageData: () => {},
    }), toBlob: (callback: BlobCallback) => callback(null) } as unknown as HTMLCanvasElement;
    const create = jest.spyOn(document, "createElement").mockReturnValue(canvas);
    try {
      await expect(maskInputFromSelection({ width: 2, height: 1, pixels: new Uint8Array([1, 0]) })).rejects.toThrow("encode the mask");
      expect([canvas.width, canvas.height]).toEqual([1, 1]);
    } finally { create.mockRestore(); }
  });
});
