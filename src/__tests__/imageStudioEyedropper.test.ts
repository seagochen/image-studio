import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  LOUPE_BOX, loupePlacement, requestNativeColor, sampledPixelColor, type EyeDropperConstructor,
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

  it("places the loupe above and to the right of the pointer, clear of the sampled pixel", () => {
    const surface = { width: 1000, height: 800 };
    const { left, top } = loupePlacement({ x: 300, y: 400 }, surface);
    expect(left).toBeGreaterThan(300);
    expect(top + LOUPE_BOX.height).toBeLessThan(400);
  });

  it("flips the loupe at the right and top edges and never leaves the surface", () => {
    const surface = { width: 1000, height: 800 };
    const nearRight = loupePlacement({ x: 980, y: 400 }, surface);
    expect(nearRight.left + LOUPE_BOX.width).toBeLessThan(980);
    const nearTop = loupePlacement({ x: 300, y: 10 }, surface);
    expect(nearTop.top).toBeGreaterThan(10);
    const corner = loupePlacement({ x: 995, y: 5 }, { width: 140, height: 150 });
    expect(corner.left).toBeGreaterThanOrEqual(0);
    expect(corner.top).toBeGreaterThanOrEqual(0);
  });

  it("samples the canvas through the loupe instead of the browser picker, which stays a separate action", () => {
    const studio = readFileSync(resolve(__dirname, "../studio/Studio.tsx"), "utf8");
    const session = readFileSync(resolve(__dirname, "../studio/useRasterToolSession.ts"), "utf8");
    expect(studio).toContain('else if (action === "eyedropper") activateTool("eyedropper");');
    expect(studio).toContain("<EyedropperLoupe");
    expect(studio).toContain("onPickScreen={nativeEyeDropper ?");
    expect(studio).toContain("name={UI_OVERLAY_LAYER_NAME}");
    expect(session).toContain("sampleCanvasColor(captureStagePixels(stageRef.current), pointer)");
  });

  it("leaves the eyedropper letter key available for typing", () => {
    expect(shortcutAction({ key: "i", ctrlKey: false, metaKey: false, shiftKey: false })).toBeNull();
  });
});
