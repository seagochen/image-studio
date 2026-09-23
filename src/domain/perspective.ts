import { MAX_IMAGE_EDGE, MAX_IMAGE_PIXELS } from "./importImage";

export interface Point { x: number; y: number }
export type Quad = [Point, Point, Point, Point];
export interface Pixels { width: number; height: number; data: Uint8ClampedArray }

export function fullImageQuad(width: number, height: number): Quad {
  return [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: height }, { x: 0, y: height }];
}

export function validQuad(points: Quad, width: number, height: number): boolean {
  return points.every((p, i) => {
    const b = points[(i + 1) % 4], c = points[(i + 2) % 4];
    return Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.y >= 0 && p.x <= width && p.y <= height
      && (b.x - p.x) * (c.y - b.y) - (b.y - p.y) * (c.x - b.x) > 0.01;
  });
}

export function validOutputSize(width: number, height: number): boolean {
  return Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0
    && width <= MAX_IMAGE_EDGE && height <= MAX_IMAGE_EDGE && width * height <= MAX_IMAGE_PIXELS;
}

// Map the unit output rectangle to source image edges; sample pixel centers below.
export function rectangleToQuad(q: Quad): number[] {
  const [a, b, c, d] = q;
  const dx = a.x - b.x + c.x - d.x, dy = a.y - b.y + c.y - d.y;
  const bx = b.x - c.x, by = b.y - c.y, cx = d.x - c.x, cy = d.y - c.y;
  const determinant = bx * cy - cx * by;
  if (Math.abs(determinant) < 1e-10) throw new Error("Degenerate perspective quadrilateral");
  const g = (dx * cy - cx * dy) / determinant, h = (bx * dy - dx * by) / determinant;
  return [b.x - a.x + g * b.x, d.x - a.x + h * d.x, a.x,
    b.y - a.y + g * b.y, d.y - a.y + h * d.y, a.y, g, h];
}

export function projectPoint(matrix: number[], u: number, v: number): Point {
  const divisor = matrix[6] * u + matrix[7] * v + 1;
  return { x: (matrix[0] * u + matrix[1] * v + matrix[2]) / divisor,
    y: (matrix[3] * u + matrix[4] * v + matrix[5]) / divisor };
}

export function resampleRows(source: Pixels, target: Pixels, matrix: number[], start: number, end: number): void {
  for (let y = start; y < end; y++) for (let x = 0; x < target.width; x++) {
    const p = projectPoint(matrix, (x + 0.5) / target.width, (y + 0.5) / target.height);
    const sx = Math.max(0, Math.min(source.width - 1, p.x - 0.5));
    const sy = Math.max(0, Math.min(source.height - 1, p.y - 0.5));
    const x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0;
    const offsets = [y0 * source.width + x0, y0 * source.width + Math.min(x0 + 1, source.width - 1),
      Math.min(y0 + 1, source.height - 1) * source.width + x0,
      Math.min(y0 + 1, source.height - 1) * source.width + Math.min(x0 + 1, source.width - 1)];
    const weights = [(1 - fx) * (1 - fy), fx * (1 - fy), (1 - fx) * fy, fx * fy];
    const out = (y * target.width + x) * 4;
    let alpha = 0;
    const rgb = [0, 0, 0];
    for (let i = 0; i < 4; i++) {
      const offset = offsets[i] * 4, weight = weights[i] * source.data[offset + 3];
      alpha += weight;
      for (let channel = 0; channel < 3; channel++) rgb[channel] += source.data[offset + channel] * weight;
    }
    target.data[out + 3] = alpha;
    for (let channel = 0; channel < 3; channel++) target.data[out + channel] = alpha > 0 ? rgb[channel] / alpha : 0;
  }
}

export async function warpPerspective(source: Pixels, quad: Quad, width: number, height: number,
  signal: AbortSignal, onProgress?: (progress: number) => void): Promise<Pixels> {
  if (!validOutputSize(width, height) || !validQuad(quad, source.width, source.height)) throw new Error("Invalid perspective geometry or output size");
  signal.throwIfAborted();
  const target = { width, height, data: new Uint8ClampedArray(width * height * 4) };
  const matrix = rectangleToQuad(quad);
  const rows = Math.max(1, Math.floor(32768 / width));
  for (let y = 0; y < height; y += rows) {
    signal.throwIfAborted();
    resampleRows(source, target, matrix, y, Math.min(height, y + rows));
    onProgress?.(Math.min(1, (y + rows) / height));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  signal.throwIfAborted();
  return target;
}
