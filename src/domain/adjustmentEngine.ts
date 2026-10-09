import type { AdjustmentDefinition, AdjustmentKind, AdjustmentLayer, ImageStudioDocument, LayerBlendMode } from "./document";
import { createId, defaultTransform, layerTagColor } from "./document";

export function defaultAdjustment(kind: AdjustmentKind): AdjustmentDefinition {
  const parameters: AdjustmentDefinition["parameters"] = kind === "exposure" ? { exposure: 0, offset: 0, gamma: 1 }
    : kind === "levels" ? { channel: "rgb", inputBlack: 0, inputWhite: 255, gamma: 1, outputBlack: 0, outputWhite: 255 }
    : kind === "curves" ? { channel: "rgb", points: [{ x: 0, y: 0 }, { x: 255, y: 255 }] }
    : kind === "vibrance" ? { amount: 0 }
    : kind === "hue-saturation" ? { hue: 0, saturation: 0, lightness: 0 }
    : kind === "temperature-tint" ? { temperature: 0, tint: 0 }
    : kind === "color-balance" ? { shadowsCyanRed: 0, shadowsMagentaGreen: 0, shadowsYellowBlue: 0, midtonesCyanRed: 0, midtonesMagentaGreen: 0, midtonesYellowBlue: 0, highlightsCyanRed: 0, highlightsMagentaGreen: 0, highlightsYellowBlue: 0 }
    : kind === "black-white" ? { red: 40, yellow: 60, green: 40, cyan: 60, blue: 20, magenta: 80, tint: false, tintColor: "#b9a27a" }
    : kind === "gradient-map" ? { shadow: "#000000", highlight: "#ffffff", reverse: false }
    : kind === "lut" ? { name: "", dimension: "3d", size: 2, domainMin: [0, 0, 0], domainMax: [1, 1, 1], values: [0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0, 0, 0, 1, 1, 0, 1, 0, 1, 1, 1, 1, 1], strength: 100 }
    : kind === "selective-color" ? selectiveColorDefaults()
    : kind === "clarity" ? { amount: 0, radius: 8 }
    : kind === "dehaze" ? { amount: 0, radius: 16, toneProtection: 35 }
    : kind === "shadows-highlights" ? { shadows: 0, highlights: 0, radius: 16 }
    : {};
  return { kind, parameters };
}

const SELECTIVE_RANGES = ["red", "yellow", "green", "cyan", "blue", "magenta", "white", "neutral", "black"] as const;
function selectiveColorDefaults(): AdjustmentDefinition["parameters"] {
  return Object.fromEntries(SELECTIVE_RANGES.flatMap((range) => ["Cyan", "Magenta", "Yellow", "Black"].map((axis) => [`${range}${axis}`, 0])));
}

export function createAdjustmentLayer(document: ImageStudioDocument, kind: AdjustmentKind, name: string, parentId: string | null = null): AdjustmentLayer {
  return {
    id: createId("adjustment"), type: "adjustment", name, tagColor: layerTagColor(), visible: true, locked: false, opacity: 1, blendMode: "normal",
    parentId, transform: defaultTransform(), width: document.canvas.width, height: document.canvas.height,
    adjustment: defaultAdjustment(kind),
  };
}

export function histogram(data: Uint8ClampedArray): { red: number[]; green: number[]; blue: number[]; luminosity: number[] } {
  const result = { red: zeroes(), green: zeroes(), blue: zeroes(), luminosity: zeroes() };
  for (let index = 0; index < data.length; index += 4) {
    if (!data[index + 3]) continue;
    result.red[data[index]] += 1; result.green[data[index + 1]] += 1; result.blue[data[index + 2]] += 1;
    result.luminosity[Math.round(data[index] * .2126 + data[index + 1] * .7152 + data[index + 2] * .0722)] += 1;
  }
  return result;
}

// Log-scaled so a handful of near-black or near-white pixels doesn't flatten the rest of the
// histogram to invisible bars.
export function previewLuminosityHistogram(canvas: HTMLCanvasElement): number[] | undefined {
  try {
    const values = histogram(canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data).luminosity;
    const maximum = Math.max(1, ...values);
    return values.map((value) => Math.log1p(value) / Math.log1p(maximum));
  } catch { return undefined; }
}

export function applyAdjustment(
  data: Uint8ClampedArray,
  definition: AdjustmentDefinition,
  opacity = 1,
  mask?: Uint8ClampedArray,
  blendMode: LayerBlendMode = "normal",
  dimensions?: { width: number; height: number },
): Uint8ClampedArray {
  if (isSpatialAdjustment(definition.kind) && dimensions && dimensions.width * dimensions.height * 4 === data.length) {
    return applySpatialAdjustment(data, dimensions.width, dimensions.height, definition, opacity, mask, blendMode);
  }
  const output = new Uint8ClampedArray(data);
  adjustmentKernel(definition, opacity, blendMode)(output, mask);
  return output;
}

/** Compile channel curves once per operation, rather than sorting points for every pixel. */
export function adjustmentKernel(definition: AdjustmentDefinition, opacity = 1, blendMode: LayerBlendMode = "normal") {
  const independent = ["exposure", "levels", "curves", "invert", "temperature-tint"].includes(definition.kind);
  const tables = independent ? [0, 1, 2].map((channel) => {
    const points = definition.kind === "curves" ? curvePoints(definition.parameters.points) : null;
    return Array.from({ length: 256 }, (_, value) => {
      if (points) return definition.parameters.channel === "rgb" || !definition.parameters.channel || definition.parameters.channel === ["r", "g", "b"][channel]
        ? curveValue(value, points) : value;
      return adjustedPixel([value, value, value], definition.kind, definition.parameters)[channel];
    });
  }) : null;
  return (data: Uint8ClampedArray, mask?: Uint8ClampedArray): void => {
    const effectiveMask = mask?.length === data.length ? mask : undefined;
    for (let index = 0; index < data.length; index += 4) {
      if (!data[index + 3]) continue;
      const amount = clamp01(opacity * (effectiveMask ? effectiveMask[index + 3] / 255
        * (effectiveMask[index] + effectiveMask[index + 1] + effectiveMask[index + 2]) / 765 : 1));
      if (amount === 0) continue;
      if (tables && blendMode === "normal") {
        for (let channel = 0; channel < 3; channel += 1) {
          const value = data[index + channel];
          data[index + channel] = mix(value, tables[channel][value], amount);
        }
      } else {
        const original: RGB = [data[index], data[index + 1], data[index + 2]];
        const adjusted = tables ? original.map((value, channel) => tables[channel][value]) as RGB : adjustedPixel(original, definition.kind, definition.parameters);
        const changed = blendPixel(original, adjusted, blendMode);
        for (let channel = 0; channel < 3; channel += 1) data[index + channel] = mix(original[channel], changed[channel], amount);
      }
    }
  };
}

export const ADJUSTMENT_CHUNK_PIXELS = 16_384;
export function yieldRenderTask(signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  return new Promise<void>((resolve) => setTimeout(resolve, 0)).then(() => signal?.throwIfAborted());
}

export async function applyAdjustmentAsync(data: Uint8ClampedArray, definition: AdjustmentDefinition, options: {
  opacity?: number; mask?: Uint8ClampedArray; blendMode?: LayerBlendMode; signal?: AbortSignal;
  width?: number; height?: number;
  yieldTask?: () => Promise<void>;
} = {}): Promise<Uint8ClampedArray> {
  options.signal?.throwIfAborted();
  if (isSpatialAdjustment(definition.kind) && options.width && options.height && options.width * options.height * 4 === data.length) {
    await (options.yieldTask ?? (() => yieldRenderTask(options.signal)))();
    options.signal?.throwIfAborted();
    const result = applySpatialAdjustment(data, options.width, options.height, definition, options.opacity, options.mask, options.blendMode);
    await (options.yieldTask ?? (() => yieldRenderTask(options.signal)))();
    options.signal?.throwIfAborted();
    return result;
  }
  const output = new Uint8ClampedArray(data);
  const kernel = adjustmentKernel(definition, options.opacity, options.blendMode);
  const mask = options.mask?.length === data.length ? options.mask : undefined;
  for (let start = 0; start < output.length; start += ADJUSTMENT_CHUNK_PIXELS * 4) {
    await (options.yieldTask ?? (() => yieldRenderTask(options.signal)))();
    options.signal?.throwIfAborted();
    const end = Math.min(output.length, start + ADJUSTMENT_CHUNK_PIXELS * 4);
    kernel(output.subarray(start, end), mask?.subarray(start, end));
  }
  return output;
}

function blendPixel(base: RGB, blend: RGB, mode: LayerBlendMode): RGB {
  if (mode === "normal") return blend;
  return base.map((value, index) => {
    const top = blend[index];
    if (mode === "multiply") return value * top / 255;
    if (mode === "screen") return 255 - (255 - value) * (255 - top) / 255;
    if (mode === "overlay") return value < 128 ? 2 * value * top / 255 : 255 - 2 * (255 - value) * (255 - top) / 255;
    if (mode === "darken") return Math.min(value, top);
    return Math.max(value, top);
  }) as RGB;
}

type RGB = [number, number, number];
type Parameters = AdjustmentDefinition["parameters"];

function adjustedPixel(rgb: RGB, kind: AdjustmentKind, p: Parameters): RGB {
  if (kind === "invert") return [255 - rgb[0], 255 - rgb[1], 255 - rgb[2]];
  if (kind === "exposure") {
    const factor = 2 ** number(p.exposure, 0); const offset = number(p.offset, 0) * 255; const gamma = Math.max(.1, number(p.gamma, 1));
    return rgb.map((value) => 255 * ((clamp(value * factor + offset) / 255) ** (1 / gamma))) as RGB;
  }
  if (kind === "levels") {
    const inputBlack = number(p.inputBlack, 0); const inputWhite = Math.max(inputBlack + 1, number(p.inputWhite, 255));
    const gamma = Math.max(.1, number(p.gamma, 1)); const outBlack = number(p.outputBlack, 0); const outWhite = number(p.outputWhite, 255);
    const channel = String(p.channel ?? "rgb");
    return rgb.map((value, index) => channel === "rgb" || channel === ["r", "g", "b"][index]
      ? outBlack + ((clamp01((value - inputBlack) / (inputWhite - inputBlack))) ** (1 / gamma)) * (outWhite - outBlack) : value) as RGB;
  }
  if (kind === "curves") {
    const channel = String(p.channel ?? "rgb"); const points = curvePoints(p.points);
    return rgb.map((value, index) => channel === "rgb" || channel === ["r", "g", "b"][index] ? curveValue(value, points) : value) as RGB;
  }
  if (kind === "vibrance") {
    const amount = number(p.amount, 0) / 100; const maximum = Math.max(...rgb); const average = (rgb[0] + rgb[1] + rgb[2]) / 3;
    const strength = amount * (1 - (maximum - Math.min(...rgb)) / 255);
    return rgb.map((value) => average + (value - average) * (1 + strength)) as RGB;
  }
  if (kind === "hue-saturation") {
    const hsl = rgbToHsl(rgb); hsl[0] = (hsl[0] + number(p.hue, 0) / 360 + 1) % 1;
    hsl[1] = clamp01(hsl[1] * (1 + number(p.saturation, 0) / 100)); hsl[2] = clamp01(hsl[2] + number(p.lightness, 0) / 100);
    return hslToRgb(hsl);
  }
  if (kind === "temperature-tint") {
    const temperature = number(p.temperature, 0) * 1.1; const tint = number(p.tint, 0) * .7;
    return [rgb[0] + temperature + tint * .2, rgb[1] - tint, rgb[2] - temperature + tint * .2];
  }
  if (kind === "color-balance") {
    const luminance = (rgb[0] + rgb[1] + rgb[2]) / 765;
    const shadows = 1 - smoothstep(.15, .5, luminance);
    const highlights = smoothstep(.5, .85, luminance);
    const midtones = 1 - shadows - highlights;
    return ["CyanRed", "MagentaGreen", "YellowBlue"].map((axis, channel) => rgb[channel]
      + shadows * number(p[`shadows${axis}`], 0) + midtones * number(p[`midtones${axis}`], 0)
      + highlights * number(p[`highlights${axis}`], 0)) as RGB;
  }
  if (kind === "black-white") {
    const contributions = [
      rgb[0] * number(p.red, 40), Math.min(rgb[0], rgb[1]) * number(p.yellow, 60),
      rgb[1] * number(p.green, 40), Math.min(rgb[1], rgb[2]) * number(p.cyan, 60),
      rgb[2] * number(p.blue, 20), Math.min(rgb[0], rgb[2]) * number(p.magenta, 80),
    ];
    const weights = ["red", "yellow", "green", "cyan", "blue", "magenta"].map((key) => Math.abs(number(p[key], 0)));
    const gray = clamp(contributions.reduce((sum, value) => sum + value, 0) / Math.max(1, weights.reduce((sum, value) => sum + value, 0)));
    if (p.tint === true) { const tint = hexRgb(String(p.tintColor ?? "#b9a27a")); return tint.map((value) => value * gray / 255) as RGB; }
    return [gray, gray, gray];
  }
  if (kind === "gradient-map") {
    const luminance = (rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722) / 255;
    const progress = p.reverse === true ? 1 - luminance : luminance;
    const shadow = hexRgb(String(p.shadow ?? "#000000")); const highlight = hexRgb(String(p.highlight ?? "#ffffff"));
    return shadow.map((value, index) => mix(value, highlight[index], progress)) as RGB;
  }
  if (kind === "lut") return applyLut(rgb, p);
  if (kind === "selective-color") return applySelectiveColor(rgb, p);
  return rgb;
}

const SPATIAL_ADJUSTMENTS: readonly AdjustmentKind[] = ["clarity", "dehaze", "shadows-highlights"];
export function isSpatialAdjustment(kind: AdjustmentKind): boolean { return SPATIAL_ADJUSTMENTS.includes(kind); }

export function spatialRadius(definition: AdjustmentDefinition): number {
  return Math.max(1, Math.min(32, Math.round(number(definition.parameters.radius, definition.kind === "clarity" ? 8 : 16))));
}

export function applySpatialAdjustment(
  data: Uint8ClampedArray, width: number, height: number, definition: AdjustmentDefinition,
  opacity = 1, mask?: Uint8ClampedArray, blendMode: LayerBlendMode = "normal",
): Uint8ClampedArray {
  if (!isSpatialAdjustment(definition.kind) || width * height * 4 !== data.length) return new Uint8ClampedArray(data);
  const output = new Uint8ClampedArray(data);
  const count = width * height;
  const luminance = new Float32Array(count);
  const dark = new Float32Array(count);
  const alpha = new Float32Array(count);
  let atmosphere = .2;
  for (let pixel = 0; pixel < count; pixel += 1) {
    const index = pixel * 4;
    const a = data[index + 3] / 255;
    alpha[pixel] = a;
    luminance[pixel] = (data[index] * .2126 + data[index + 1] * .7152 + data[index + 2] * .0722) / 255;
    dark[pixel] = Math.min(data[index], data[index + 1], data[index + 2]) / 255;
    if (a > .5) atmosphere = Math.max(atmosphere, luminance[pixel]);
  }
  const radius = spatialRadius(definition);
  const localLuminance = alphaAwareBoxBlur(luminance, alpha, width, height, radius);
  const localDark = definition.kind === "dehaze" ? alphaAwareBoxBlur(dark, alpha, width, height, radius) : null;
  const effectiveMask = mask?.length === data.length ? mask : undefined;
  const p = definition.parameters;
  for (let pixel = 0; pixel < count; pixel += 1) {
    const index = pixel * 4;
    if (!data[index + 3]) continue;
    const maskAmount = effectiveMask ? effectiveMask[index + 3] / 255 * (effectiveMask[index] + effectiveMask[index + 1] + effectiveMask[index + 2]) / 765 : 1;
    const amount = clamp01(opacity * maskAmount);
    if (!amount) continue;
    const original: RGB = [data[index], data[index + 1], data[index + 2]];
    let adjusted: RGB;
    if (definition.kind === "clarity") {
      const strength = number(p.amount, 0) / 100;
      const detail = luminance[pixel] - localLuminance[pixel];
      const toneGuard = .35 + .65 * (1 - Math.min(1, Math.abs(luminance[pixel] - .5) * 2));
      const delta = detail * strength * 1.8 * toneGuard * 255;
      adjusted = original.map((value) => value + delta) as RGB;
    } else if (definition.kind === "shadows-highlights") {
      const shadowWeight = 1 - smoothstep(.12, .62, localLuminance[pixel]);
      const highlightWeight = smoothstep(.38, .88, localLuminance[pixel]);
      const delta = number(p.shadows, 0) / 100 * shadowWeight * (1 - luminance[pixel]) * .55
        - number(p.highlights, 0) / 100 * highlightWeight * luminance[pixel] * .55;
      adjusted = original.map((value) => value + delta * 255) as RGB;
    } else {
      const strength = Math.max(0, number(p.amount, 0)) / 100;
      const protection = clamp01(number(p.toneProtection, 35) / 100);
      const transmission = Math.max(.12 + protection * .35, 1 - .95 * strength * (localDark?.[pixel] ?? 0) / Math.max(.2, atmosphere));
      const highlightGuard = 1 - smoothstep(.72, .98, luminance[pixel]) * protection;
      adjusted = original.map((value) => mix(value, 255 * ((value / 255 - atmosphere) / transmission + atmosphere), highlightGuard)) as RGB;
    }
    const changed = blendPixel(original, adjusted.map(clamp) as RGB, blendMode);
    for (let channel = 0; channel < 3; channel += 1) output[index + channel] = mix(original[channel], changed[channel], amount);
  }
  return output;
}

function alphaAwareBoxBlur(values: Float32Array, alpha: Float32Array, width: number, height: number, radius: number): Float32Array {
  const weighted = new Float32Array(values.length);
  for (let index = 0; index < values.length; index += 1) weighted[index] = values[index] * alpha[index];
  const blurredValues = boxBlur(boxBlur(weighted, width, height, radius, true), width, height, radius, false);
  const blurredAlpha = boxBlur(boxBlur(alpha, width, height, radius, true), width, height, radius, false);
  for (let index = 0; index < values.length; index += 1) blurredValues[index] = blurredAlpha[index] > .0001 ? blurredValues[index] / blurredAlpha[index] : values[index];
  return blurredValues;
}

function boxBlur(input: Float32Array, width: number, height: number, radius: number, horizontal: boolean): Float32Array {
  const output = new Float32Array(input.length);
  const lines = horizontal ? height : width;
  const length = horizontal ? width : height;
  for (let line = 0; line < lines; line += 1) {
    let sum = 0;
    for (let offset = -radius; offset <= radius; offset += 1) sum += input[blurIndex(line, Math.max(0, Math.min(length - 1, offset)), width, horizontal)];
    for (let position = 0; position < length; position += 1) {
      output[blurIndex(line, position, width, horizontal)] = sum / (radius * 2 + 1);
      const remove = Math.max(0, position - radius);
      const add = Math.min(length - 1, position + radius + 1);
      sum += input[blurIndex(line, add, width, horizontal)] - input[blurIndex(line, remove, width, horizontal)];
    }
  }
  return output;
}

function blurIndex(line: number, position: number, width: number, horizontal: boolean): number {
  return horizontal ? line * width + position : position * width + line;
}

function applyLut(rgb: RGB, p: Parameters): RGB {
  const dimension = p.dimension === "1d" ? "1d" : "3d";
  const size = Math.round(number(p.size, 0));
  const values = Array.isArray(p.values) ? p.values.filter((value): value is number => typeof value === "number" && Number.isFinite(value)) : [];
  const domainMin = numericTriplet(p.domainMin, [0, 0, 0]);
  const domainMax = numericTriplet(p.domainMax, [1, 1, 1]);
  const expected = (dimension === "1d" ? size : size ** 3) * 3;
  if (size < 2 || values.length !== expected) return rgb;
  const position = rgb.map((value, channel) => clamp01((value / 255 - domainMin[channel]) / Math.max(.000001, domainMax[channel] - domainMin[channel])) * (size - 1)) as RGB;
  let mapped: RGB;
  if (dimension === "1d") mapped = position.map((value, channel) => sample1d(values, size, channel, value) * 255) as RGB;
  else mapped = sample3d(values, size, position).map((value) => value * 255) as RGB;
  const strength = clamp01(number(p.strength, 100) / 100);
  return rgb.map((value, channel) => mix(value, mapped[channel], strength)) as RGB;
}

function sample1d(values: number[], size: number, channel: number, position: number): number {
  const low = Math.floor(position); const high = Math.min(size - 1, low + 1);
  return mix(values[low * 3 + channel], values[high * 3 + channel], position - low);
}

function sample3d(values: number[], size: number, position: RGB): RGB {
  const low = position.map(Math.floor) as RGB;
  const high = low.map((value) => Math.min(size - 1, value + 1)) as RGB;
  const fraction = position.map((value, index) => value - low[index]) as RGB;
  const sample = (r: number, g: number, b: number, channel: number) => values[((b * size * size + g * size + r) * 3) + channel];
  return [0, 1, 2].map((channel) => {
    const c00 = mix(sample(low[0], low[1], low[2], channel), sample(high[0], low[1], low[2], channel), fraction[0]);
    const c10 = mix(sample(low[0], high[1], low[2], channel), sample(high[0], high[1], low[2], channel), fraction[0]);
    const c01 = mix(sample(low[0], low[1], high[2], channel), sample(high[0], low[1], high[2], channel), fraction[0]);
    const c11 = mix(sample(low[0], high[1], high[2], channel), sample(high[0], high[1], high[2], channel), fraction[0]);
    return mix(mix(c00, c10, fraction[1]), mix(c01, c11, fraction[1]), fraction[2]);
  }) as RGB;
}

function applySelectiveColor(rgb: RGB, p: Parameters): RGB {
  const hsl = rgbToHsl(rgb); const hue = hsl[0] * 360; const saturation = hsl[1]; const lightness = hsl[2];
  const weights: Record<string, number> = {
    red: hueWeight(hue, 0) * saturation, yellow: hueWeight(hue, 60) * saturation,
    green: hueWeight(hue, 120) * saturation, cyan: hueWeight(hue, 180) * saturation,
    blue: hueWeight(hue, 240) * saturation, magenta: hueWeight(hue, 300) * saturation,
    white: smoothstep(.68, .94, lightness) * (1 - saturation * .5),
    black: (1 - smoothstep(.06, .32, lightness)) * (1 - saturation * .35),
    neutral: smoothstep(.12, .42, lightness) * (1 - smoothstep(.58, .88, lightness)) * (1 - saturation * .45),
  };
  const delta: RGB = [0, 0, 0];
  for (const [range, weight] of Object.entries(weights)) {
    const cyan = number(p[`${range}Cyan`], 0) / 100; const magenta = number(p[`${range}Magenta`], 0) / 100;
    const yellow = number(p[`${range}Yellow`], 0) / 100; const black = number(p[`${range}Black`], 0) / 100;
    delta[0] -= 255 * weight * (cyan + black) * .45;
    delta[1] -= 255 * weight * (magenta + black) * .45;
    delta[2] -= 255 * weight * (yellow + black) * .45;
  }
  return rgb.map((value, channel) => value + delta[channel]) as RGB;
}

function hueWeight(hue: number, center: number): number {
  const distance = Math.abs(((hue - center + 540) % 360) - 180);
  return 1 - smoothstep(20, 60, distance);
}

function numericTriplet(value: unknown, fallback: RGB): RGB {
  return Array.isArray(value) && value.length === 3 && value.every((item) => typeof item === "number" && Number.isFinite(item)) ? value as RGB : fallback;
}

function curvePoints(value: unknown): Array<{ x: number; y: number }> {
  if (!Array.isArray(value)) return [{ x: 0, y: 0 }, { x: 255, y: 255 }];
  const points = value.filter((point) => typeof point === "object" && point !== null && Number.isFinite((point as any).x) && Number.isFinite((point as any).y))
    .map((point) => ({ x: clamp((point as any).x), y: clamp((point as any).y) })).sort((a, b) => a.x - b.x);
  return points.length >= 2 ? points : [{ x: 0, y: 0 }, { x: 255, y: 255 }];
}
function curveValue(value: number, points: Array<{ x: number; y: number }>): number {
  const rightIndex = points.findIndex((point) => point.x >= value);
  if (rightIndex < 0) return points[points.length - 1].y;
  if (rightIndex === 0) return points[0].y;
  const left = points[rightIndex - 1]; const right = points[rightIndex];
  return mix(left.y, right.y, (value - left.x) / Math.max(1, right.x - left.x));
}
function rgbToHsl(rgb: RGB): [number, number, number] {
  const [r, g, b] = rgb.map((value) => value / 255); const max = Math.max(r, g, b); const min = Math.min(r, g, b);
  let h = 0; const l = (max + min) / 2; const delta = max - min;
  if (delta) { h = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4; h = (h / 6 + 1) % 1; }
  return [h, delta ? delta / (1 - Math.abs(2 * l - 1)) : 0, l];
}
function hslToRgb([h, s, l]: [number, number, number]): RGB {
  const c = (1 - Math.abs(2 * l - 1)) * s; const x = c * (1 - Math.abs((h * 6) % 2 - 1)); const m = l - c / 2;
  const sector = Math.floor(h * 6); const base: RGB = sector === 0 ? [c, x, 0] : sector === 1 ? [x, c, 0] : sector === 2 ? [0, c, x] : sector === 3 ? [0, x, c] : sector === 4 ? [x, 0, c] : [c, 0, x];
  return base.map((value) => (value + m) * 255) as RGB;
}
function hexRgb(value: string): RGB { const valid = /^#[0-9a-f]{6}$/i.test(value) ? value : "#000000"; return [1, 3, 5].map((index) => parseInt(valid.slice(index, index + 2), 16)) as RGB; }
function zeroes(): number[] { return Array.from({ length: 256 }, () => 0); }
function number(value: unknown, fallback: number): number { return typeof value === "number" && Number.isFinite(value) ? value : fallback; }
function clamp(value: number): number { return Math.max(0, Math.min(255, value)); }
function clamp01(value: number): number { return Math.max(0, Math.min(1, value)); }
function mix(start: number, end: number, amount: number): number { return start + (end - start) * amount; }

function smoothstep(low: number, high: number, value: number): number {
  const t = clamp01((value - low) / (high - low));
  return t * t * (3 - 2 * t);
}
