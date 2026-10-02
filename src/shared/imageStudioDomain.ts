import { MAX_IMAGE_EDGE, MAX_IMAGE_PIXELS } from "./imageResourceLimits";

/**
 * Single authoritative source for Image Studio domain enums and resource
 * limits shared by the browser app (webapps/image-studio) and the BFF-side
 * document contract (imageStudioDocumentContract.ts). Both layers import
 * from here instead of hand-copying the same literals (Issue #164).
 */

export const LAYER_BLEND_MODES = ["normal", "multiply", "screen", "overlay", "darken", "lighten"] as const;
export type LayerBlendMode = typeof LAYER_BLEND_MODES[number];

export const ADJUSTMENT_KINDS = [
  "exposure", "levels", "curves", "vibrance", "hue-saturation", "temperature-tint",
  "color-balance", "black-white", "gradient-map", "invert", "lut", "selective-color",
  "clarity", "dehaze", "shadows-highlights",
] as const;
export type AdjustmentKind = typeof ADJUSTMENT_KINDS[number];

export const ANNOTATION_ELEMENT_KINDS = ["text", "rect", "ellipse", "polygon", "freehand", "line", "arrow"] as const;
export type AnnotationElementKind = typeof ANNOTATION_ELEMENT_KINDS[number];

export const BRUSH_PRESET_IDS = ["hard-round", "soft-round", "pencil", "marker", "texture", "scatter"] as const;
export type BrushPresetId = typeof BRUSH_PRESET_IDS[number];

/** Image Studio aliases for the shared browser-editor raster limits. */
export const MAX_CANVAS_EDGE = MAX_IMAGE_EDGE;
export const MAX_CANVAS_PIXELS = MAX_IMAGE_PIXELS;
export const MAX_LAYERS = 500;

export const LUT_NAME_MAX_LENGTH = 160;
export const LUT_MAX_SIZE_1D = 256;
export const LUT_MAX_SIZE_3D = 33;
/** Cap on `JSON.stringify(adjustment.parameters).length` for `kind: "lut"`, distinct from cubeLut.ts's raw .cube file byte limit (different measurement point, same order of magnitude by design). */
export const LUT_MAX_SERIALIZED_BYTES = 2_000_000;
