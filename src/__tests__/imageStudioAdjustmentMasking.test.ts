import { createEmptyDocument } from "../domain/document";
import { addLayer, createDrawingLayer } from "../domain/commands";
import { createAdjustmentLayer } from "../domain/adjustmentEngine";
import { adjacentMaskLayerIds } from "../domain/adjustmentMasking";
import { combineMaskData } from "../domain/exportImage";

// Issue #171: an adjustment layer's mask(s) are derived from position — every mask-type
// layer directly above it, within the same parent, with no gap — instead of a stored
// maskLayerId reference, and multiple stacked masks combine by multiplying their weights.
describe("adjacentMaskLayerIds", () => {
  it("finds nothing above an adjustment with no mask", () => {
    const initial = createEmptyDocument();
    const adjustment = createAdjustmentLayer(initial, "exposure", "Exposure");
    const document = addLayer(initial, adjustment);
    expect(adjacentMaskLayerIds(document.layers, adjustment)).toEqual([]);
  });

  it("finds a single mask directly above", () => {
    const initial = createEmptyDocument();
    const adjustment = createAdjustmentLayer(initial, "exposure", "Exposure");
    const mask = createDrawingLayer(initial, "mask", "Mask");
    const document = addLayer(addLayer(initial, adjustment), mask);
    expect(adjacentMaskLayerIds(document.layers, adjustment)).toEqual([mask.id]);
  });

  it("collects several consecutive masks, closest first", () => {
    const initial = createEmptyDocument();
    const adjustment = createAdjustmentLayer(initial, "exposure", "Exposure");
    const maskA = createDrawingLayer(initial, "mask", "A");
    const maskB = createDrawingLayer(initial, "mask", "B");
    const document = [adjustment, maskA, maskB].reduce(addLayer, initial);
    expect(adjacentMaskLayerIds(document.layers, adjustment)).toEqual([maskA.id, maskB.id]);
  });

  it("stops at the first non-mask layer, ignoring masks beyond the gap", () => {
    const initial = createEmptyDocument();
    const adjustment = createAdjustmentLayer(initial, "exposure", "Exposure");
    const raster = createDrawingLayer(initial, "paint", "Paint");
    const mask = createDrawingLayer(initial, "mask", "Mask");
    const document = [adjustment, raster, mask].reduce(addLayer, initial);
    expect(adjacentMaskLayerIds(document.layers, adjustment)).toEqual([]);
  });

  it("ignores a raw-adjacent mask that belongs to a different parent", () => {
    const initial = createEmptyDocument();
    const adjustment = createAdjustmentLayer(initial, "exposure", "Exposure");
    const mask = { ...createDrawingLayer(initial, "mask", "Mask"), parentId: "other-group" };
    const document = addLayer(addLayer(initial, adjustment), mask);
    expect(adjacentMaskLayerIds(document.layers, adjustment)).toEqual([]);
  });
});

describe("combineMaskData", () => {
  const pixel = (r: number, g: number, b: number, a: number): Uint8ClampedArray => new Uint8ClampedArray([r, g, b, a]);

  it("keeps full weight when every mask is opaque white", () => {
    const combined = combineMaskData([pixel(255, 255, 255, 255), pixel(255, 255, 255, 255)]);
    expect(Array.from(combined)).toEqual([255, 255, 255, 255]);
  });

  it("zeroes out when any mask is opaque black", () => {
    const combined = combineMaskData([pixel(255, 255, 255, 255), pixel(0, 0, 0, 255)]);
    expect(Array.from(combined)).toEqual([0, 0, 0, 255]);
  });

  it("zeroes out when any mask is fully transparent, regardless of color", () => {
    const combined = combineMaskData([pixel(255, 255, 255, 255), pixel(255, 255, 255, 0)]);
    expect(Array.from(combined)).toEqual([0, 0, 0, 255]);
  });

  it("multiplies two partial-weight masks", () => {
    const combined = combineMaskData([pixel(128, 128, 128, 255), pixel(128, 128, 128, 255)]);
    // weight per mask = 128/255*3/3 ≈ .502; combined ≈ .502² ≈ .252 → 255*.252 ≈ 64
    expect(Array.from(combined)).toEqual([64, 64, 64, 255]);
  });
});
