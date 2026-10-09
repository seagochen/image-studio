export interface EyeDropperInstance {
  open(): Promise<{ sRGBHex: string }>;
}

export type EyeDropperConstructor = new () => EyeDropperInstance;

export type NativeColorPickResult =
  | { status: "picked"; color: string }
  | { status: "fallback" }
  | { status: "cancelled" };

export async function requestNativeColor(
  EyeDropper: EyeDropperConstructor | undefined,
): Promise<NativeColorPickResult> {
  if (!EyeDropper) return { status: "fallback" };
  try {
    const color = (await new EyeDropper().open()).sRGBHex.toLowerCase();
    return /^#[0-9a-f]{6}$/.test(color) ? { status: "picked", color } : { status: "cancelled" };
  } catch {
    return { status: "cancelled" };
  }
}

export function sampledPixelColor(pixel: ArrayLike<number>): string | null {
  if (pixel.length < 4 || pixel[3] === 0) return null;
  const channels = [pixel[0], pixel[1], pixel[2]].map((value) => (
    Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0")
  ));
  return `#${channels.join("")}`;
}

export interface LoupePoint { x: number; y: number }
export interface LoupeBox { width: number; height: number }

/** Magnified neighbourhood: 2 * radius + 1 sampled pixels per side. */
export const LOUPE_SAMPLE_RADIUS = 6;
export const LOUPE_DIAMETER = 117;
/** The loupe with its 3px ring, plus the colour readout below it. */
export const LOUPE_BOX: LoupeBox = { width: LOUPE_DIAMETER + 6, height: LOUPE_DIAMETER + 6 + 30 };
const LOUPE_GAP = 18;

/**
 * Places the loupe above and to the right of the pointer so the sampled pixel stays visible,
 * flipping to the opposite side of each axis that would leave the surface.
 */
export function loupePlacement(pointer: LoupePoint, surface: LoupeBox, box: LoupeBox = LOUPE_BOX): { left: number; top: number } {
  let left = pointer.x + LOUPE_GAP;
  let top = pointer.y - LOUPE_GAP - box.height;
  if (left + box.width > surface.width) left = pointer.x - LOUPE_GAP - box.width;
  if (top < 0) top = pointer.y + LOUPE_GAP;
  return {
    left: Math.max(0, Math.min(left, surface.width - box.width)),
    top: Math.max(0, Math.min(top, surface.height - box.height)),
  };
}
