import { useEffect, useMemo, useRef, useState } from "react";
import type { AdjustmentLayer, ImageStudioDocument } from "../domain/document";
import { addLayer } from "../domain/commands";
import { defaultAdjustment, previewLuminosityHistogram } from "../domain/adjustmentEngine";
import { useCompositePreview } from "./useCompositePreview";
import { ADJUSTMENT_KIND_LABELS, AdjustmentPanel, PANEL_LABELS } from "./AdjustmentPanel";
import { trapDialogFocus } from "./dialogFocus";
import type { Locale } from "../i18n";

export type AdjustmentEditorOutcome =
  | { kind: "cancelled" }
  | { kind: "keep"; layer: AdjustmentLayer }
  | { kind: "bake"; layer: AdjustmentLayer };

interface Props {
  document: ImageStudioDocument;
  draft: AdjustmentLayer;
  sourceLayerId: string | null;
  locale: Locale;
  onComplete: (outcome: AdjustmentEditorOutcome) => void;
}

/** Popup counterpart to RasterEditorDialog: a new adjustment layer is configured here, over a
 *  live full-document preview, before it ever touches the real document — the properties tab
 *  only takes over once the layer is kept. */
export function AdjustmentEditorDialog({ document: baseDocument, draft, sourceLayerId, locale, onComplete }: Props): JSX.Element {
  const labels = PANEL_LABELS[locale];
  const [layer, setLayer] = useState(draft);
  const [previewFailed, setPreviewFailed] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const complete = useRef(onComplete); complete.current = onComplete;

  useEffect(() => {
    const previous = window.document.activeElement as HTMLElement | null;
    root.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => previous?.focus();
  }, []);

  const previewDocument = useMemo(() => addLayer(baseDocument, layer), [baseDocument, layer]);
  const previewCanvas = useCompositePreview(previewDocument, true, 0, undefined, false, () => setPreviewFailed(true));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !previewCanvas) return;
    canvas.width = previewCanvas.width; canvas.height = previewCanvas.height;
    canvas.getContext("2d")?.drawImage(previewCanvas, 0, 0);
  }, [previewCanvas]);

  const previewHistogram = useMemo(() => previewCanvas ? previewLuminosityHistogram(previewCanvas) : undefined, [previewCanvas]);

  const sourceLayer = sourceLayerId ? baseDocument.layers.find((candidate) => candidate.id === sourceLayerId) : undefined;
  const canBake = sourceLayer?.type === "raster" && !sourceLayer.locked && !layer.locked;
  const title = ADJUSTMENT_KIND_LABELS[locale][layer.adjustment.kind];

  return <div ref={root} className="pixel-editor-backdrop" role="dialog" aria-modal="true" aria-label={title} onKeyDown={(event) => {
    trapDialogFocus(event.nativeEvent, root.current);
    if (event.key === "Escape") { event.preventDefault(); complete.current({ kind: "cancelled" }); }
    event.stopPropagation();
  }}>
    <div className="pixel-editor no-nav">
      <header>
        <h2>{title}</h2>
        <button onClick={() => setLayer((current) => ({ ...current, adjustment: defaultAdjustment(current.adjustment.kind) }))}>{labels.reset}</button>
        <button onClick={() => complete.current({ kind: "cancelled" })}>{labels.cancel}</button>
        {canBake && <button onClick={() => complete.current({ kind: "bake", layer })}>{labels.bakeIntoOriginal}</button>}
        <button className="primary" onClick={() => complete.current({ kind: "keep", layer })}>{labels.keepAsLayer}</button>
      </header>
      <main>
        <div className="pixel-canvas-wrap raster-canvas-wrap">
          {!previewCanvas && <p>{previewFailed ? labels.previewFailed : labels.loading}</p>}
          <canvas ref={canvasRef} />
        </div>
        <aside><AdjustmentPanel layer={layer} locale={locale} histogram={previewHistogram}
          onChange={(adjustment) => setLayer((current) => ({ ...current, adjustment }))} /></aside>
      </main>
    </div>
  </div>;
}
