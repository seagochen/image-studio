import { OpfsTileStore, TileCache, type TileCacheKey } from "./tileCache";

export const PIXEL_HISTORY_TILE_EDGE = 256;
const PIXEL_HISTORY_MEMORY_BUDGET = 12 * 1024 * 1024;

export interface PixelTileRect { x: number; y: number; width: number; height: number }

export interface PixelTileDiff extends PixelTileRect {
  before: Uint8ClampedArray;
  after: Uint8ClampedArray;
}

export type PixelTileDirection = "before" | "after";

export interface PixelTileArchiveRef { id: string; tiles: PixelTileRect[]; }

/**
 * Optional write-through archive for evicted undo tiles. OPFS is an accelerator
 * for the active browser session, never a project or cross-device data store.
 */
export class PixelTileArchive {
  private constructor(private readonly cache: TileCache) {}

  static async open(): Promise<PixelTileArchive | null> {
    const persistent = await OpfsTileStore.open("skillsmaster-image-studio-history").catch(() => null);
    return persistent ? new PixelTileArchive(new TileCache(PIXEL_HISTORY_MEMORY_BUDGET, persistent)) : null;
  }

  async write(id: string, diffs: readonly PixelTileDiff[]): Promise<PixelTileArchiveRef> {
    if (!id || !diffs.length) throw new Error("Invalid pixel history archive entry");
    const reference = { id, tiles: diffs.map(({ x, y, width, height }) => ({ x, y, width, height })) };
    try {
      for (const diff of diffs) {
        await this.cache.put(key(id, "before", diff), bytes(diff.before));
        await this.cache.put(key(id, "after", diff), bytes(diff.after));
      }
      if (this.cache.stats.persistentError) throw new Error("Pixel history archive is unavailable");
      return reference;
    } catch (error) {
      await this.remove(reference).catch(() => undefined);
      throw error;
    }
  }

  async read(reference: PixelTileArchiveRef): Promise<PixelTileDiff[]> {
    const diffs: PixelTileDiff[] = [];
    for (const rect of reference.tiles) {
      const before = await this.cache.get(key(reference.id, "before", rect));
      const after = await this.cache.get(key(reference.id, "after", rect));
      if (!before || !after || before.byteLength !== rect.width * rect.height * 4 || after.byteLength !== rect.width * rect.height * 4) {
        throw new Error("Pixel history archive is incomplete");
      }
      diffs.push({ ...rect, before: clamped(before), after: clamped(after) });
    }
    return diffs;
  }

  async remove(reference: PixelTileArchiveRef): Promise<void> {
    for (const rect of reference.tiles) {
      await this.cache.delete(key(reference.id, "before", rect));
      await this.cache.delete(key(reference.id, "after", rect));
    }
  }
}

/**
 * Captures only tiles that a direct-pixel tool can touch. A caller must mark a
 * conservative region before drawing; over-capturing a neighbouring tile is
 * safe, while under-capturing would make undo lossy.
 */
export class PixelTileRecorder {
  private readonly before = new Map<string, { rect: PixelTileRect; pixels: Uint8ClampedArray }>();

  constructor(private readonly canvas: HTMLCanvasElement, private readonly edge = PIXEL_HISTORY_TILE_EDGE) {
    if (!Number.isInteger(edge) || edge < 1) throw new Error("Invalid pixel history tile edge");
  }

  capture(x: number, y: number, width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    const left = clamp(Math.floor(x), 0, this.canvas.width);
    const top = clamp(Math.floor(y), 0, this.canvas.height);
    const right = clamp(Math.ceil(x + width), 0, this.canvas.width);
    const bottom = clamp(Math.ceil(y + height), 0, this.canvas.height);
    if (right <= left || bottom <= top) return;
    const context = this.canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Pixel history canvas is unavailable");
    for (let tileY = Math.floor(top / this.edge) * this.edge; tileY < bottom; tileY += this.edge) {
      for (let tileX = Math.floor(left / this.edge) * this.edge; tileX < right; tileX += this.edge) {
        const key = `${tileX}:${tileY}`;
        if (this.before.has(key)) continue;
        const rect = { x: tileX, y: tileY, width: Math.min(this.edge, this.canvas.width - tileX), height: Math.min(this.edge, this.canvas.height - tileY) };
        this.before.set(key, { rect, pixels: context.getImageData(rect.x, rect.y, rect.width, rect.height).data });
      }
    }
  }

  finish(): PixelTileDiff[] {
    const context = this.canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Pixel history canvas is unavailable");
    const diffs: PixelTileDiff[] = [];
    for (const { rect, pixels } of this.before.values()) {
      const after = context.getImageData(rect.x, rect.y, rect.width, rect.height).data;
      if (!samePixels(pixels, after)) diffs.push({ ...rect, before: pixels, after });
    }
    return diffs;
  }
}

export function applyPixelTileDiffs(canvas: HTMLCanvasElement, diffs: readonly PixelTileDiff[], direction: PixelTileDirection): void {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Pixel history canvas is unavailable");
  if (diffs.some((diff) => !validRect(canvas, diff) || diff.before.byteLength !== diff.width * diff.height * 4
    || diff.after.byteLength !== diff.width * diff.height * 4)) throw new Error("Invalid pixel history tile");
  for (const diff of diffs) {
    const source = direction === "before" ? diff.before : diff.after;
    const pixels = new Uint8ClampedArray(source.length);
    pixels.set(source);
    context.putImageData(new ImageData(pixels, diff.width, diff.height), diff.x, diff.y);
  }
}

export function pixelTileDiffBytes(diffs: readonly PixelTileDiff[]): number {
  return diffs.reduce((total, diff) => total + diff.before.byteLength + diff.after.byteLength, 0);
}

function samePixels(first: Uint8ClampedArray, second: Uint8ClampedArray): boolean {
  if (first.byteLength !== second.byteLength) return false;
  for (let index = 0; index < first.length; index += 1) if (first[index] !== second[index]) return false;
  return true;
}

function validRect(canvas: HTMLCanvasElement, rect: PixelTileRect): boolean {
  return Number.isInteger(rect.x) && Number.isInteger(rect.y) && Number.isInteger(rect.width) && Number.isInteger(rect.height)
    && rect.x >= 0 && rect.y >= 0 && rect.width > 0 && rect.height > 0 && rect.x + rect.width <= canvas.width && rect.y + rect.height <= canvas.height;
}

function clamp(value: number, minimum: number, maximum: number): number { return Math.max(minimum, Math.min(maximum, value)); }

function key(id: string, direction: PixelTileDirection, rect: PixelTileRect): TileCacheKey {
  return { documentId: id, documentVersion: "v1", nodeId: `pixel-history-${direction}`, scale: 1, colorModel: "srgb-rgba8", x: rect.x / PIXEL_HISTORY_TILE_EDGE, y: rect.y / PIXEL_HISTORY_TILE_EDGE };
}
function bytes(value: Uint8ClampedArray): Uint8Array { const output = new Uint8Array(value.byteLength); output.set(value); return output; }
function clamped(value: Uint8Array): Uint8ClampedArray { const output = new Uint8ClampedArray(value.byteLength); output.set(value); return output; }
