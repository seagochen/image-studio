import { useEffect, useRef, useState } from "react";
import type { ImageStudioDocument } from "../domain/document";
import { previewScale, renderImageStudioDocument } from "../domain/exportImage";
import { CompositePreviewWorker } from "./previewWorker";
import { previewDocumentVersion, restorePreviewTiles, storePreviewTiles } from "./previewTiles";

interface PreviewRequest {
  document: ImageStudioDocument;
  overrides?: ReadonlyMap<string, HTMLCanvasElement>;
}

/** One running job plus one replaceable request prevents pointer events from starving previews. */
export function useCompositePreview(document: ImageStudioDocument, enabled: boolean, pixelVersion: number,
  overrides: ReadonlyMap<string, HTMLCanvasElement> | undefined, drawing: boolean, onError: () => void): HTMLCanvasElement | null {
  const [preview, setPreview] = useState<{ documentId: string; canvas: HTMLCanvasElement } | null>(null);
  const state = useRef<{ pending: PreviewRequest | null; controller: AbortController | null; timer: number | null; mounted: boolean; worker: CompositePreviewWorker | null; workerFailed: boolean }>({ pending: null, controller: null, timer: null, mounted: true, worker: null, workerFailed: false });
  const latest = useRef({ document, enabled, onError });
  latest.current = { document, enabled, onError };

  const schedule = () => {
    const current = state.current;
    if (!current.mounted || current.controller || current.timer !== null || !current.pending) return;
    current.timer = window.setTimeout(() => {
      current.timer = null;
      const request = current.pending;
      current.pending = null;
      if (!request || !current.mounted) return;
      const controller = new AbortController();
      current.controller = controller;
      const scale = previewScale(request.document);
      const version = previewDocumentVersion(request.document, pixelVersion);
      const worker = !request.overrides && !current.workerFailed
        ? current.worker ?? (CompositePreviewWorker.isAvailable() ? (current.worker = new CompositePreviewWorker()) : null)
        : null;
      const renderFresh = () => worker
        ? worker.render(request.document, scale, controller.signal).catch((error) => {
          if (controller.signal.aborted) throw error;
          current.workerFailed = true; current.worker?.dispose(); current.worker = null;
          return renderImageStudioDocument(request.document, { signal: controller.signal, scale, rasterOverrides: request.overrides });
        })
        : renderImageStudioDocument(request.document, { signal: controller.signal, scale, rasterOverrides: request.overrides });
      const render = request.overrides
        ? renderFresh()
        : restorePreviewTiles(request.document, scale, version).then((cached) => cached ?? renderFresh());
      void render
        .then((canvas) => {
          if (!request.overrides) void storePreviewTiles(request.document, scale, version, canvas);
          if (current.mounted && !controller.signal.aborted && latest.current.enabled && latest.current.document.id === request.document.id) setPreview({ documentId: request.document.id, canvas });
        })
        .catch(() => { if (current.mounted && !controller.signal.aborted) latest.current.onError(); })
        .finally(() => { current.controller = null; schedule(); });
    }, 16);
  };

  useEffect(() => {
    const current = state.current;
    if (!enabled) {
      current.pending = null;
      current.controller?.abort();
      setPreview(null);
      return;
    }
    current.pending = { document, overrides };
    if (!drawing) current.controller?.abort();
    schedule();
  }, [document.id, document.layers, enabled, pixelVersion]);

  useEffect(() => {
    state.current.mounted = true;
    schedule();
    return () => {
      const current = state.current;
      current.mounted = false;
      current.pending = null;
      current.controller?.abort();
      current.worker?.dispose(); current.worker = null;
      if (current.timer !== null) window.clearTimeout(current.timer);
      current.timer = null;
    };
  }, []);
  useEffect(() => () => {
    if (preview) { preview.canvas.width = 1; preview.canvas.height = 1; }
  }, [preview]);
  return enabled && preview?.documentId === document.id ? preview.canvas : null;
}
