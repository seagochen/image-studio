import {
  applyFilterPreset, canvasFilter, clampCrop, createRasterAdjustments, hasGeometryChanges, outputDimensions, resizeForCrop,
} from "../domain/rasterAdjustments";

describe("image studio raster adjustments", () => {
  it("clamps crop rectangles inside the source image", () => {
    expect(clampCrop({ x: -5, y: 80, width: 500, height: 40 }, 200, 100)).toEqual({ x: 0, y: 80, width: 200, height: 20 });
  });

  it("keeps resize scale when the crop changes", () => {
    const initial = { ...createRasterAdjustments(400, 200), resizeWidth: 200, resizeHeight: 100 };
    expect(resizeForCrop(initial, { x: 0, y: 0, width: 100, height: 50 })).toMatchObject({ resizeWidth: 50, resizeHeight: 25 });
  });

  it("swaps output dimensions for quarter turns", () => {
    const initial = createRasterAdjustments(320, 180);
    expect(outputDimensions({ ...initial, rotation: 90 })).toEqual({ width: 180, height: 320 });
  });

  it("distinguishes geometry edits from color and flip-only edits", () => {
    const initial = createRasterAdjustments(320, 180);
    expect(hasGeometryChanges({ ...initial, brightness: 120, flipX: true }, 320, 180)).toBe(false);
    expect(hasGeometryChanges({ ...initial, rotation: 180 }, 320, 180)).toBe(true);
    expect(hasGeometryChanges({ ...initial, resizeWidth: 160, resizeHeight: 90 }, 320, 180)).toBe(true);
    expect(hasGeometryChanges({ ...initial, crop: { x: 10, y: 0, width: 310, height: 180 } }, 320, 180)).toBe(true);
  });

  it("applies a preset without changing geometry", () => {
    const initial = { ...createRasterAdjustments(320, 180), rotation: 90 as const, flipX: true, red: 75 };
    const vivid = applyFilterPreset(initial, "vivid");
    expect(vivid).toMatchObject({ rotation: 90, flipX: true, contrast: 112, saturation: 138, red: 100, green: 100, blue: 100 });
    expect(canvasFilter(vivid)).toContain("contrast(112%)");
  });
});
