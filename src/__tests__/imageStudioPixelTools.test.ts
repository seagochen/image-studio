import {
  clearSelectedTile, combineSelectionMask, constrainRgbaToSelection, contiguousColorSelectionMask, createSeededRandom, ellipticalSelectionMask,
  interpolatedPoints, invertSelectionMask, mixChannelRange, polygonSelectionMask, rectangularSelectionMask, selectedTileRects,
} from "../domain/pixelTools";

describe("Image Studio pixel tools", () => {
  test("seeded spray distribution can be reproduced", () => {
    const first = createSeededRandom(42);
    const second = createSeededRandom(42);
    expect(Array.from({ length: 8 }, first)).toEqual(Array.from({ length: 8 }, second));
  });

  test("channel mixer changes RGB while preserving alpha and clamps values", () => {
    const baseline = new Uint8ClampedArray([100, 120, 200, 77, 250, 10, 40, 255]);
    const output = new Uint8ClampedArray(baseline);
    mixChannelRange(output, baseline, 0, output.length, { red: 200, green: 50, blue: 0 });
    expect([...output]).toEqual([200, 60, 0, 77, 255, 5, 0, 255]);
  });

  test("stroke interpolation covers the end point at bounded spacing", () => {
    const points = interpolatedPoints({ x: 0, y: 0 }, { x: 10, y: 0 }, 3);
    expect(points).toHaveLength(4);
    expect(points.at(-1)).toEqual({ x: 10, y: 0 });
  });

  test("rectangular selection is bounded to the raster", () => {
    const selection = rectangularSelectionMask(4, 3, { x: 2.8, y: 2.2 }, { x: 1.1, y: 0.4 });
    expect([...selection.pixels]).toEqual([
      0, 1, 1, 0,
      0, 1, 1, 0,
      0, 1, 1, 0,
    ]);
  });

  test("magic selection stays within a contiguous color region", () => {
    const rgba = new Uint8ClampedArray([
      10, 10, 10, 255, 12, 12, 12, 255, 200, 200, 200, 255,
      11, 11, 11, 255, 210, 210, 210, 255, 13, 13, 13, 255,
    ]);
    const selection = contiguousColorSelectionMask(rgba, 3, 2, { x: 0, y: 0 }, 3);
    expect([...selection.pixels]).toEqual([1, 1, 0, 1, 0, 0]);
  });

  test("elliptical selection keeps its corners outside the mask", () => {
    const selection = ellipticalSelectionMask(5, 5, { x: 0, y: 0 }, { x: 4, y: 4 });
    expect(selection.pixels[0]).toBe(0);
    expect(selection.pixels[2]).toBe(1);
    expect(selection.pixels[12]).toBe(1);
    expect(selection.pixels[24]).toBe(0);
  });

  test("polygon selection uses a deterministic even-odd raster", () => {
    const selection = polygonSelectionMask(5, 5, [{ x: 1, y: 1 }, { x: 4, y: 1 }, { x: 1, y: 4 }]);
    expect([...selection.pixels]).toEqual([
      0, 0, 0, 0, 0,
      0, 1, 1, 1, 0,
      0, 1, 1, 0, 0,
      0, 1, 0, 0, 0,
      0, 0, 0, 0, 0,
    ]);
  });

  test("selection boolean operations and inversion do not mutate their inputs", () => {
    const left = rectangularSelectionMask(4, 1, { x: 0, y: 0 }, { x: 1, y: 0 });
    const right = rectangularSelectionMask(4, 1, { x: 1, y: 0 }, { x: 2, y: 0 });
    expect([...combineSelectionMask(left, right, "add").pixels]).toEqual([1, 1, 1, 0]);
    expect([...combineSelectionMask(left, right, "subtract").pixels]).toEqual([1, 0, 0, 0]);
    expect([...combineSelectionMask(left, right, "intersect").pixels]).toEqual([0, 1, 0, 0]);
    expect([...invertSelectionMask(left).pixels]).toEqual([0, 0, 1, 1]);
    expect([...left.pixels]).toEqual([1, 1, 0, 0]);
  });

  test("restores unselected pixels in a changed tile without changing selected pixels", () => {
    const before = new Uint8ClampedArray([10, 20, 30, 255, 40, 50, 60, 255]);
    const after = new Uint8ClampedArray([99, 99, 99, 255, 88, 88, 88, 255]);
    const selection = { width: 2, height: 1, pixels: new Uint8Array([0, 1]) };
    expect([...constrainRgbaToSelection(before, after, selection, 0, 0, 2, 1)]).toEqual([10, 20, 30, 255, 88, 88, 88, 255]);
  });

  test("tile deletion clears only selected RGBA values", () => {
    const rgba = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255]);
    const output = clearSelectedTile(rgba, { width: 3, height: 1, pixels: new Uint8Array([0, 0, 1]) }, 1, 0, 2, 1);
    expect([...output]).toEqual([255, 0, 0, 255, 0, 0, 0, 0]);
    expect([...rgba]).toEqual([255, 0, 0, 255, 0, 255, 0, 255]);
    expect(() => clearSelectedTile(rgba, { width: 3, height: 1, pixels: new Uint8Array([0, 0, 1]) }, 2, 0, 2, 1)).toThrow();
  });

  test("supports standard 4K selections and captures only touched history tiles", () => {
    const selection = rectangularSelectionMask(4096, 4096, { x: 255, y: 300 }, { x: 256, y: 300 });
    expect(selection.pixels.byteLength).toBe(4096 * 4096);
    expect(selectedTileRects(selection, 256)).toEqual([
      { x: 0, y: 256, width: 256, height: 256 },
      { x: 256, y: 256, width: 256, height: 256 },
    ]);
    expect(() => rectangularSelectionMask(10_000, 10_000, { x: 0, y: 0 }, { x: 1, y: 1 })).toThrow("Invalid selection dimensions");
  });
});
