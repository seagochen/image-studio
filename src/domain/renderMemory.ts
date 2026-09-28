export interface RenderMemoryUsage {
  currentBytes: number;
  peakBytes: number;
}

const canvasLeases = new WeakMap<HTMLCanvasElement, () => void>();

/** Accounts for live pixel resources, not browser/GPU process RSS or GC timing. */
export class RenderMemoryBudget {
  private currentBytes = 0;
  private peakBytes = 0;
  private canvases = new Set<HTMLCanvasElement>();

  constructor(private readonly limitBytes: number, private readonly observe?: (usage: RenderMemoryUsage) => void) {}

  reserve(bytes: number): () => void {
    if (!Number.isSafeInteger(bytes) || bytes < 0 || this.currentBytes + bytes > this.limitBytes) {
      throw new Error("Export exceeds the browser memory budget");
    }
    this.currentBytes += bytes;
    this.peakBytes = Math.max(this.peakBytes, this.currentBytes);
    this.report();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.currentBytes -= bytes;
      this.report();
    };
  }

  canvasFactory(createCanvas: (width: number, height: number) => HTMLCanvasElement): typeof createCanvas {
    return (width, height) => {
      const release = this.reserve(width * height * 4);
      try {
        const canvas = createCanvas(width, height);
        if (canvas.width !== width || canvas.height !== height) {
          releaseRenderCanvas(canvas);
          throw new Error("Export canvas dimensions do not match");
        }
        this.canvases.add(canvas);
        canvasLeases.set(canvas, () => { this.canvases.delete(canvas); release(); });
        return canvas;
      } catch (error) { release(); throw error; }
    };
  }

  dispose(): void {
    for (const canvas of this.canvases) releaseRenderCanvas(canvas);
  }

  private report(): void {
    // Diagnostics must not interrupt acquisition before its release handle is returned.
    try { this.observe?.({ currentBytes: this.currentBytes, peakBytes: this.peakBytes }); } catch { /* Non-owning observer. */ }
  }
}

export function releaseRenderCanvas(canvas: HTMLCanvasElement): void {
  try { canvas.width = 1; canvas.height = 1; }
  finally { canvasLeases.get(canvas)?.(); canvasLeases.delete(canvas); }
}

export function reserveRenderBytes(budget: RenderMemoryBudget | undefined, bytes: number): () => void {
  return budget?.reserve(bytes) ?? (() => {});
}
