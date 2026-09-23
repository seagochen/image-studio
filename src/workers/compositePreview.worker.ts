import type { ImageStudioDocument } from "../domain/document";
import { renderImageStudioDocument } from "../domain/exportImage";

interface RenderRequest {
  id: number;
  document: ImageStudioDocument;
  scale: number;
}

interface WorkerScope {
  addEventListener(type: "message", listener: (event: MessageEvent<RenderRequest>) => void): void;
  postMessage(message: unknown, transfer?: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;

scope.addEventListener("message", (event) => {
  void render(event.data);
});

async function render(request: RenderRequest): Promise<void> {
  try {
    const canvas = await renderImageStudioDocument(request.document, {
      scale: request.scale,
      createCanvas: (width, height) => new OffscreenCanvas(width, height) as unknown as HTMLCanvasElement,
    });
    const bitmap = (canvas as unknown as OffscreenCanvas).transferToImageBitmap();
    scope.postMessage({ id: request.id, bitmap }, [bitmap]);
  } catch (error) {
    scope.postMessage({ id: request.id, error: error instanceof Error ? error.message : "Preview worker failed" });
  }
}
