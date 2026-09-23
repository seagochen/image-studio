import {
  requestNativeColor, sampledPixelColor, type EyeDropperConstructor,
} from "../domain/eyedropper";
import { shortcutAction } from "../domain/shortcuts";

describe("Image Studio eyedropper", () => {
  it("normalizes a native EyeDropper result", async () => {
    class EyeDropper {
      async open(): Promise<{ sRGBHex: string }> { return { sRGBHex: "#A1B2C3" }; }
    }
    await expect(requestNativeColor(EyeDropper as EyeDropperConstructor))
      .resolves.toEqual({ status: "picked", color: "#a1b2c3" });
  });

  it("selects canvas fallback when the native API is unavailable", async () => {
    await expect(requestNativeColor(undefined)).resolves.toEqual({ status: "fallback" });
  });

  it("treats cancellation and malformed native values as no selection", async () => {
    class CancelledEyeDropper {
      async open(): Promise<{ sRGBHex: string }> { throw new DOMException("cancelled", "AbortError"); }
    }
    class InvalidEyeDropper {
      async open(): Promise<{ sRGBHex: string }> { return { sRGBHex: "red" }; }
    }
    await expect(requestNativeColor(CancelledEyeDropper as EyeDropperConstructor))
      .resolves.toEqual({ status: "cancelled" });
    await expect(requestNativeColor(InvalidEyeDropper as EyeDropperConstructor))
      .resolves.toEqual({ status: "cancelled" });
  });

  it("converts opaque canvas pixels and ignores transparent pixels", () => {
    expect(sampledPixelColor(new Uint8ClampedArray([1, 15, 255, 255]))).toBe("#010fff");
    expect(sampledPixelColor(new Uint8ClampedArray([1, 15, 255, 0]))).toBeNull();
  });

  it("leaves the eyedropper letter key available for typing", () => {
    expect(shortcutAction({ key: "i", ctrlKey: false, metaKey: false, shiftKey: false })).toBeNull();
  });
});
