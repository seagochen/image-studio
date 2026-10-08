import { rasterSourceToBlob, decodeBlob } from "./imageInput";
import { aiEditorCopy, isAiEditorMode } from "./editorProfiles";
import { AiPreview } from "./AiPreview";
import { AiMaskEditor } from "./AiMaskEditor";
import type { PixelSelectionMask } from "../domain/pixelTools";
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
import type { Locale, MessageKey } from "../i18n";
import { disabledReasonCopy, hintTitle } from "../studio/disabledReasons";
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
  const copy = aiEditorCopy(language);
  const [result, setResult] = useState<DecodedImage | null>(null);
  const [localMask, setLocalMask] = useState<PixelSelectionMask | null>(null);
  const [initialMask, setInitialMask] = useState<Blob | null>(null);
  const [initialMaskHasPixels, setInitialMaskHasPixels] = useState(false);
  const [maskLoading, setMaskLoading] = useState(false);
  const [maskError, setMaskError] = useState("");
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
  const hasMaskInput = localMask ? localMask.pixels.some((value) => value > 0) : initialMaskHasPixels;
  const profile = selectedMode && isAiEditorMode(selectedMode.id) ? copy[selectedMode.id] : null;
  const canResume = selectedMode ? isRecoverableOperation(operation, selectedMode.id) : false;
  const resumingRun = canResume && Boolean(operation?.runId);
  const needsMask = selectedMode?.maskRequired && !resumingRun;
  const runBlocker = !selectedMode ? t(loading ? "loadingModels" : "noModes")
    : selectedMode.enabled === false && !resumingRun ? copy.unavailable
    : result ? (disabledReasonCopy[language as Locale] ?? disabledReasonCopy.en).resultPending
    : needsMask && (!hasMaskInput || maskLoading || maskError) ? maskError || t("aiMaskRequired") : null;
  const runLabel = canResume ? t("resume") : operation ? t("retry") : t("run");

  useEffect(() => {
    if (selectedMode?.id !== "object_remove") return;
    let active = true;
    setMaskLoading(true); setMaskError("");
    setInitialMaskHasPixels(!maskLayer && Boolean(pixelSelection?.pixels.some((value) => value > 0)));
    const mask = maskLayer ? maskInputFromLayer(maskLayer, { inverted: maskInverted, featherPx: maskFeatherPx, onCoverage: (nonEmpty) => { if (active) setInitialMaskHasPixels(nonEmpty); } }, pixelSelection)
      : pixelSelection ? maskInputFromSelection(pixelSelection) : Promise.resolve(null);
    mask.then((blob) => { if (active) { setInitialMask(blob); setMaskLoading(false); } })
      .catch((reason) => { if (active) { setMaskError((reason as Error).message); setMaskLoading(false); } });
    return () => { active = false; };
  }, [selectedMode?.id, maskLayer, pixelSelection, maskInverted, maskFeatherPx]);

  useEffect(() => {
    const previousFocus = window.document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => previousFocus?.focus();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetchImageModes(language, controller.signal, modeManifestUrl()).then((available) => {
      setModes(available);
      setModeId(available.some((mode) => mode.id === initialOperation?.mode) ? initialOperation!.mode : available.find((mode) => mode.enabled !== false)?.id ?? available[0]?.id ?? "");
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
    if (!selectedMode || (selectedMode.enabled === false && !resumingRun) || busy || (needsMask && (!hasMaskInput || maskLoading || maskError))) return;
    setError(""); setResult(null);
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
    let attempt = next;
    try {
      const input = next.runId ? new Blob() : await rasterSourceToBlob(layer);
      const mask = next.runId || !selectedMode.maskField ? undefined
        : localMask ? { field: selectedMode.maskField, file: await maskInputFromSelection(localMask) }
          : maskLayer ? { field: selectedMode.maskField, file: await maskInputFromLayer(maskLayer, { inverted: maskInverted, featherPx: maskFeatherPx }, pixelSelection) }
          : pixelSelection ? { field: selectedMode.maskField, file: await maskInputFromSelection(pixelSelection) } : undefined;
      if (selectedMode.maskRequired && !mask && !next.runId) throw new Error(t("aiMaskRequired"));
      const outcome = await orchestrator.run(next, input, controller.signal, mask);
      attempt = outcome.operation;
      setOperation(outcome.operation);
      if (["failed", "delivery-failed"].includes(outcome.operation.status)) setError(outcome.operation.error || "AI edit failed");
      if (outcome.operation.status === "stale") setError("The document changed. The AI result was not applied.");
      if (outcome.result) {
        setResult(await decodeBlob(outcome.result, `${profile?.[0] ?? selectedMode.label} result`));
        setOperation({ ...outcome.operation, status: "result-ready" });
      }
    } catch (reason) {
      const message = (reason as Error).message;
      setError(message);
      setOperation({ ...attempt, status: attempt.runId ? "delivery-failed" : "failed", error: message });
    } finally {
      controllerRef.current = null;
      setBusy(false);
    }
  };

  const applyResult = async () => {
    if (!result || !operation || busy) return;
    if (!operation.resultLayerId && currentRevision() !== operation.baseDocumentRevision) { setError(copy.stale); return; }
    setBusy(true); setError("");
    try {
      const resultLayerId = operation.resultLayerId ?? await onApply(result, revision, operation);
      // Keep the applied layer identity if completion fails, so retry never duplicates it.
      setOperation({ ...operation, resultLayerId });
      await completeImageStudioAiOperation(projectId, operation.id, resultLayerId);
      setOperation({ ...operation, status: "succeeded", resultLayerId }); setResult(null); onClose();
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  };

  const changeMode = (id: string) => { setModeId(id); setResult(null); setError(""); };
  const outputSize = selectedMode?.id === "upscale" ? expectedUpscaleSize(layer.width, layer.height, parameters) : copy.unchanged;
  return <div className="pixel-editor-backdrop" role="dialog" aria-modal="true" aria-labelledby="ai-edit-title">
    <div ref={dialogRef} className="pixel-editor ai-editor" onKeyDown={(event) => trapDialogFocus(event.nativeEvent, dialogRef.current)}>
      <header><h2 id="ai-edit-title">{t("aiTitle")}</h2>
        <button ref={closeRef} onClick={onClose} disabled={busy}>{t("close")}</button>
        {result && !operation?.resultLayerId && <button disabled={busy} onClick={() => { setResult(null); setOperation(null); setError(""); }}>{copy.adjust}</button>}
        {result && <button className="primary" disabled={busy} onClick={() => void applyResult()}>{copy.apply}</button>}
        {busy && controllerRef.current ? <button className="danger" onClick={() => controllerRef.current?.abort()}>{t("stopWaiting")}</button>
          : <button className="primary" disabled={Boolean(runBlocker)} title={hintTitle(runLabel, runBlocker)} onClick={() => void run()}>{runLabel}</button>}
      </header>
      <nav>
        {modes.map((mode) => <button key={mode.id} className={mode.id === modeId ? "active" : ""} disabled={busy || Boolean(result)} aria-pressed={mode.id === modeId} onClick={() => changeMode(mode.id)}><strong>{isAiEditorMode(mode.id) ? copy[mode.id][0] : mode.label}</strong></button>)}
        {!loading && !modes.length && <p>{t("noModes")}</p>}
      </nav>
      <main>
        <div className="ai-workspace">
          <div className="ai-workspace-heading"><h3>{profile?.[0] ?? t("aiTitle")}</h3><p>{profile?.[1]}</p></div>
          {loading ? <p role="status">{t("loadingModels")}</p> : selectedMode?.id === "object_remove" && !result
            ? maskLoading ? <p role="status">{t("loadingModels")}</p> : <AiMaskEditor width={layer.width} height={layer.height} source={rasterSourceUrl(layer.source)} initialMask={initialMask} editedMask={localMask} disabled={busy} language={language} onChange={setLocalMask} />
            : <AiPreview key={selectedMode?.id} inspectDetail={selectedMode?.id === "denoise" || selectedMode?.id === "deblur"} source={rasterSourceUrl(layer.source)} width={layer.width} height={layer.height} result={result} language={language} cutout={selectedMode?.id === "background_remove"} />}
          {operation && <p className={`ai-status status-${operation.status}`} role="status">{t("status")}: {t(operationStatusKey(operation.status))}</p>}
        </div>
        <aside>
          {selectedMode?.enabled === false && <p role="status">{copy.unavailable}</p>}
          <h3>{profile?.[2] ?? t("parameters")}</h3>
          <p>{copy.layer}: {layer.name} · {layer.width} × {layer.height}px</p>
          {selectedMode?.id === "upscale" && <output className="ai-output-size">{copy.output}: {outputSize}</output>}
          {!loading && selectedMode && !selectedMode.fields.length && <p>{copy.automatic}</p>}
          {!loading && selectedMode?.fields.map((field) => <label key={field.id}>{field.label}
            {field.options ? <select value={parameters[field.id] ?? ""} disabled={busy || Boolean(result) || selectedMode.enabled === false} onChange={(event) => setParameters((value) => ({ ...value, [field.id]: event.target.value }))}>
              {field.options.map((option) => <option key={option} value={option}>{field.optionLabels?.[option] ?? option}</option>)}
            </select> : field.type === "textarea"
              ? <textarea value={parameters[field.id] ?? ""} placeholder={field.placeholder} disabled={busy || Boolean(result) || selectedMode.enabled === false} onChange={(event) => setParameters((value) => ({ ...value, [field.id]: event.target.value }))} />
              : <input type={field.type === "number" || field.minimum !== undefined ? "number" : "text"} min={field.minimum} max={field.maximum} step="1" value={parameters[field.id] ?? ""} placeholder={field.placeholder} disabled={busy || Boolean(result) || selectedMode.enabled === false} onChange={(event) => setParameters((value) => ({ ...value, [field.id]: event.target.value }))} />}
          </label>)}
          {!loading && selectedMode?.maskField && <p className="ai-mask-hint">{hasMaskInput ? t("aiMaskActive") : t("aiMaskRequired")}</p>}
          {selectedMode?.maskRequired && !hasMaskInput && <p>{copy.maskNeeded}</p>}
          {selectedMode?.maskRequired && maskError && <p className="ai-error" role="alert">{maskError}</p>}
          <p>{copy.applyHint}</p>
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

export function expectedUpscaleSize(width: number, height: number, parameters: Record<string, string>): string {
  const longEdge = Number(parameters.long_edge) || 1920;
  const scale = parseFloat(parameters.scale) || 4;
  const factor = longEdge > 0 ? Math.min(scale, longEdge / Math.max(width, height)) : scale;
  return `${Math.round(width * factor)} × ${Math.round(height * factor)}px`;
}
