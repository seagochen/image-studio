import { intersectOpaqueMaskData } from "../ai/maskInput";

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
});
