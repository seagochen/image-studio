import { MAX_IMAGE_EDGE, MAX_IMAGE_PIXELS } from "../imageResourceLimits";

export interface Point {
  x: number;
  y: number;
}

export interface Transform2D {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  /** Clockwise degrees in the stage coordinate system. */
  rotation: number;
}

export interface Viewport {
  offsetX: number;
  offsetY: number;
  scale: number;
  devicePixelRatio: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MaskStroke {
  points: readonly Point[];
  size: number;
  mode: "paint" | "erase";
  value: number;
}

export interface RasterMask {
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
}

export type PixelRounding = "nearest" | "floor" | "ceil";

export function screenToStage(point: Point, viewport: Viewport): Point {
  assertScale(viewport.scale, "viewport scale");
  return { x: (point.x - viewport.offsetX) / viewport.scale, y: (point.y - viewport.offsetY) / viewport.scale };
}

export function stageToScreen(point: Point, viewport: Viewport): Point {
  assertScale(viewport.scale, "viewport scale");
  return { x: point.x * viewport.scale + viewport.offsetX, y: point.y * viewport.scale + viewport.offsetY };
}

export function screenToDevice(point: Point, viewport: Viewport): Point {
  assertScale(viewport.devicePixelRatio, "device pixel ratio");
  return { x: point.x * viewport.devicePixelRatio, y: point.y * viewport.devicePixelRatio };
}

export function stageToImage(point: Point, transform: Transform2D): Point {
  assertScale(transform.scaleX, "horizontal transform scale");
  assertScale(transform.scaleY, "vertical transform scale");
  const radians = (-transform.rotation * Math.PI) / 180;
  const translatedX = point.x - transform.x;
  const translatedY = point.y - transform.y;
  return {
    x: (translatedX * Math.cos(radians) - translatedY * Math.sin(radians)) / transform.scaleX,
    y: (translatedX * Math.sin(radians) + translatedY * Math.cos(radians)) / transform.scaleY,
  };
}

export function imageToStage(point: Point, transform: Transform2D): Point {
  assertScale(transform.scaleX, "horizontal transform scale");
  assertScale(transform.scaleY, "vertical transform scale");
  const radians = (transform.rotation * Math.PI) / 180;
  const scaledX = point.x * transform.scaleX;
  const scaledY = point.y * transform.scaleY;
  return {
    x: scaledX * Math.cos(radians) - scaledY * Math.sin(radians) + transform.x,
    y: scaledX * Math.sin(radians) + scaledY * Math.cos(radians) + transform.y,
  };
}

export function clampPoint(point: Point, width: number, height: number): Point {
  return { x: Math.max(0, Math.min(width, point.x)), y: Math.max(0, Math.min(height, point.y)) };
}

export function roundPixel(value: number, strategy: PixelRounding = "nearest"): number {
  if (!Number.isFinite(value)) throw new Error("Pixel coordinate must be finite");
  if (strategy === "floor") return Math.floor(value);
  if (strategy === "ceil") return Math.ceil(value);
  return Math.round(value);
}

export function pointInRect(point: Point, rect: Rect): boolean {
  return point.x >= rect.x && point.y >= rect.y && point.x <= rect.x + rect.width && point.y <= rect.y + rect.height;
}

export function pointInPolygon(point: Point, vertices: readonly Point[]): boolean {
  if (vertices.length < 3) return false;
  let inside = false;
  for (let index = 0, previous = vertices.length - 1; index < vertices.length; previous = index++) {
    const currentPoint = vertices[index];
    const previousPoint = vertices[previous];
    if (pointOnSegment(point, previousPoint, currentPoint)) return true;
    const crosses = (currentPoint.y > point.y) !== (previousPoint.y > point.y)
      && point.x < ((previousPoint.x - currentPoint.x) * (point.y - currentPoint.y)) / (previousPoint.y - currentPoint.y) + currentPoint.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

/** Rasterizes image-coordinate strokes into one byte per pixel, row-major. */
export function rasterizeMask(width: number, height: number, strokes: readonly MaskStroke[]): RasterMask {
  assertRasterSize(width, height);
  const pixels = new Uint8ClampedArray(width * height);
  for (const stroke of strokes) {
    if (!Number.isFinite(stroke.size) || stroke.size <= 0 || !Number.isInteger(stroke.value) || stroke.value < 0 || stroke.value > 255) {
      throw new Error("Invalid mask stroke");
    }
    if (stroke.points.length === 0) continue;
    const value = stroke.mode === "erase" ? 0 : stroke.value;
    paintDisc(pixels, width, height, stroke.points[0], stroke.size / 2, value);
    for (let index = 1; index < stroke.points.length; index += 1) {
      const from = stroke.points[index - 1];
      const to = stroke.points[index];
      const distance = Math.hypot(to.x - from.x, to.y - from.y);
      const steps = Math.max(1, Math.ceil(distance * 2));
      for (let step = 1; step <= steps; step += 1) {
        const ratio = step / steps;
        paintDisc(pixels, width, height, {
          x: from.x + (to.x - from.x) * ratio,
          y: from.y + (to.y - from.y) * ratio,
        }, stroke.size / 2, value);
      }
    }
  }
  return { width, height, pixels };
}

function paintDisc(pixels: Uint8ClampedArray, width: number, height: number, center: Point, radius: number, value: number): void {
  if (!Number.isFinite(center.x) || !Number.isFinite(center.y)) throw new Error("Mask point must be finite");
  const minX = Math.max(0, Math.ceil(center.x - radius - 0.5));
  const maxX = Math.min(width - 1, Math.floor(center.x + radius - 0.5));
  const minY = Math.max(0, Math.ceil(center.y - radius - 0.5));
  const maxY = Math.min(height - 1, Math.floor(center.y + radius - 0.5));
  const radiusSquared = radius * radius;
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const dx = x + 0.5 - center.x;
      const dy = y + 0.5 - center.y;
      if (dx * dx + dy * dy <= radiusSquared) pixels[y * width + x] = value;
    }
  }
}

function assertRasterSize(width: number, height: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0
    || width > MAX_IMAGE_EDGE || height > MAX_IMAGE_EDGE || width * height > MAX_IMAGE_PIXELS) {
    throw new Error("Invalid mask dimensions");
  }
}

function assertScale(value: number, label: string): void {
  if (!Number.isFinite(value) || value === 0) throw new Error(`Invalid ${label}`);
}

function pointOnSegment(point: Point, from: Point, to: Point): boolean {
  const cross = (point.y - from.y) * (to.x - from.x) - (point.x - from.x) * (to.y - from.y);
  if (Math.abs(cross) > Number.EPSILON * 100) return false;
  return point.x >= Math.min(from.x, to.x) && point.x <= Math.max(from.x, to.x)
    && point.y >= Math.min(from.y, to.y) && point.y <= Math.max(from.y, to.y);
}
