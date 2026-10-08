import type { ImageStudioDocument } from "../domain/document";
import { OpfsTileStore, TileCache, type TileCacheKey } from "../domain/tileCache";

export const PREVIEW_TILE_EDGE = 256;
const PREVIEW_MEMORY_BUDGET = 24 * 1024 * 1024;
export const PREVIEW_PERSISTENT_BUDGET = 64 * 1024 * 1024;
let cachePromise: Promise<TileCache> | null = null;

export interface PreviewTile { x: number; y: number; width: number; height: number }

export function previewTiles(width: number, height: number, edge = PREVIEW_TILE_EDGE): PreviewTile[] {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || !Number.isInteger(edge) || edge < 1) {
    throw new Error("Invalid preview tile dimensions");
  }
  const tiles: PreviewTile[] = [];
  for (let y = 0; y < height; y += edge) {
    for (let x = 0; x < width; x += edge) tiles.push({ x, y, width: Math.min(edge, width - x), height: Math.min(edge, height - y) });
  }
  return tiles;
}

/** The full snapshot fingerprint prevents a stale derived bitmap from becoming project data. */
export function previewDocumentVersion(document: ImageStudioDocument, pixelVersion: number): string {
  if (!Number.isSafeInteger(pixelVersion) || pixelVersion < 0) throw new Error("Invalid preview pixel version");
  return `${pixelVersion}:${fnv1a(JSON.stringify(document))}`;
}

export async function restorePreviewTiles(document: ImageStudioDocument, scale: number, version: string): Promise<HTMLCanvasElement | null> {
  if (typeof ImageData === "undefined") return null;
  const width = Math.max(1, Math.ceil(document.canvas.width * scale));
  const height = Math.max(1, Math.ceil(document.canvas.height * scale));
  const canvas = documentCanvas(width, height);
  const context = canvas.getContext("2d");
  if (!context) return null;
  try {
    const cache = await previewTileCache();
    for (const tile of previewTiles(width, height)) {
      const bytes = await cache.get(tileKey(document, version, scale, tile));
      if (!bytes || bytes.byteLength !== tile.width * tile.height * 4) {
        canvas.width = 1; canvas.height = 1;
        return null;
      }
      const rgba = new Uint8ClampedArray(bytes.byteLength);
      rgba.set(bytes);
      context.putImageData(new ImageData(rgba, tile.width, tile.height), tile.x, tile.y);
    }
    return canvas;
  } catch {
    canvas.width = 1; canvas.height = 1;
    return null;
  }
}

export async function storePreviewTiles(document: ImageStudioDocument, scale: number, version: string, canvas: HTMLCanvasElement): Promise<void> {
  if (typeof ImageData === "undefined") return;
  const width = Math.max(1, Math.ceil(document.canvas.width * scale));
  const height = Math.max(1, Math.ceil(document.canvas.height * scale));
  if (canvas.width !== width || canvas.height !== height) return;
  const context = canvas.getContext("2d");
  if (!context) return;
  try {
    const cache = await previewTileCache();
    for (const tile of previewTiles(width, height)) {
      const data = context.getImageData(tile.x, tile.y, tile.width, tile.height).data;
      const bytes = new Uint8Array(data.byteLength);
      bytes.set(data);
      await cache.put(tileKey(document, version, scale, tile), bytes);
    }
  } catch {
    // A derived preview must never make editing unavailable.
  }
}

/** Clears only derived previews; saved projects, assets and drafts are untouched. */
export async function clearPreviewTileCache(): Promise<void> {
  // Keep one cache instance so writes already in flight share the same directory lock.
  await (await previewTileCache()).clear();
}

export interface PreviewStorageStatus { memoryBytes: number; memoryEntries: number; persistentAvailable: boolean; persistentError: boolean; usage?: number; quota?: number }

/** Reports browser storage only; it never inspects project, asset or draft contents. */
export async function previewStorageStatus(): Promise<PreviewStorageStatus> {
  const cache = await previewTileCache();
  const estimate = await (navigator.storage?.estimate?.().catch(() => undefined) ?? undefined);
  return { ...cache.stats, usage: estimate?.usage, quota: estimate?.quota };
}

function tileKey(document: ImageStudioDocument, version: string, scale: number, tile: PreviewTile): TileCacheKey {
  return {
    documentId: document.id,
    documentVersion: version,
    nodeId: "composite-preview",
    scale,
    colorModel: "srgb-premultiplied-rgba8",
    x: tile.x / PREVIEW_TILE_EDGE,
    y: tile.y / PREVIEW_TILE_EDGE,
  };
}

async function previewTileCache(): Promise<TileCache> {
  if (!cachePromise) cachePromise = OpfsTileStore.open("skillsmaster-image-studio-tiles", PREVIEW_PERSISTENT_BUDGET)
    .catch(() => null).then((persistent) => new TileCache(PREVIEW_MEMORY_BUDGET, persistent ?? undefined));
  return cachePromise;
}

function documentCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = window.document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  return canvas;
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}
