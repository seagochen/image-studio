export interface HsvColor {
  hue: number;
  saturation: number;
  value: number;
}

export function hexToHsv(hex: string): HsvColor {
  const number = Number.parseInt(hex.slice(1), 16);
  const red = ((number >> 16) & 255) / 255;
  const green = ((number >> 8) & 255) / 255;
  const blue = (number & 255) / 255;
  const max = Math.max(red, green, blue);
  const delta = max - Math.min(red, green, blue);
  let hue = 0;
  if (delta) {
    if (max === red) hue = 60 * (((green - blue) / delta) % 6);
    else if (max === green) hue = 60 * ((blue - red) / delta + 2);
    else hue = 60 * ((red - green) / delta + 4);
  }
  return { hue: (hue + 360) % 360, saturation: max ? delta / max : 0, value: max };
}

export function hsvToHex(hue: number, saturation: number, value: number): string {
  const chroma = value * saturation;
  const segment = hue / 60;
  const x = chroma * (1 - Math.abs(segment % 2 - 1));
  const [red, green, blue] = segment < 1 ? [chroma, x, 0] : segment < 2 ? [x, chroma, 0]
    : segment < 3 ? [0, chroma, x] : segment < 4 ? [0, x, chroma]
      : segment < 5 ? [x, 0, chroma] : [chroma, 0, x];
  const match = value - chroma;
  return `#${[red, green, blue].map((channel) => Math.round((channel + match) * 255).toString(16).padStart(2, "0")).join("")}`;
}

export type ColorSchemeKind = "complementary" | "splitComplementary" | "monochromatic" | "analogous" | "triadic" | "tetradic";

export const COLOR_SCHEME_KINDS: readonly ColorSchemeKind[] = [
  "complementary", "splitComplementary", "monochromatic", "analogous", "triadic", "tetradic",
];

// Plain string literals (not imported from the UI's i18n.ts) so this domain
// module has no dependency on the UI layer; each value is also a member of
// image-studio's MessageKey union, so callers can pass one straight to t().
export type HarmonyLabelKey =
  | "harmonyBase" | "harmonyComplementary"
  | "harmonySplit1" | "harmonySplit2"
  | "harmonyAnalogous1" | "harmonyAnalogous2"
  | "harmonyTriadic2" | "harmonyTriadic3"
  | "harmonyTetradic2" | "harmonyTetradic3" | "harmonyTetradic4";

export interface HarmonySwatch {
  hex: string;
  labelKey: HarmonyLabelKey;
}

const SCHEME_HUE_OFFSETS: Record<Exclude<ColorSchemeKind, "monochromatic">, readonly number[]> = {
  complementary: [180],
  splitComplementary: [150, 210],
  analogous: [-30, 30],
  triadic: [120, 240],
  tetradic: [90, 180, 270],
};

const SCHEME_LABEL_KEYS: Record<Exclude<ColorSchemeKind, "monochromatic">, readonly HarmonyLabelKey[]> = {
  complementary: ["harmonyComplementary"],
  splitComplementary: ["harmonySplit1", "harmonySplit2"],
  analogous: ["harmonyAnalogous1", "harmonyAnalogous2"],
  triadic: ["harmonyTriadic2", "harmonyTriadic3"],
  tetradic: ["harmonyTetradic2", "harmonyTetradic3", "harmonyTetradic4"],
};

/** The base color plus its harmony partners for `scheme` (same saturation
 *  and value, hue rotated per the scheme's rule), or an empty list for
 *  "monochromatic" — that scheme varies value/saturation at a single hue,
 *  so it has no second hue-based swatch to show. */
export function colorSchemeSwatches(hex: string, scheme: ColorSchemeKind): HarmonySwatch[] {
  if (scheme === "monochromatic") return [];
  const hsv = hexToHsv(hex);
  const offsets = SCHEME_HUE_OFFSETS[scheme];
  const labelKeys = SCHEME_LABEL_KEYS[scheme];
  return [
    { hex: hex.toLowerCase(), labelKey: "harmonyBase" },
    ...offsets.map((offset, index) => ({
      hex: hsvToHex((hsv.hue + offset + 360) % 360, hsv.saturation, hsv.value),
      labelKey: labelKeys[index],
    })),
  ];
}
