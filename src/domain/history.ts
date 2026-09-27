import type { ImageStudioDocument, RasterLayer, RasterSource } from "./document";
import { pixelTileDiffBytes, PixelTileArchive, type PixelTileArchiveRef, type PixelTileDiff } from "./pixelTileHistory";

export interface HistoryOptions { maxEntries: number; maxBytes: number }
interface DocumentHistoryEntry {
  label: string;
  mergeKey?: string;
  before: ImageStudioDocument;
  after: ImageStudioDocument;
  bytes: number;
}

interface PixelHistoryEntry {
  kind: "pixel";
  label: string;
  layerId: string;
  diffs: PixelTileDiff[];
  addedLayer?: RasterLayer;
  beforeSelection?: ImageStudioDocument["selection"];
  afterSelection?: ImageStudioDocument["selection"];
  archive?: PixelTileArchiveRef;
  offloading?: boolean;
  bytes: number;
}

type HistoryEntry = DocumentHistoryEntry | PixelHistoryEntry;

export type PixelHistoryResolver = (
  document: ImageStudioDocument,
  layerId: string,
  diffs: readonly PixelTileDiff[],
  direction: "before" | "after",
) => Promise<ImageStudioDocument>;

const DEFAULT_OPTIONS: HistoryOptions = { maxEntries: 50, maxBytes: 64 * 1024 * 1024 };
const PIXEL_HISTORY_HOT_BUDGET = 12 * 1024 * 1024;

export class DocumentHistory {
  private undoEntries: HistoryEntry[] = [];
  private redoEntries: HistoryEntry[] = [];
  private pixelArchive: PixelTileArchive | null = null;
  private pixelEntrySequence = 0;

  constructor(private readonly options: HistoryOptions = DEFAULT_OPTIONS) {}

  setPixelArchive(archive: PixelTileArchive | null): void { this.pixelArchive = archive; void this.offloadPixelEntries(); }

  execute(document: ImageStudioDocument, next: ImageStudioDocument, label: string, mergeKey?: string): ImageStudioDocument {
    if (document === next) return document;
    const entry = this.entry(label, document, next, mergeKey);
    if (entry.bytes > this.options.maxBytes) {
      this.clearRedo();
      return next;
    }
    const previous = this.undoEntries.at(-1);
    if (mergeKey && previous && !isPixelEntry(previous) && previous.mergeKey === mergeKey) {
      const merged = this.entry(label, previous.before, next, mergeKey);
      if (merged.bytes > this.options.maxBytes) this.undoEntries.push({ ...entry, mergeKey: undefined });
      else this.undoEntries[this.undoEntries.length - 1] = merged;
    } else {
      this.undoEntries.push(entry);
    }
    this.clearRedo();
    this.trim();
    return next;
  }

  /**
   * Direct-pixel edits keep the current Raster payload in the document for
   * save/export, but their undo entry contains only affected RGBA tiles.
   */
  executePixel(document: ImageStudioDocument, next: ImageStudioDocument, label: string, layerId: string, diffs: readonly PixelTileDiff[], addedLayer?: RasterLayer): ImageStudioDocument {
    const bytes = pixelTileDiffBytes(diffs) + (addedLayer ? addedLayerBytes(addedLayer) : 0);
    if (!layerId || !diffs.length || next === document || bytes > this.options.maxBytes
      || (addedLayer && (document.layers.some((layer) => layer.id === addedLayer.id)
        || !next.layers.some((layer) => layer.id === addedLayer.id)))) return document;
    this.undoEntries.push({ kind: "pixel", label, layerId, diffs: [...diffs], bytes,
      ...(addedLayer ? { addedLayer, beforeSelection: document.selection, afterSelection: next.selection } : {}) });
    this.clearRedo();
    this.trim();
    void this.offloadPixelEntries();
    return next;
  }

  undo(document: ImageStudioDocument): ImageStudioDocument;
  undo(document: ImageStudioDocument, resolvePixel: PixelHistoryResolver): ImageStudioDocument | Promise<ImageStudioDocument>;
  undo(document: ImageStudioDocument, resolvePixel?: PixelHistoryResolver): ImageStudioDocument | Promise<ImageStudioDocument> {
    const entry = this.undoEntries.pop();
    if (!entry) return document;
    if (isPixelEntry(entry)) return this.resolvePixelEntry(document, entry, "before", this.undoEntries, this.redoEntries, resolvePixel);
    this.redoEntries.push(entry);
    return entry.before;
  }

  redo(document: ImageStudioDocument): ImageStudioDocument;
  redo(document: ImageStudioDocument, resolvePixel: PixelHistoryResolver): ImageStudioDocument | Promise<ImageStudioDocument>;
  redo(document: ImageStudioDocument, resolvePixel?: PixelHistoryResolver): ImageStudioDocument | Promise<ImageStudioDocument> {
    const entry = this.redoEntries.pop();
    if (!entry) return document;
    if (isPixelEntry(entry)) return this.resolvePixelEntry(document, entry, "after", this.redoEntries, this.undoEntries, resolvePixel);
    this.undoEntries.push(entry);
    return entry.after;
  }

  canRecord(before: ImageStudioDocument, after: ImageStudioDocument): boolean {
    return estimateChangeBytes(before, after) <= this.options.maxBytes;
  }

  canRecordPixel(diffs: readonly PixelTileDiff[]): boolean {
    return diffs.length > 0 && this.canRecordPixelBytes(pixelTileDiffBytes(diffs));
  }

  canRecordPixelBytes(bytes: number): boolean {
    return Number.isSafeInteger(bytes) && bytes > 0 && bytes <= this.options.maxBytes;
  }

  canRecordPixelLift(diffs: readonly PixelTileDiff[], addedLayer: RasterLayer): boolean {
    return diffs.length > 0 && this.canRecordPixelBytes(pixelTileDiffBytes(diffs) + addedLayerBytes(addedLayer));
  }

  retainedAssetIds(): string[] {
    const ids = new Set<string>();
    for (const entry of [...this.undoEntries, ...this.redoEntries]) {
      if (isPixelEntry(entry)) continue;
      collectAssetIds(entry.before, ids);
      collectAssetIds(entry.after, ids);
    }
    return [...ids];
  }

  clear(): void {
    for (const entry of [...this.undoEntries, ...this.redoEntries]) this.discard(entry);
    this.undoEntries = []; this.redoEntries = [];
  }

  get state(): { canUndo: boolean; canRedo: boolean; entries: number; bytes: number } {
    return {
      canUndo: this.undoEntries.length > 0,
      canRedo: this.redoEntries.length > 0,
      entries: this.undoEntries.length,
      bytes: this.undoEntries.reduce((total, entry) => total + entry.bytes, 0),
    };
  }

  private entry(label: string, before: ImageStudioDocument, after: ImageStudioDocument, mergeKey?: string): DocumentHistoryEntry {
    return { label, mergeKey, before, after, bytes: estimateChangeBytes(before, after) };
  }

  private trim(): void {
    let bytes = this.undoEntries.reduce((total, entry) => total + entry.bytes, 0);
    while (this.undoEntries.length > this.options.maxEntries || (bytes > this.options.maxBytes && this.undoEntries.length > 1)) {
      const removed = this.undoEntries.shift()!;
      bytes -= removed.bytes; this.discard(removed);
    }
  }

  private resolvePixelEntry(
    document: ImageStudioDocument,
    entry: PixelHistoryEntry,
    direction: "before" | "after",
    source: HistoryEntry[],
    destination: HistoryEntry[],
    resolvePixel?: PixelHistoryResolver,
  ): Promise<ImageStudioDocument> {
    if (!resolvePixel) {
      source.push(entry);
      return Promise.reject(new Error("Pixel history requires a resolver"));
    }
    const diffs = entry.diffs.length ? Promise.resolve(entry.diffs) : entry.archive && this.pixelArchive ? this.pixelArchive.read(entry.archive) : Promise.reject(new Error("Pixel history archive is unavailable"));
    if (entry.addedLayer && (direction === "before" ? !document.layers.some((layer) => layer.id === entry.addedLayer?.id)
      : document.layers.some((layer) => layer.id === entry.addedLayer?.id))) {
      source.push(entry);
      return Promise.reject(new Error("Pixel history layer structure has changed"));
    }
    return diffs.then((resolved) => resolvePixel(document, entry.layerId, resolved, direction)).then((restored) => {
      const next = !entry.addedLayer ? restored : direction === "before"
        ? { ...restored, layers: restored.layers.filter((layer) => layer.id !== entry.addedLayer?.id), selection: entry.beforeSelection! }
        : { ...restored, layers: [...restored.layers, entry.addedLayer], selection: entry.afterSelection! };
      destination.push(entry);
      return next;
    }, (error: unknown) => {
      source.push(entry);
      throw error;
    });
  }

  private async offloadPixelEntries(): Promise<void> {
    if (!this.pixelArchive) return;
    let hotBytes = pixelHistoryHotBytes([...this.undoEntries, ...this.redoEntries]);
    for (const entry of [...this.undoEntries, ...this.redoEntries]) {
      if (hotBytes <= PIXEL_HISTORY_HOT_BUDGET) return;
      if (!isPixelEntry(entry) || !entry.diffs.length || entry.archive || entry.offloading) continue;
      try {
        entry.offloading = true;
        const archive = await this.pixelArchive.write(`history-${++this.pixelEntrySequence}`, entry.diffs);
        hotBytes -= pixelTileDiffBytes(entry.diffs);
        entry.archive = archive; entry.diffs = []; entry.offloading = false;
      } catch {
        entry.offloading = false;
        // Keep the hot copy. A failed local cache must not make undo lossy.
      }
    }
  }

  private discard(entry: HistoryEntry): void {
    if (isPixelEntry(entry) && entry.archive && this.pixelArchive) void this.pixelArchive.remove(entry.archive).catch(() => undefined);
  }

  private clearRedo(): void {
    for (const entry of this.redoEntries) this.discard(entry);
    this.redoEntries = [];
  }
}

function isPixelEntry(entry: HistoryEntry): entry is PixelHistoryEntry { return "kind" in entry && entry.kind === "pixel"; }
function pixelHistoryHotBytes(entries: readonly HistoryEntry[]): number { return entries.reduce((total, entry) => total + (isPixelEntry(entry) ? pixelTileDiffBytes(entry.diffs) : 0), 0); }

function addedLayerBytes(layer: RasterLayer): number {
  return layer.source.kind === "data-url" ? layer.source.value.length * 2 + 2_048 : 2_048;
}

function collectAssetIds(document: ImageStudioDocument, ids: Set<string>): void {
  for (const layer of document.layers) {
    if (layer.type === "raster" && layer.source.kind === "asset") ids.add(layer.source.assetId);
  }
}

/**
 * History snapshots share immutable document branches. Large raster payloads are
 * charged only when a command actually replaces them, so a rename or transform
 * cannot exhaust the undo budget merely because the document contains an image.
 */
function estimateChangeBytes(before: ImageStudioDocument, after: ImageStudioDocument): number {
  const metadataBytes = JSON.stringify([withoutRasterPayloads(before), withoutRasterPayloads(after)]).length * 2;
  const beforeSources = rasterPayloads(before);
  const afterSources = rasterPayloads(after);
  let changedPayloadBytes = 0;
  for (const [layerId, source] of beforeSources) {
    if (afterSources.get(layerId) !== source) changedPayloadBytes += source.length * 2;
  }
  for (const [layerId, source] of afterSources) {
    if (beforeSources.get(layerId) !== source) changedPayloadBytes += source.length * 2;
  }
  return metadataBytes + changedPayloadBytes;
}

function withoutRasterPayloads(document: ImageStudioDocument): ImageStudioDocument {
  return {
    ...document,
    layers: document.layers.map((layer) => layer.type !== "raster" ? layer : {
      ...layer,
      source: layer.source.kind === "data-url"
        ? { ...layer.source, value: "<shared-raster-payload>" }
        : { ...layer.source, url: undefined },
    }),
  };
}

function rasterPayloads(document: ImageStudioDocument): Map<string, string> {
  return new Map(document.layers.flatMap((layer) => {
    if (layer.type !== "raster") return [];
    const source: RasterSource = layer.source;
    if (source.kind === "data-url") return [[layer.id, source.value] as const];
    return source.url ? [[layer.id, source.url] as const] : [];
  }));
}
