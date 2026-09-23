export type QuarterTurn = 0 | 90 | 180 | 270;

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RasterAdjustments {
  crop: CropRect;
  rotation: QuarterTurn;
  flipX: boolean;
  flipY: boolean;
  resizeWidth: number;
  resizeHeight: number;
  brightness: number;
  contrast: number;
  saturation: number;
  hue: number;
  temperature: number;
  red: number;
  green: number;
  blue: number;
  grayscale: number;
  sepia: number;
}

export type RasterFilterPreset = "original" | "vivid" | "mono" | "sepia" | "warm" | "cool" | "vintage" | "dramatic" | "fade";

const COLOR_DEFAULTS = {
  brightness: 100, contrast: 100, saturation: 100, hue: 0,
  temperature: 0, red: 100, green: 100, blue: 100, grayscale: 0, sepia: 0,
};

const PRESETS: Record<RasterFilterPreset, Partial<typeof COLOR_DEFAULTS>> = {
  original: {},
  vivid: { brightness: 104, contrast: 112, saturation: 138 },
  mono: { contrast: 108, saturation: 0, grayscale: 100 },
  sepia: { contrast: 104, saturation: 82, sepia: 82 },
  warm: { brightness: 103, saturation: 112, temperature: 28 },
  cool: { contrast: 104, saturation: 106, temperature: -25 },
  vintage: { brightness: 106, contrast: 88, saturation: 72, sepia: 34, temperature: 18 },
  dramatic: { brightness: 96, contrast: 142, saturation: 88 },
  fade: { brightness: 108, contrast: 78, saturation: 82, sepia: 10 },
};

export function createRasterAdjustments(width: number, height: number): RasterAdjustments {
  return {
    crop: { x: 0, y: 0, width, height }, rotation: 0, flipX: false, flipY: false,
    resizeWidth: width, resizeHeight: height, ...COLOR_DEFAULTS,
  };
}

export function clampCrop(crop: CropRect, sourceWidth: number, sourceHeight: number): CropRect {
  const x = clamp(Math.round(crop.x), 0, Math.max(0, sourceWidth - 1));
  const y = clamp(Math.round(crop.y), 0, Math.max(0, sourceHeight - 1));
  return {
    x, y,
    width: clamp(Math.round(crop.width), 1, sourceWidth - x),
    height: clamp(Math.round(crop.height), 1, sourceHeight - y),
  };
}

export function outputDimensions(state: RasterAdjustments): { width: number; height: number } {
  const width = Math.max(1, Math.round(state.resizeWidth));
  const height = Math.max(1, Math.round(state.resizeHeight));
  return state.rotation === 90 || state.rotation === 270 ? { width: height, height: width } : { width, height };
}

export function hasGeometryChanges(state: RasterAdjustments, sourceWidth: number, sourceHeight: number): boolean {
  return state.rotation !== 0
    || state.crop.x !== 0
    || state.crop.y !== 0
    || state.crop.width !== sourceWidth
    || state.crop.height !== sourceHeight
    || state.resizeWidth !== sourceWidth
    || state.resizeHeight !== sourceHeight;
}

export function canvasFilter(state: RasterAdjustments): string {
  return [
    `brightness(${state.brightness}%)`, `contrast(${state.contrast}%)`,
    `saturate(${state.saturation}%)`, `hue-rotate(${state.hue}deg)`,
    `grayscale(${state.grayscale}%)`, `sepia(${state.sepia}%)`,
  ].join(" ");
}

export function applyFilterPreset(state: RasterAdjustments, preset: RasterFilterPreset): RasterAdjustments {
  return { ...state, ...COLOR_DEFAULTS, ...PRESETS[preset] };
}

export function resizeForCrop(state: RasterAdjustments, crop: CropRect): RasterAdjustments {
  const scaleX = state.resizeWidth / state.crop.width;
  const scaleY = state.resizeHeight / state.crop.height;
  return {
    ...state,
    crop,
    resizeWidth: Math.max(1, Math.round(crop.width * scaleX)),
    resizeHeight: Math.max(1, Math.round(crop.height * scaleY)),
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, Number.isFinite(value) ? value : minimum));
}
