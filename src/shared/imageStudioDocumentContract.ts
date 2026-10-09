import {
  ADJUSTMENT_KINDS, BRUSH_PRESET_IDS, LAYER_BLEND_MODES,
  LUT_MAX_SERIALIZED_BYTES, LUT_MAX_SIZE_1D, LUT_MAX_SIZE_3D, LUT_NAME_MAX_LENGTH,
  MAX_CANVAS_EDGE, MAX_CANVAS_PIXELS, MAX_LAYERS,
} from "./imageStudioDomain";

export const IMAGE_STUDIO_DOCUMENT_VERSION = 14 as const;
export const MAX_SELECTION_MASK_RUNS = 100_000;

export type ImageStudioDocumentContractErrorCode = "invalid" | "future_version" | "embedded_binary";

export class ImageStudioDocumentContractError extends Error {
  constructor(public readonly code: ImageStudioDocumentContractErrorCode, message: string) {
    super(message);
  }
}

interface NormalizeOptions {
  allowDataUrls?: boolean;
  stripAssetUrls?: boolean;
}

/**
 * Parses and validates an Image Studio document, then rebuilds it field by
 * field from only the shapes declared below — the result never carries
 * through a caller-supplied property this contract doesn't know about
 * (Issue #164). Adjustment parameters are rebuilt from a per-kind key schema
 * as well, so UI-only or future fields cannot leak into persisted documents.
 */
export function normalizeImageStudioDocument(
  value: unknown,
  options: NormalizeOptions = {},
): Record<string, any> {
  if (!record(value)) invalid("Invalid Image Studio document");
  const source = structuredClone(value);
  const version = source.version;
  if (typeof version !== "number" || !Number.isInteger(version)) invalid("Unsupported Image Studio document version");
  if (version > IMAGE_STUDIO_DOCUMENT_VERSION) {
    throw new ImageStudioDocumentContractError("future_version", "Unsupported Image Studio document version");
  }
  if (version < 1) invalid("Unsupported Image Studio document version");
  migrateDocument(source);

  if (!record(source.canvas) || !positive(source.canvas.width) || !positive(source.canvas.height)) invalid("Invalid Image Studio canvas");
  if (!Array.isArray(source.layers) || !record(source.metadata) || !record(source.selection) || !validBrush(source.brushSettings)) invalid("Invalid Image Studio document");
  if (source.canvas.width > MAX_CANVAS_EDGE || source.canvas.height > MAX_CANVAS_EDGE || source.canvas.width * source.canvas.height > MAX_CANVAS_PIXELS
    || source.layers.length > MAX_LAYERS || typeof source.id !== "string" || typeof source.title !== "string" || source.title.length > 500
    || typeof source.metadata.createdAt !== "string" || typeof source.metadata.updatedAt !== "string"
    || (source.selection.layerId !== null && typeof source.selection.layerId !== "string")) invalid("Invalid Image Studio document limits");

  const layers = source.layers.map((layer: unknown) => buildLayer(layer, options));
  const layerIds = new Set<string>();
  for (const layer of layers) {
    if (layerIds.has(layer.id)) invalid("Duplicate Image Studio layer ID");
    layerIds.add(layer.id);
  }
  for (const layer of layers) {
    if (layer.parentId !== null && (typeof layer.parentId !== "string" || !layerIds.has(layer.parentId) || layer.parentId === layer.id)) {
      invalid("Invalid Image Studio layer parent");
    }
    const visited = new Set<string>([layer.id]);
    let parentId = layer.parentId;
    while (parentId !== null) {
      if (visited.has(parentId)) invalid("Cyclic Image Studio layer group");
      visited.add(parentId);
      const parent = layers.find((candidate: any) => candidate.id === parentId);
      if (!parent || parent.type !== "group") invalid("Invalid Image Studio layer group");
      parentId = parent.parentId;
    }
  }
  validateGeneralRasterMasks(layers);
  if (source.selection.layerId !== null && !layerIds.has(source.selection.layerId)) invalid("Invalid Image Studio selection");

  const extras: Record<string, any> = {};
  if(source.selectionArchives !== undefined) {
    if(!Array.isArray(source.selectionArchives) || source.selectionArchives.length>32) invalid("Invalid selection archives");
    const ids=new Set<string>();
    extras.selectionArchives=source.selectionArchives.map((archive:unknown)=>{
      if(!record(archive) || typeof archive.id!=="string" || !archive.id || archive.id.length>200 || ids.has(archive.id)
        || typeof archive.name!=="string" || archive.name.length>200 || !positive(archive.width) || !positive(archive.height)
        || !Number.isInteger(archive.width) || !Number.isInteger(archive.height) || archive.width>MAX_CANVAS_EDGE || archive.height>MAX_CANVAS_EDGE || archive.width*archive.height>16_777_216
        || !Array.isArray(archive.runs) || archive.runs.length<2 || archive.runs.length>MAX_SELECTION_MASK_RUNS
        || archive.runs.some((run:unknown,index:number)=>!Number.isInteger(run)||(index===0?(run as number)<0:(run as number)<=0))
        || archive.runs.reduce((sum:number,run:number)=>sum+run,0)!==archive.width*archive.height) invalid("Invalid selection archive");
      ids.add(archive.id);return {id:archive.id,name:archive.name,width:archive.width,height:archive.height,runs:[...archive.runs]};
    });
  }
  if(source.guides !== undefined) {
    if(!Array.isArray(source.guides) || source.guides.length>100) invalid("Invalid canvas guides");
    const ids=new Set<string>();
    extras.guides=source.guides.map((guide:unknown)=>{
      if(!record(guide)||typeof guide.id!=="string"||!guide.id||guide.id.length>200||ids.has(guide.id)
        || !["x","y"].includes(guide.axis)||!finite(guide.position)||Math.abs(guide.position)>1_000_000) invalid("Invalid canvas guide");
      ids.add(guide.id);return {id:guide.id,axis:guide.axis,position:guide.position};
    });
  }
  return {
    version: IMAGE_STUDIO_DOCUMENT_VERSION,
    id: source.id,
    title: source.title,
    canvas: { width: source.canvas.width, height: source.canvas.height },
    layers,
    brushSettings: buildBrushSettings(source.brushSettings),
    selection: { layerId: source.selection.layerId },
    metadata: { createdAt: source.metadata.createdAt, updatedAt: source.metadata.updatedAt },
    ...extras,
  };
}

function migrateDocument(document: Record<string, any>): void {
  if (!record(document.brushSettings)) {
    document.brushSettings = {
      version: 1, presetId: "hard-round", hardness: 1, spacing: .16, opacity: 1, flow: 1, seed: 1,
      dynamics: { pressureSize: true, pressureOpacity: false, pressureFlow: true, tiltAngle: true, speedTaper: false, smoothing: .35 },
    };
  }
  if (document.version === 1 || document.version === 2) {
    if (Array.isArray(document.layers)) {
      for (const layer of document.layers) {
        if (!record(layer)) continue;
        layer.blendMode = "normal";
        if ((layer.type === "paint" || layer.type === "mask") && Array.isArray(layer.strokes)) {
          for (const stroke of layer.strokes) {
            if (record(stroke) && stroke.color === undefined && layer.type === "paint") stroke.color = "#111827";
          }
        }
      }
    }
  }
  if (Array.isArray(document.layers)) {
    for (const layer of document.layers) {
      if (record(layer) && layer.parentId === undefined) layer.parentId = null;
    }
  }
  if (document.version <= 6) migrateAdjustmentMasksToPosition(document);
  document.version = IMAGE_STUDIO_DOCUMENT_VERSION;
}

/**
 * v6 → v7 (Issue #171): adjustment-layer masking stops being a stored `maskLayerId`
 * reference and becomes derived from position — an adjustment's mask is whichever mask
 * layers sit directly above it (same parent, no gap). This repositions each v6 mask to
 * sit directly above the adjustment layer that referenced it, preserving the old visual
 * result. A mask that was shared by several adjustments (no longer supported) is copied
 * once per extra adjustment rather than left ambiguously positioned.
 */
function migrateAdjustmentMasksToPosition(document: Record<string, any>): void {
  if (!Array.isArray(document.layers)) return;
  const layers: Record<string, any>[] = document.layers;
  const bindingsByMask = new Map<string, string[]>();
  for (const layer of layers) {
    if (!record(layer) || layer.type !== "adjustment" || typeof layer.maskLayerId !== "string") continue;
    const adjustmentIds = bindingsByMask.get(layer.maskLayerId) ?? [];
    adjustmentIds.push(layer.id);
    bindingsByMask.set(layer.maskLayerId, adjustmentIds);
  }
  for (const [maskId, adjustmentIds] of bindingsByMask) {
    const originalMask = layers.find((layer) => record(layer) && layer.id === maskId);
    if (!originalMask || originalMask.type !== "mask") continue;
    adjustmentIds.forEach((adjustmentId, copyIndex) => {
      const adjustment = layers.find((layer) => record(layer) && layer.id === adjustmentId);
      if (!adjustment) return;
      if (copyIndex === 0) {
        const existingIndex = layers.indexOf(originalMask);
        if (existingIndex >= 0) layers.splice(existingIndex, 1);
        originalMask.parentId = adjustment.parentId ?? null;
        layers.splice(layers.indexOf(adjustment) + 1, 0, originalMask);
      } else {
        const mask = { ...structuredClone(originalMask), id: `${maskId}-copy-${copyIndex}-${adjustmentId}`, parentId: adjustment.parentId ?? null };
        layers.splice(layers.indexOf(adjustment) + 1, 0, mask);
      }
    });
  }
  for (const layer of layers) {
    if (record(layer) && layer.type === "adjustment") delete layer.maskLayerId;
  }
}

function buildLayer(value: unknown, options: NormalizeOptions): Record<string, any> {
  if (!record(value)) invalid("Invalid Image Studio layer");
  if (typeof value.id !== "string" || value.id.length < 1 || value.id.length > 200 || typeof value.name !== "string" || value.name.length > 500
    || typeof value.visible !== "boolean" || typeof value.locked !== "boolean" || typeof value.opacity !== "number"
    || value.opacity < 0 || value.opacity > 1 || !LAYER_BLEND_MODES.includes(value.blendMode)
    || !positive(value.width) || !positive(value.height) || value.width > MAX_CANVAS_EDGE || value.height > MAX_CANVAS_EDGE || !validTransform(value.transform)) {
    invalid("Invalid Image Studio layer");
  }
  if (typeof value.tagColor !== "string" || !/^#[0-9a-f]{6}$/i.test(value.tagColor)) invalid("Invalid Image Studio layer tag color");
  const base: Record<string, any> = {
    id: value.id, name: value.name, tagColor: value.tagColor.toLowerCase(), visible: value.visible, locked: value.locked, opacity: value.opacity,
    blendMode: value.blendMode, width: value.width, height: value.height,
    transform: { x: value.transform.x, y: value.transform.y, scaleX: value.transform.scaleX, scaleY: value.transform.scaleY, rotation: value.transform.rotation },
    parentId: value.parentId ?? null,
  };
  if(value.vectorMask !== undefined) {
    if(!["raster","paint","annotation"].includes(value.type)||!record(value.vectorMask)||value.vectorMask.path?.kind!=="path"||value.vectorMask.path.closed!==true||(value.vectorMask.inverted!==undefined&&typeof value.vectorMask.inverted!=="boolean")) invalid("Invalid vector mask");
    base.vectorMask={path:buildAnnotationElement(value.vectorMask.path),...(value.vectorMask.inverted?{inverted:true}:{})};
  }
  if(value.filters !== undefined) {
    if(!["raster","paint","annotation"].includes(value.type)||!Array.isArray(value.filters)||value.filters.length>8) invalid("Invalid layer filters");
    const ids=new Set<string>();
    base.filters=value.filters.map((filter:unknown)=>{
      if(!record(filter)||typeof filter.id!=="string"||!filter.id||filter.id.length>200||ids.has(filter.id)||typeof filter.enabled!=="boolean"
        || !finite(filter.opacity)||filter.opacity<0||filter.opacity>1) invalid("Invalid layer filter");
      ids.add(filter.id);const result:Record<string,any>={id:filter.id,enabled:filter.enabled,opacity:filter.opacity,kind:filter.kind};
      if(filter.kind==="adjustment") {
        if(!record(filter.adjustment)||!ADJUSTMENT_KINDS.includes(filter.adjustment.kind)||!record(filter.adjustment.parameters))invalid("Invalid filter adjustment");
        const parameters=buildAdjustmentParameters(filter.adjustment.kind,filter.adjustment.parameters);
        if(!validAdjustmentParameters(filter.adjustment.kind,parameters))invalid("Invalid filter adjustment");
        result.adjustment={kind:filter.adjustment.kind,parameters};
      }else if(filter.kind==="blur") {if(!finite(filter.radius)||filter.radius<0||filter.radius>32)invalid("Invalid blur filter");result.radius=filter.radius;}
      else if(filter.kind==="sharpen") {if(!finite(filter.amount)||filter.amount<0||filter.amount>2)invalid("Invalid sharpen filter");result.amount=filter.amount;}
      else invalid("Unknown layer filter");
      if(filter.maskRuns!==undefined) {
        if(!Array.isArray(filter.maskRuns)||filter.maskRuns.length<2||filter.maskRuns.length>MAX_SELECTION_MASK_RUNS
          || filter.maskRuns.some((run:unknown,i:number)=>!Number.isInteger(run)||(i===0?(run as number)<0:(run as number)<=0))
          || filter.maskRuns.reduce((sum:number,run:number)=>sum+run,0)!==value.width*value.height)invalid("Invalid layer filter mask");
        result.maskRuns=[...filter.maskRuns];
      }
      return result;
    });
  }
  if (value.effects !== undefined) {
    if (!["raster", "paint", "annotation"].includes(value.type) || !record(value.effects)) invalid("Invalid Image Studio layer effects");
    const effects: Record<string, any> = {};
    for (const kind of ["shadow", "stroke"] as const) {
      const effect = value.effects[kind];
      if (effect === undefined) continue;
      if (!record(effect) || typeof effect.color !== "string" || !/^#[0-9a-f]{6}$/i.test(effect.color)
        || !finite(effect.opacity) || effect.opacity < 0 || effect.opacity > 1) invalid("Invalid Image Studio layer effect");
      if (kind === "shadow") {
        if (!finite(effect.blur) || effect.blur < 0 || effect.blur > 64 || !finite(effect.offsetX) || Math.abs(effect.offsetX) > 256
          || !finite(effect.offsetY) || Math.abs(effect.offsetY) > 256) invalid("Invalid Image Studio shadow");
        effects.shadow = {color:effect.color,opacity:effect.opacity,blur:effect.blur,offsetX:effect.offsetX,offsetY:effect.offsetY};
      } else {
        if (!finite(effect.width) || effect.width < 0 || effect.width > 16) invalid("Invalid Image Studio stroke");
        effects.stroke = {color:effect.color,opacity:effect.opacity,width:effect.width};
      }
    }
    if (Object.keys(value.effects).some(key => key !== "shadow" && key !== "stroke")) invalid("Unknown Image Studio layer effect");
    if (Object.keys(effects).length) base.effects = effects;
  }
  if (value.rasterMaskId === undefined && (value.rasterMaskInverted !== undefined || value.rasterMaskFeatherPx !== undefined)) {
    invalid("Invalid Image Studio orphan raster mask effect");
  }
  if (value.rasterMaskId !== undefined) {
    if (typeof value.rasterMaskId !== "string" || value.rasterMaskId.length < 1 || value.rasterMaskId.length > 200) {
      invalid("Invalid Image Studio raster mask reference");
    }
    base.rasterMaskId = value.rasterMaskId;
    if (value.rasterMaskInverted !== undefined && typeof value.rasterMaskInverted !== "boolean") invalid("Invalid Image Studio raster mask inversion");
    if (value.rasterMaskInverted === true) base.rasterMaskInverted = true;
    if (value.rasterMaskFeatherPx !== undefined && (!finite(value.rasterMaskFeatherPx) || value.rasterMaskFeatherPx < 0 || value.rasterMaskFeatherPx > 256)) invalid("Invalid Image Studio raster mask feather");
    if (value.rasterMaskFeatherPx !== undefined && value.rasterMaskFeatherPx > 0) base.rasterMaskFeatherPx = value.rasterMaskFeatherPx;
  }
  if (value.type !== "mask" && (value.adjustmentMaskInverted !== undefined || value.adjustmentMaskFeatherPx !== undefined)) {
    invalid("Invalid Image Studio adjustment mask effect owner");
  }

  const clip = buildOwnedMaskClip(value);
  if (value.type === "raster") return { ...base, type: "raster", source: buildRasterSource(value.source, options) };
  if (value.type === "annotation") return { ...base, type: "annotation", elements: buildAnnotationElements(value.elements) };
  if (value.type === "group") {
    if (typeof value.collapsed !== "boolean") invalid("Invalid Image Studio layer group");
    return { ...base, type: "group", collapsed: value.collapsed };
  }
  if (value.type === "adjustment") {
    if (!record(value.adjustment) || !ADJUSTMENT_KINDS.includes(value.adjustment.kind) || !record(value.adjustment.parameters)) {
      invalid("Invalid Image Studio adjustment layer");
    }
    const parameters = buildAdjustmentParameters(value.adjustment.kind, value.adjustment.parameters);
    if (!validAdjustmentParameters(value.adjustment.kind, parameters)) invalid("Invalid Image Studio adjustment layer");
    return { ...base, type: "adjustment", adjustment: { kind: value.adjustment.kind, parameters } };
  }
  if ((value.type !== "paint" && value.type !== "mask") || !Array.isArray(value.strokes) || value.strokes.length > 10_000) {
    invalid("Invalid Image Studio drawing layer");
  }
  if (value.selectionRuns !== undefined) {
    if (value.type !== "mask" || !Array.isArray(value.selectionRuns) || value.selectionRuns.length < 2
      || value.selectionRuns.length > MAX_SELECTION_MASK_RUNS || value.selectionRuns.some((run: unknown, index: number) =>
        !Number.isInteger(run) || (index === 0 ? (run as number) < 0 : (run as number) <= 0))) {
      invalid("Invalid Image Studio selection mask");
    }
    let total = 0;
    for (const run of value.selectionRuns) total += run;
    if (total !== value.width * value.height) invalid("Invalid Image Studio selection mask dimensions");
    return { ...base, ...buildAdjustmentMaskEffects(value), ...clip, type: value.type, strokes: buildStrokes(value.strokes), selectionRuns: [...value.selectionRuns] };
  }
  return { ...base, ...buildAdjustmentMaskEffects(value), ...clip, type: value.type, strokes: buildStrokes(value.strokes) };
}

function buildAdjustmentMaskEffects(value: Record<string, any>): Record<string, any> {
  if (value.adjustmentMaskInverted === undefined && value.adjustmentMaskFeatherPx === undefined) return {};
  if (value.type !== "mask" || (value.adjustmentMaskInverted !== undefined && typeof value.adjustmentMaskInverted !== "boolean")
    || (value.adjustmentMaskFeatherPx !== undefined && (!finite(value.adjustmentMaskFeatherPx)
      || value.adjustmentMaskFeatherPx < 0 || value.adjustmentMaskFeatherPx > 256))) {
    invalid("Invalid Image Studio adjustment mask effect");
  }
  return {
    ...(value.adjustmentMaskInverted === true ? { adjustmentMaskInverted: true } : {}),
    ...(value.adjustmentMaskFeatherPx > 0 ? { adjustmentMaskFeatherPx: value.adjustmentMaskFeatherPx } : {}),
  };
}

function buildOwnedMaskClip(value: Record<string, any>): Record<string, any> {
  if (value.clipRuns === undefined && value.clipInverted === undefined) return {};
  if (value.type !== "mask" || !Array.isArray(value.clipRuns) || value.clipRuns.length < 2
    || value.clipRuns.length > MAX_SELECTION_MASK_RUNS || (value.clipInverted !== undefined && typeof value.clipInverted !== "boolean")
    || value.clipRuns.some((run: unknown, index: number) =>
      !Number.isInteger(run) || (index === 0 ? (run as number) < 0 : (run as number) <= 0))) {
    invalid("Invalid Image Studio owned mask clip");
  }
  if (value.clipRuns.reduce((total: number, run: number) => total + run, 0) !== value.width * value.height) {
    invalid("Invalid Image Studio owned mask clip dimensions");
  }
  return { clipRuns: [...value.clipRuns], ...(value.clipInverted === true ? { clipInverted: true } : {}) };
}

/**
 * v8 introduces one explicit raster-mask owner. It deliberately does not reuse
 * Adjustment's v7 position-derived masks: a mask is either the immediately-above
 * adjustment mask, or a same-group, same-size raster mask owned by exactly one
 * ordinary layer/group. Keeping the two models disjoint prevents a reorder from
 * silently changing which layer a general mask affects.
 */
function validateGeneralRasterMasks(layers: Record<string, any>[]): void {
  const claimedByAdjustment = new Set<string>();
  for (const adjustment of layers.filter((layer) => layer.type === "adjustment")) {
    const siblings = layers.filter((candidate) => candidate.parentId === adjustment.parentId);
    const index = siblings.indexOf(adjustment);
    for (let cursor = index + 1; cursor < siblings.length && siblings[cursor].type === "mask"; cursor += 1) {
      claimedByAdjustment.add(siblings[cursor].id);
    }
  }
  const owners = new Set<string>();
  for (const layer of layers) {
    if ((layer.adjustmentMaskInverted === true || layer.adjustmentMaskFeatherPx > 0)
      && !claimedByAdjustment.has(layer.id)) invalid("Invalid Image Studio adjustment mask effect owner");
    if (layer.rasterMaskId === undefined) continue;
    if (!["raster", "paint", "annotation", "group"].includes(layer.type)) invalid("Invalid Image Studio raster mask owner");
    const mask = layers.find((candidate) => candidate.id === layer.rasterMaskId);
    if (!mask || mask.type !== "mask" || mask.parentId !== layer.parentId
      || mask.width !== layer.width || mask.height !== layer.height || claimedByAdjustment.has(mask.id) || owners.has(mask.id)) {
      invalid("Invalid Image Studio raster mask reference");
    }
    owners.add(mask.id);
  }
  for (const mask of layers) {
    if (mask.clipRuns !== undefined && !owners.has(mask.id)) invalid("Invalid Image Studio owned mask clip owner");
  }
}

function buildStrokes(value: unknown[]): Record<string, any>[] {
  let points = 0;
  return value.map((stroke) => {
    if (!record(stroke) || !Array.isArray(stroke.points)) invalid("Invalid Image Studio stroke");
    points += stroke.points.length;
    if (typeof stroke.id !== "string" || points > 1_000_000 || !positive(stroke.size)
      || !["paint", "erase"].includes(stroke.mode) || !Number.isInteger(stroke.value) || stroke.value < 0 || stroke.value > 255
      || (stroke.color !== undefined && !validColor(stroke.color))
      || (stroke.samples !== undefined && !validStrokeSamples(stroke.samples))
      || (stroke.brush !== undefined && !validBrush(stroke.brush))
      || ((stroke.samples === undefined) !== (stroke.brush === undefined))
      || stroke.points.some((point: unknown) => !record(point) || !finite(point.x) || !finite(point.y))) invalid("Invalid Image Studio stroke");
    const built: Record<string, any> = {
      id: stroke.id, points: stroke.points.map((point: Record<string, any>) => ({ x: point.x, y: point.y })),
      size: stroke.size, mode: stroke.mode, value: stroke.value,
    };
    if (stroke.color !== undefined) built.color = stroke.color;
    if (stroke.samples !== undefined) {
      built.samples = (stroke.samples as Record<string, any>[]).map((sample) => (
        { x: sample.x, y: sample.y, time: sample.time, pressure: sample.pressure, tiltX: sample.tiltX, tiltY: sample.tiltY, twist: sample.twist }
      ));
      built.brush = buildBrushSettings(stroke.brush);
    }
    return built;
  });
}

function validStrokeSamples(value: unknown): boolean {
  return Array.isArray(value) && value.length <= 100_000 && value.every((sample) => record(sample)
    && finite(sample.x) && finite(sample.y) && finite(sample.time) && finite(sample.pressure) && sample.pressure >= 0 && sample.pressure <= 1
    && finite(sample.tiltX) && sample.tiltX >= -90 && sample.tiltX <= 90 && finite(sample.tiltY) && sample.tiltY >= -90 && sample.tiltY <= 90
    && finite(sample.twist) && sample.twist >= 0 && sample.twist <= 359);
}

function validBrush(value: unknown): boolean {
  if (!record(value) || value.version !== 1 || !BRUSH_PRESET_IDS.includes(value.presetId)
    || !finite(value.hardness) || value.hardness < 0 || value.hardness > 1 || !finite(value.spacing) || value.spacing < .02 || value.spacing > 2
    || !finite(value.opacity) || value.opacity < 0 || value.opacity > 1 || !finite(value.flow) || value.flow < 0 || value.flow > 1
    || !Number.isInteger(value.seed) || !record(value.dynamics)) return false;
  const dynamics = value.dynamics;
  return ["pressureSize", "pressureOpacity", "pressureFlow", "tiltAngle", "speedTaper"].every((key) => typeof dynamics[key] === "boolean")
    && finite(dynamics.smoothing) && dynamics.smoothing >= 0 && dynamics.smoothing <= .95;
}

function buildBrushSettings(value: Record<string, any>): Record<string, any> {
  return {
    version: 1, presetId: value.presetId, hardness: value.hardness, spacing: value.spacing,
    opacity: value.opacity, flow: value.flow, seed: value.seed,
    dynamics: {
      pressureSize: value.dynamics.pressureSize, pressureOpacity: value.dynamics.pressureOpacity,
      pressureFlow: value.dynamics.pressureFlow, tiltAngle: value.dynamics.tiltAngle,
      speedTaper: value.dynamics.speedTaper, smoothing: value.dynamics.smoothing,
    },
  };
}

const SELECTIVE_COLOR_PARAMETER_KEYS = ["red", "yellow", "green", "cyan", "blue", "magenta", "white", "neutral", "black"]
  .flatMap((range) => ["Cyan", "Magenta", "Yellow", "Black"].map((axis) => `${range}${axis}`));
const ADJUSTMENT_PARAMETER_KEYS: Record<string, readonly string[]> = {
  exposure: ["exposure", "offset", "gamma"],
  levels: ["channel", "inputBlack", "inputWhite", "gamma", "outputBlack", "outputWhite"],
  curves: ["channel", "points"],
  vibrance: ["amount"],
  "hue-saturation": ["hue", "saturation", "lightness"],
  "temperature-tint": ["temperature", "tint"],
  "color-balance": [
    "shadowsCyanRed", "shadowsMagentaGreen", "shadowsYellowBlue",
    "midtonesCyanRed", "midtonesMagentaGreen", "midtonesYellowBlue",
    "highlightsCyanRed", "highlightsMagentaGreen", "highlightsYellowBlue",
  ],
  "black-white": ["red", "yellow", "green", "cyan", "blue", "magenta", "tint", "tintColor"],
  "gradient-map": ["shadow", "highlight", "reverse"],
  invert: [],
  lut: ["name", "dimension", "size", "domainMin", "domainMax", "values", "strength"],
  "selective-color": SELECTIVE_COLOR_PARAMETER_KEYS,
  clarity: ["amount", "radius"],
  dehaze: ["amount", "radius", "toneProtection"],
  "shadows-highlights": ["shadows", "highlights", "radius"],
};

function buildAdjustmentParameters(kind: string, value: Record<string, any>): Record<string, any> {
  return Object.fromEntries(ADJUSTMENT_PARAMETER_KEYS[kind].filter((key) => value[key] !== undefined).map((key) => [key, value[key]]));
}

function validAdjustmentParameters(kind: string, value: Record<string, any>): boolean {
  const serialized = JSON.stringify(value);
  if (kind === "lut") return serialized.length <= LUT_MAX_SERIALIZED_BYTES && validLutParameters(value);
  return serialized.length <= 20_000 && Object.values(value).every((item) => {
    if (typeof item === "number") return Number.isFinite(item) && Math.abs(item) <= 100_000;
    if (typeof item === "string") return item.length <= 100;
    if (typeof item === "boolean") return true;
    if (Array.isArray(item)) return item.length <= 256 && item.every((entry) => typeof entry === "number"
      ? Number.isFinite(entry) : record(entry) && finite(entry.x) && finite(entry.y));
    return false;
  });
}

function validLutParameters(value: Record<string, any>): boolean {
  if (typeof value.name !== "string" || value.name.length > LUT_NAME_MAX_LENGTH || !["1d", "3d"].includes(value.dimension)
    || !Number.isInteger(value.size) || value.size < 2 || value.size > (value.dimension === "1d" ? LUT_MAX_SIZE_1D : LUT_MAX_SIZE_3D)
    || !finite(value.strength) || value.strength < 0 || value.strength > 100) return false;
  const count = (value.dimension === "1d" ? value.size : value.size ** 3) * 3;
  return validFiniteArray(value.domainMin, 3, 10_000) && validFiniteArray(value.domainMax, 3, 10_000)
    && value.domainMin.every((item: number, index: number) => item < value.domainMax[index])
    && validFiniteArray(value.values, count, 16);
}

function validFiniteArray(value: unknown, length: number, limit: number): value is number[] {
  return Array.isArray(value) && value.length === length && value.every((item) => finite(item) && Math.abs(item) <= limit);
}

function buildRasterSource(value: unknown, options: NormalizeOptions): Record<string, any> {
  if (!record(value) || !["image/png", "image/jpeg", "image/webp"].includes(value.mimeType)) invalid("Invalid Image Studio raster source");
  if (value.kind === "data-url") {
    if (!options.allowDataUrls) throw new ImageStudioDocumentContractError("embedded_binary", "raster data URLs must be uploaded as assets before saving");
    if (typeof value.value !== "string" || !value.value.startsWith(`data:${value.mimeType};base64,`)) invalid("Invalid Image Studio raster source");
    return { kind: "data-url", value: value.value, mimeType: value.mimeType };
  }
  if (value.kind !== "asset" || typeof value.assetId !== "string" || value.assetId.length < 1 || value.assetId.length > 200
    || (value.url !== undefined && (typeof value.url !== "string" || !/^https?:\/\//.test(value.url)))) invalid("Invalid Image Studio raster source");
  const source: Record<string, any> = { kind: "asset", assetId: value.assetId, mimeType: value.mimeType };
  if (!options.stripAssetUrls && value.url !== undefined) source.url = value.url;
  return source;
}

function buildAnnotationElements(value: unknown): Record<string, any>[] {
  if (!Array.isArray(value) || value.length > 500) invalid("Invalid Image Studio annotation elements");
  return value.map((element) => buildAnnotationElement(element));
}

function buildAnnotationElement(value: unknown): Record<string, any> {
  if (!record(value) || typeof value.id !== "string" || value.id.length < 1 || value.id.length > 200) invalid("Invalid Image Studio annotation element");
  const id = value.id;
  if(value.kind === "path") {
    const point=(p:any)=>record(p)&&finite(p.x)&&finite(p.y)&&Math.abs(p.x)<=1_000_000&&Math.abs(p.y)<=1_000_000;
    if(!Array.isArray(value.nodes)||value.nodes.length<2||value.nodes.length>1000||typeof value.closed!=="boolean"||!validFill(value.fill)||!validStroke(value)||value.nodes.some((n:any)=>!point(n)||(n.in!==undefined&&!point(n.in))||(n.out!==undefined&&!point(n.out)))) invalid("Invalid vector path");
    return {id,kind:"path",closed:value.closed,fill:value.fill,stroke:value.stroke,strokeWidth:value.strokeWidth,nodes:value.nodes.map((n:any)=>({x:n.x,y:n.y,...(n.in?{in:{x:n.in.x,y:n.in.y}}:{}),...(n.out?{out:{x:n.out.x,y:n.out.y}}:{})}))};
  }
  if (value.kind === "text") {
    if (!finite(value.x) || !finite(value.y) || !positive(value.width) || !finite(value.rotation)
      || typeof value.text !== "string" || value.text.length > 5000 || typeof value.fontFamily !== "string"
      || value.fontFamily.length < 1 || value.fontFamily.length > 100 || !positive(value.fontSize) || value.fontSize > 400
      || !validColor(value.fill) || !["left", "center", "right"].includes(value.align)) invalid("Invalid Image Studio annotation text element");
    const typography: Record<string, any> = {};
    for (const [key,min,max] of [["fontWeight",100,900],["letterSpacing",-10,100],["lineHeight",.5,5]] as const) {
      if(value[key] !== undefined) {
        if(!finite(value[key]) || value[key]<min || value[key]>max) invalid("Invalid Image Studio typography");
        typography[key]=value[key];
      }
    }
    if(value.italic !== undefined) {if(typeof value.italic !== "boolean") invalid("Invalid Image Studio typography");typography.italic=value.italic;}
    return { id, kind: "text", x: value.x, y: value.y, width: value.width, rotation: value.rotation, text: value.text, fontFamily: value.fontFamily, fontSize: value.fontSize, fill: value.fill, align: value.align, ...typography };
  }
  if (value.kind === "rect") {
    if (!positionedShape(value) || !positive(value.width) || !positive(value.height) || !validFill(value.fill)
      || !validStroke(value) || !finite(value.cornerRadius) || value.cornerRadius < 0) invalid("Invalid Image Studio annotation rect element");
    return { id, kind: "rect", x: value.x, y: value.y, width: value.width, height: value.height, rotation: value.rotation, fill: value.fill, stroke: value.stroke, strokeWidth: value.strokeWidth, cornerRadius: value.cornerRadius };
  }
  if (value.kind === "ellipse") {
    if (!positionedShape(value) || !positive(value.radiusX) || !positive(value.radiusY) || !validFill(value.fill) || !validStroke(value)) invalid("Invalid Image Studio annotation ellipse element");
    return { id, kind: "ellipse", x: value.x, y: value.y, radiusX: value.radiusX, radiusY: value.radiusY, rotation: value.rotation, fill: value.fill, stroke: value.stroke, strokeWidth: value.strokeWidth };
  }
  if (value.kind === "polygon") {
    if (!positionedShape(value) || !Number.isInteger(value.sides) || value.sides < 3 || value.sides > 12
      || !positive(value.radius) || !validFill(value.fill) || !validStroke(value)) invalid("Invalid Image Studio annotation polygon element");
    return { id, kind: "polygon", x: value.x, y: value.y, sides: value.sides, radius: value.radius, rotation: value.rotation, fill: value.fill, stroke: value.stroke, strokeWidth: value.strokeWidth };
  }
  if (value.kind === "freehand" || value.kind === "line" || value.kind === "arrow") {
    if (!Array.isArray(value.points) || value.points.length < 2 || value.points.length > 5000
      || value.points.some((point: unknown) => !record(point) || !finite(point.x) || !finite(point.y)) || !validStroke(value)) {
      invalid(`Invalid Image Studio annotation ${value.kind} element`);
    }
    return { id, kind: value.kind, points: value.points.map((point: Record<string, any>) => ({ x: point.x, y: point.y })), stroke: value.stroke, strokeWidth: value.strokeWidth };
  }
  invalid("Invalid Image Studio annotation element kind");
}

function positionedShape(value: Record<string, any>): boolean {
  return finite(value.x) && finite(value.y) && finite(value.rotation);
}

function validStroke(value: Record<string, any>): boolean {
  return validColor(value.stroke) && finite(value.strokeWidth) && value.strokeWidth >= 0;
}

function validFill(value: unknown): boolean { return value === "transparent" || validColor(value); }
function validColor(value: unknown): boolean { return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value); }
function validTransform(value: unknown): boolean {
  return record(value) && finite(value.x) && finite(value.y) && finite(value.scaleX) && finite(value.scaleY) && finite(value.rotation);
}
function positive(value: unknown): value is number { return finite(value) && value > 0; }
function finite(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value); }
function record(value: unknown): value is Record<string, any> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function invalid(message: string): never { throw new ImageStudioDocumentContractError("invalid", message); }
