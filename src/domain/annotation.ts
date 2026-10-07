import { createId, type AnnotationElement, type Point } from "./document";

export const ANNOTATION_DEFAULT_FILL = "#5f6fed";
export const ANNOTATION_DEFAULT_STROKE = "#5f6fed";
export const ANNOTATION_DEFAULT_STROKE_WIDTH = 3;
export const ANNOTATION_DEFAULT_FONT_FAMILY = "Arial";
export const ANNOTATION_DEFAULT_FONT_SIZE = 32;
export const ANNOTATION_DEFAULT_TEXT_COLOR = "#172033";
export const ANNOTATION_MIN_SHAPE_SIZE = 4;

function normalizeRect(a: Point, b: Point): { x: number; y: number; width: number; height: number } {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
}

function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function createTextElement(point: Point): AnnotationElement {
  return {
    id: createId("annot-text"), kind: "text", x: point.x, y: point.y, width: 240, rotation: 0,
    text: "", fontFamily: ANNOTATION_DEFAULT_FONT_FAMILY, fontSize: ANNOTATION_DEFAULT_FONT_SIZE,
    fill: ANNOTATION_DEFAULT_TEXT_COLOR, align: "left",
  };
}

export function createRectElement(a: Point, b: Point): AnnotationElement | null {
  const rect = normalizeRect(a, b);
  if (rect.width < ANNOTATION_MIN_SHAPE_SIZE || rect.height < ANNOTATION_MIN_SHAPE_SIZE) return null;
  return {
    id: createId("annot-rect"), kind: "rect", ...rect, rotation: 0,
    fill: "transparent", stroke: ANNOTATION_DEFAULT_STROKE, strokeWidth: ANNOTATION_DEFAULT_STROKE_WIDTH, cornerRadius: 0,
  };
}

export function createEllipseElement(a: Point, b: Point): AnnotationElement | null {
  const rect = normalizeRect(a, b);
  if (rect.width < ANNOTATION_MIN_SHAPE_SIZE || rect.height < ANNOTATION_MIN_SHAPE_SIZE) return null;
  return {
    id: createId("annot-ellipse"), kind: "ellipse",
    x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, radiusX: rect.width / 2, radiusY: rect.height / 2, rotation: 0,
    fill: "transparent", stroke: ANNOTATION_DEFAULT_STROKE, strokeWidth: ANNOTATION_DEFAULT_STROKE_WIDTH,
  };
}

export function createPolygonElement(center: Point, edge: Point, sides: number): AnnotationElement | null {
  const radius = distance(center, edge);
  if (radius < ANNOTATION_MIN_SHAPE_SIZE) return null;
  return {
    id: createId("annot-polygon"), kind: "polygon", x: center.x, y: center.y, sides, radius, rotation: 0,
    fill: "transparent", stroke: ANNOTATION_DEFAULT_STROKE, strokeWidth: ANNOTATION_DEFAULT_STROKE_WIDTH,
  };
}

export function createLineElement(a: Point, b: Point): AnnotationElement | null {
  if (distance(a, b) < ANNOTATION_MIN_SHAPE_SIZE) return null;
  return { id: createId("annot-line"), kind: "line", points: [a, b], stroke: ANNOTATION_DEFAULT_STROKE, strokeWidth: ANNOTATION_DEFAULT_STROKE_WIDTH };
}

export function createArrowElement(a: Point, b: Point): AnnotationElement | null {
  if (distance(a, b) < ANNOTATION_MIN_SHAPE_SIZE) return null;
  return { id: createId("annot-arrow"), kind: "arrow", points: [a, b], stroke: ANNOTATION_DEFAULT_STROKE, strokeWidth: ANNOTATION_DEFAULT_STROKE_WIDTH };
}

export function createFreehandElement(points: Point[]): AnnotationElement | null {
  if (points.length < 2) return null;
  return { id: createId("annot-freehand"), kind: "freehand", points, stroke: ANNOTATION_DEFAULT_STROKE, strokeWidth: ANNOTATION_DEFAULT_STROKE_WIDTH };
}

export function createStarElement(center: Point, edge: Point): AnnotationElement | null {
  const radius = distance(center, edge);
  if (radius < ANNOTATION_MIN_SHAPE_SIZE) return null;
  const points = Array.from({ length: 10 }, (_, index) => {
    const angle = -Math.PI / 2 + index * Math.PI / 5;
    const pointRadius = index % 2 === 0 ? radius : radius * 0.42;
    return { x: center.x + Math.cos(angle) * pointRadius, y: center.y + Math.sin(angle) * pointRadius };
  });
  return createFreehandElement([...points, points[0]]);
}

export function duplicateAnnotationElement(element: AnnotationElement): AnnotationElement {
  const copy = JSON.parse(JSON.stringify(element)) as AnnotationElement;
  copy.id = createId(`annot-${copy.kind}`);
  if ("x" in copy) { copy.x += 16; copy.y += 16; }
  if ("points" in copy) copy.points = copy.points.map((point) => ({ x: point.x + 16, y: point.y + 16 })) as unknown as typeof copy.points;
  if(copy.kind==="path")copy.nodes=copy.nodes.map(node=>({...node,x:node.x+16,y:node.y+16,...(node.in?{in:{x:node.in.x+16,y:node.in.y+16}}:{}),...(node.out?{out:{x:node.out.x+16,y:node.out.y+16}}:{})}));
  return copy;
}
