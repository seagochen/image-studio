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
