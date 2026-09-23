import PreviewWorker from "../workers/compositePreview.worker?worker";
import type { ImageStudioDocument } from "../domain/document";

interface WorkerSuccess { id: number; bitmap: ImageBitmap }
interface WorkerFailure { id: number; error: string }
type WorkerResponse = WorkerSuccess | WorkerFailure;

interface PendingRender {
  resolve(canvas: HTMLCanvasElement): void;
  reject(error: Error): void;
  abort(): void;
}

/**
 * The Worker never owns project data: it receives a document snapshot and
 * returns a disposable ImageBitmap. Any unsupported browser capability falls
 * back to the caller's existing main-thread renderer.
 */
export class CompositePreviewWorker {
  private readonly worker: Worker;
  private readonly pending = new Map<number, PendingRender>();
  private sequence = 0;

  static isAvailable(): boolean {
    return typeof Worker !== "undefined" && typeof OffscreenCanvas !== "undefined";
  }

  constructor() {
    this.worker = new PreviewWorker();
    this.worker.addEventListener("message", (event: MessageEvent<WorkerResponse>) => this.complete(event.data));
    this.worker.addEventListener("error", () => this.failAll(new Error("Preview worker failed")));
  }

  render(document: ImageStudioDocument, scale: number, signal: AbortSignal): Promise<HTMLCanvasElement> {
    signal.throwIfAborted();
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const abort = () => {
        this.pending.delete(id);
        reject(signal.reason instanceof Error ? signal.reason : new DOMException("Preview cancelled", "AbortError"));
      };
      signal.addEventListener("abort", abort, { once: true });
      this.pending.set(id, { resolve, reject, abort: () => signal.removeEventListener("abort", abort) });
      this.worker.postMessage({ id, document, scale });
    });
  }

  dispose(): void {
    this.worker.terminate();
    this.failAll(new Error("Preview worker disposed"));
  }

  private complete(response: WorkerResponse): void {
    const pending = this.pending.get(response.id);
    if (!pending) {
      if ("bitmap" in response) response.bitmap.close();
      return;
    }
    this.pending.delete(response.id); pending.abort();
    if ("error" in response) { pending.reject(new Error(response.error)); return; }
    const canvas = document.createElement("canvas");
    canvas.width = response.bitmap.width; canvas.height = response.bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) { response.bitmap.close(); pending.reject(new Error("Canvas preview is unavailable")); return; }
    context.drawImage(response.bitmap, 0, 0); response.bitmap.close(); pending.resolve(canvas);
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) { pending.abort(); pending.reject(error); }
    this.pending.clear();
  }
}
