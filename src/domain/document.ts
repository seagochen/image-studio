import type { Point, Transform2D } from "../../../shared/canvas";
import { createBrushSettings, type BrushSettings, type StrokeSample } from "./brushEngine";
import {
  IMAGE_STUDIO_DOCUMENT_VERSION,
  MAX_SELECTION_MASK_RUNS,
  normalizeImageStudioDocument,
} from "../../../../frontend/src/shared/imageStudioDocumentContract";
import {
  ADJUSTMENT_KINDS, ANNOTATION_ELEMENT_KINDS, LAYER_BLEND_MODES,
  type AdjustmentKind, type AnnotationElementKind, type LayerBlendMode,
} from "../../../../frontend/src/shared/imageStudioDomain";

export { IMAGE_STUDIO_DOCUMENT_VERSION, MAX_SELECTION_MASK_RUNS, ADJUSTMENT_KINDS, ANNOTATION_ELEMENT_KINDS, LAYER_BLEND_MODES };
export type { AdjustmentKind, AnnotationElementKind, LayerBlendMode };

export type { Point } from "../../../shared/canvas";

export interface LayerTransform extends Transform2D {}

interface LayerBase {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  blendMode: LayerBlendMode;
  transform: LayerTransform;
  parentId?: string | null;
  /** v9 general raster mask; adjustment masks remain position-derived in v7. */
  rasterMaskId?: string;
  rasterMaskInverted?: boolean;
  rasterMaskFeatherPx?: number;
}

export interface RasterLayer extends LayerBase {
  type: "raster";
  width: number;
  height: number;
  source: RasterSource;
}

export type RasterSource =
  | { kind: "data-url"; value: string; mimeType: string }
  | { kind: "asset"; assetId: string; url?: string; mimeType: string };

export interface Stroke {
  id: string;
  points: Point[];
  size: number;
  mode: "paint" | "erase";
  value: number;
  color?: string;
  samples?: StrokeSample[];
  brush?: BrushSettings;
}

export interface DrawingLayer extends LayerBase {
  type: "paint" | "mask";
  width: number;
  height: number;
  strokes: Stroke[];
  /** v10 compact row-major binary base for a selection-derived local mask. */
  selectionRuns?: number[];
  /** v11 effects for a position-derived adjustment mask, independent of an owned raster mask. */
  adjustmentMaskInverted?: boolean;
  adjustmentMaskFeatherPx?: number;
}

export interface AnnotationTextElement {
  id: string;
  kind: "text";
  x: number;
  y: number;
  width: number;
  rotation: number;
  text: string;
  fontFamily: string;
  fontSize: number;
  fill: string;
  align: "left" | "center" | "right";
}

export interface AnnotationRectElement {
  id: string;
  kind: "rect";
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  fill: string;
  stroke: string;
  strokeWidth: number;
  cornerRadius: number;
}

export interface AnnotationEllipseElement {
  id: string;
  kind: "ellipse";
  x: number;
  y: number;
  radiusX: number;
  radiusY: number;
  rotation: number;
  fill: string;
  stroke: string;
  strokeWidth: number;
}

export interface AnnotationPolygonElement {
  id: string;
  kind: "polygon";
  x: number;
  y: number;
  sides: number;
  radius: number;
  rotation: number;
  fill: string;
  stroke: string;
  strokeWidth: number;
}

export interface AnnotationFreehandElement {
  id: string;
  kind: "freehand";
  points: Point[];
  stroke: string;
  strokeWidth: number;
}

export interface AnnotationLineElement {
  id: string;
  kind: "line";
  points: [Point, Point];
  stroke: string;
  strokeWidth: number;
}

export interface AnnotationArrowElement {
  id: string;
  kind: "arrow";
  points: [Point, Point];
  stroke: string;
  strokeWidth: number;
}

export type AnnotationElement =
  | AnnotationTextElement
  | AnnotationRectElement
  | AnnotationEllipseElement
  | AnnotationPolygonElement
  | AnnotationFreehandElement
  | AnnotationLineElement
  | AnnotationArrowElement;

export interface AnnotationLayer extends LayerBase {
  type: "annotation";
  width: number;
  height: number;
  elements: AnnotationElement[];
}

export interface GroupLayer extends LayerBase {
  type: "group";
  width: number;
  height: number;
  collapsed: boolean;
}

export interface AdjustmentDefinition {
  kind: AdjustmentKind;
  parameters: Record<string, number | string | boolean | number[] | Array<{ x: number; y: number }>>;
}

export interface AdjustmentLayer extends LayerBase {
  type: "adjustment";
  width: number;
  height: number;
  adjustment: AdjustmentDefinition;
}

export type ImageStudioLayer = RasterLayer | DrawingLayer | AnnotationLayer | GroupLayer | AdjustmentLayer;

export interface ImageStudioDocument {
  version: typeof IMAGE_STUDIO_DOCUMENT_VERSION;
  id: string;
  title: string;
  canvas: { width: number; height: number };
  layers: ImageStudioLayer[];
  brushSettings: BrushSettings;
  selection: { layerId: string | null };
  metadata: { createdAt: string; updatedAt: string };
}

export function createId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function createEmptyDocument(now = new Date().toISOString()): ImageStudioDocument {
  return {
    version: IMAGE_STUDIO_DOCUMENT_VERSION,
    id: createId("document"),
    title: "Untitled",
    canvas: { width: 1600, height: 900 },
    layers: [],
    brushSettings: createBrushSettings("hard-round", 1),
    selection: { layerId: null },
    metadata: { createdAt: now, updatedAt: now },
  };
}

export function cloneDocument(document: ImageStudioDocument): ImageStudioDocument {
  return JSON.parse(JSON.stringify(document)) as ImageStudioDocument;
}

export function serializeDocument(document: ImageStudioDocument): string {
  return JSON.stringify(document);
}

export function parseDocument(value: string): ImageStudioDocument {
  return normalizeImageStudioDocument(JSON.parse(value), { allowDataUrls: true }) as ImageStudioDocument;
}

export function rasterSourceUrl(source: RasterSource): string {
  return source.kind === "data-url" ? source.value : source.url ?? "";
}

export function touchDocument(document: ImageStudioDocument): ImageStudioDocument {
  return { ...document, metadata: { ...document.metadata, updatedAt: new Date().toISOString() } };
}

export function defaultTransform(): LayerTransform {
  return { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 };
}

export function canvasBlendMode(mode: LayerBlendMode): GlobalCompositeOperation {
  return mode === "normal" ? "source-over" : mode;
}
