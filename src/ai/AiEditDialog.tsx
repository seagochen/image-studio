import { useEffect, useMemo, useRef, useState } from "react";
import { createId, rasterSourceUrl, type DrawingLayer, type RasterLayer } from "../domain/document";
import type { PixelSelection } from "../studio/tools";
import { maskInputFromLayer, maskInputFromSelection } from "./maskInput";
import type { DecodedImage } from "../domain/importImage";
import { AiEditOrchestrator } from "./orchestrator";
import { fetchImageModes, IMAGE_STUDIO_AI_OUTPUT_FORMAT, type ImageMode } from "./httpGateway";
import { createAiRunGateway, modeManifestUrl } from "./gatewayForMode";
import type { AiOperation } from "./types";
import { completeImageStudioAiOperation } from "../projects/projectClient";
import type { MessageKey } from "../i18n";
import { trapDialogFocus } from "../studio/dialogFocus";

interface Props {
  layer: RasterLayer;
  pixelSelection?: PixelSelection | null;
  maskLayer?: DrawingLayer | null;
  maskInverted?: boolean;
  maskFeatherPx?: number;
  language: string;
  revision: string;
  projectId: string;
  projectRevision: number;
  initialOperation?: AiOperation | null;
  currentRevision: () => string;
  onApply: (image: DecodedImage, baseRevision: string, operation: AiOperation) => string | Promise<string>;
  onClose: () => void;
  t: (key: MessageKey) => string;
}

export function AiEditDialog({ layer, pixelSelection, maskLayer, maskInverted, maskFeatherPx, language, revision, projectId, projectRevision, initialOperation, currentRevision, onApply, onClose, t }: Props): JSX.Element {
  const [modes, setModes] = useState<ImageMode[]>([]);
  const [modeId, setModeId] = useState("");
  const [parameters, setParameters] = useState<Record<string, string>>({});
  const [operation, setOperation] = useState<AiOperation | null>(initialOperation ?? null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const controllerRef = useRef<AbortController | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const orchestrator = useMemo(() => new AiEditOrchestrator({ gateway: createAiRunGateway(), currentRevision }), [currentRevision]);
  const selectedMode = modes.find((mode) => mode.id === modeId);
  // Both local boundaries must constrain the submitted image mask.
  const hasMaskInput = Boolean(pixelSelection || maskLayer);

  useEffect(() => {
    const previousFocus = window.document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => previousFocus?.focus();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetchImageModes(language, controller.signal, modeManifestUrl()).then((available) => {
      setModes(available);
      setModeId(initialOperation?.mode ?? available[0]?.id ?? "");
      if (initialOperation) setParameters(initialOperation.parameters);
      setLoading(false);
    }).catch((reason) => { if (!controller.signal.aborted) { setError((reason as Error).message); setLoading(false); } });
    return () => controller.abort();
  }, [initialOperation, language]);

  useEffect(() => {
    if (operation && operation.mode === selectedMode?.id) setParameters(operation.parameters);
    else setParameters({
      ...Object.fromEntries((selectedMode?.fields ?? []).map((field) => [field.id, field.default ?? field.options?.[0] ?? ""])),
      output_format: IMAGE_STUDIO_AI_OUTPUT_FORMAT,
    });
  }, [selectedMode?.id]);

  const run = async () => {
    if (!selectedMode || busy) return;
    setError("");
    const controller = new AbortController();
    controllerRef.current = controller;
    const resumable = operation && isRecoverableOperation(operation, selectedMode.id) ? operation : null;
    const next = resumable ?? orchestrator.createOperation({
      id: createId("ai-operation"), projectId, baseRevision: projectRevision, mode: selectedMode.id,
      inputLayerId: layer.id, maskLayerId: selectedMode.maskField ? maskLayer?.id ?? null : null, parameters, baseDocumentRevision: revision,
      retryOf: operation?.id ?? null, recipeId: null, stepIndex: null,
    });
    setOperation({ ...next, status: next.runId ? "running" : "submitting" });
    setBusy(true);
    try {
      const input = next.runId ? new Blob() : await rasterSourceToBlob(layer);
      const mask = next.runId || !selectedMode.maskField ? undefined
        : maskLayer ? { field: selectedMode.maskField, file: await maskInputFromLayer(maskLayer, { inverted: maskInverted, featherPx: maskFeatherPx }, pixelSelection) }
          : pixelSelection ? { field: selectedMode.maskField, file: await maskInputFromSelection(pixelSelection) } : undefined;
      if (selectedMode.maskRequired && !mask && !next.runId) throw new Error(t("aiMaskRequired"));
      const outcome = await orchestrator.run(next, input, controller.signal, mask);
      setOperation(outcome.operation);
      if (["failed", "delivery-failed"].includes(outcome.operation.status)) setError(outcome.operation.error || "AI edit failed");
      if (outcome.operation.status === "stale") setError("The document changed. The AI result was not applied.");
      if (outcome.result) {
        const resultLayerId = await onApply(await decodeBlob(outcome.result, `${selectedMode.label} result`), revision, outcome.operation);
        await completeImageStudioAiOperation(projectId, outcome.operation.id, resultLayerId);
        setOperation({ ...outcome.operation, resultLayerId });
      }
    } catch (reason) {
      const message = (reason as Error).message;
      setError(message);
      setOperation({ ...next, status: next.runId ? "delivery-failed" : "failed", error: message });
    } finally {
      controllerRef.current = null;
      setBusy(false);
    }
  };

  const canResume = selectedMode ? isRecoverableOperation(operation, selectedMode.id) : false;
  return <div className="pixel-editor-backdrop" role="dialog" aria-modal="true" aria-labelledby="ai-edit-title">
    <div ref={dialogRef} className="pixel-editor ai-editor" onKeyDown={(event) => trapDialogFocus(event.nativeEvent, dialogRef.current)}>
      <header><h2 id="ai-edit-title">{t("aiTitle")}</h2>
        <button ref={closeRef} onClick={onClose} disabled={busy}>{t("close")}</button>
        {busy ? <button className="danger" onClick={() => controllerRef.current?.abort()}>{t("stopWaiting")}</button>
          : <button className="primary" disabled={!selectedMode || Boolean(selectedMode.maskRequired && !hasMaskInput)} onClick={() => void run()}>{canResume ? t("resume") : operation ? t("retry") : t("run")}</button>}
      </header>
      <nav>
        {modes.map((mode) => <button key={mode.id} className={mode.id === modeId ? "active" : ""} disabled={busy} onClick={() => setModeId(mode.id)}><strong>{mode.label}</strong></button>)}
        {!loading && !modes.length && <p>{t("noModes")}</p>}
      </nav>
      <main>
        <div className="pixel-canvas-wrap">
          {loading ? <p role="status">{t("loadingModels")}</p> : <img src={rasterSourceUrl(layer.source)} alt="" />}
          {!loading && operation && <p className={`ai-status status-${operation.status}`} role="status">{t("status")}: {t(operationStatusKey(operation.status))}{operation.runId ? ` · ${operation.runId}` : ""}</p>}
        </div>
        <aside>
          {!loading && selectedMode?.fields.map((field) => <label key={field.id}>{field.label}
            {field.options ? <select value={parameters[field.id] ?? ""} disabled={busy} onChange={(event) => setParameters((value) => ({ ...value, [field.id]: event.target.value }))}>
              {field.options.map((option) => <option key={option} value={option}>{field.optionLabels?.[option] ?? option}</option>)}
            </select> : field.type === "textarea"
              ? <textarea value={parameters[field.id] ?? ""} placeholder={field.placeholder} disabled={busy} onChange={(event) => setParameters((value) => ({ ...value, [field.id]: event.target.value }))} />
              : <input value={parameters[field.id] ?? ""} placeholder={field.placeholder} disabled={busy} onChange={(event) => setParameters((value) => ({ ...value, [field.id]: event.target.value }))} />}
          </label>)}
          {!loading && selectedMode?.maskField && <p className="ai-mask-hint">{hasMaskInput ? t("aiMaskActive") : t("aiMaskRequired")}</p>}
          {error && <p className="ai-error" role="alert">{error}</p>}
        </aside>
      </main>
    </div>
  </div>;
}

function operationStatusKey(status: AiOperation["status"]): MessageKey {
  return ({ draft: "statusDraft", submitting: "statusSubmitting", running: "statusRunning", "result-ready": "statusResultReady", succeeded: "statusSucceeded",
    failed: "statusFailed", "delivery-failed": "statusDeliveryFailed", cancelled: "statusCancelled", stale: "statusStale" } as const)[status];
}

function isRecoverableOperation(operation: AiOperation | null, modeId: string): boolean {
  return Boolean(operation && operation.mode === modeId
    && ["submitting", "running", "result-ready", "delivery-failed", "cancelled"].includes(operation.status));
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [header, encoded] = dataUrl.split(",", 2);
  const mimeType = /^data:([^;,]+)/.exec(header)?.[1] || "image/png";
  const bytes = atob(encoded);
  const value = new Uint8Array(bytes.length);
  for (let index = 0; index < bytes.length; index += 1) value[index] = bytes.charCodeAt(index);
  return new Blob([value], { type: mimeType });
}

async function rasterSourceToBlob(layer: RasterLayer): Promise<Blob> {
  if (layer.source.kind === "data-url") return dataUrlToBlob(layer.source.value);
  const response = await fetch(rasterSourceUrl(layer.source));
  if (!response.ok) throw new Error(`Project asset download failed: ${response.status}`);
  return response.blob();
}

function decodeBlob(blob: Blob, name: string): Promise<DecodedImage> {
  return new Promise((resolve, reject) => {
    const dataUrl = URL.createObjectURL(blob);
    const image = new Image();
    image.onerror = () => { URL.revokeObjectURL(dataUrl); reject(new Error("AI result is not a valid image")); };
    image.onload = () => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("AI result could not be read"));
      reader.onload = () => resolve({ dataUrl: String(reader.result), mimeType: blob.type || "image/png", width: image.naturalWidth, height: image.naturalHeight, name });
      reader.readAsDataURL(blob);
      URL.revokeObjectURL(dataUrl);
    };
    image.src = dataUrl;
  });
}
