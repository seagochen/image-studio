import type { AiRunGateway, AiRunStatus } from "./types";
import { appSessionHeaders } from "../../../shared/auth";

export interface ImageMode {
  id: string;
  label: string;
  /** A manifest-declared image mask input. Image Studio never invents this capability. */
  maskField?: string;
  maskRequired?: boolean;
  fields: Array<{
    id: string;
    label: string;
    type?: "text" | "textarea" | "select";
    options?: string[];
    optionLabels?: Record<string, string>;
    default?: string;
    placeholder?: string;
  }>;
}

export const IMAGE_STUDIO_AI_OUTPUT_FORMAT = "png";

export async function fetchImageModes(language: string, signal?: AbortSignal): Promise<ImageMode[]> {
  const response = await fetch(`/mode-manifest?lang=${encodeURIComponent(language)}`, { signal });
  if (!response.ok) throw new Error(`Mode manifest request failed: ${response.status}`);
  const manifest = await response.json() as { modes?: Record<string, any>; fields?: Record<string, any> };
  return Object.entries(manifest.modes ?? {}).flatMap(([id, mode]) => {
    const maskField = mode.secondary?.field === "mask_file" && mode.secondary?.mediaKind === "image" ? "mask_file" : undefined;
    if (!mode.enabled || (mode.input && mode.input !== "upload") || (mode.mediaKind && mode.mediaKind !== "image") || (mode.resultKind && mode.resultKind !== "image") || (mode.secondary && !maskField)) return [];
    return [{ id, label: String(mode.label || id), ...(maskField ? { maskField, maskRequired: mode.secondary.required === true } : {}), fields: (mode.fields ?? []).filter((fieldId: string) => fieldId !== "output_format").map((fieldId: string) => {
      const field = mode.fieldOverrides?.[fieldId] ?? manifest.fields?.[fieldId] ?? {};
      return {
        id: fieldId,
        label: String(field.label || fieldId),
        type: field.type,
        options: field.options,
        optionLabels: field.optionLabels,
        default: field.default,
        placeholder: field.placeholder,
      };
    }) }];
  });
}

export class HttpAiRunGateway implements AiRunGateway {
  async submit(
    operation: import("./types").AiOperation, input: Blob, signal: AbortSignal,
    secondary?: { field: string; file: Blob },
  ): Promise<string> {
    const preparedResponse = await fetch(`/image-studio/projects/${encodeURIComponent(operation.projectId)}/operations`, {
      method: "POST", headers: { "Content-Type": "application/json" }, signal,
      body: JSON.stringify({
        id: operation.id, baseRevision: operation.baseRevision, inputLayerId: operation.inputLayerId,
        maskLayerId: operation.maskLayerId, mode: operation.mode, parameters: operation.parameters,
        retryOf: operation.retryOf, recipeId: operation.recipeId, stepIndex: operation.stepIndex,
      }),
    });
    const prepared = await safeJson(preparedResponse);
    if (!preparedResponse.ok) throw new Error(typeof prepared.detail === "string" ? prepared.detail : `AI operation preparation failed: ${preparedResponse.status}`);
    const existingRunId = typeof prepared.operation === "object" && prepared.operation && typeof prepared.operation.runId === "string"
      ? prepared.operation.runId : null;
    if (existingRunId) return existingRunId;
    const form = new FormData();
    form.append("mode", operation.mode);
    form.append("file", input, "image.png");
    if (secondary) form.append(secondary.field, secondary.file, "mask.png");
    Object.entries(operation.parameters).forEach(([key, value]) => { if (value !== "") form.append(key, value); });
    const response = await fetch("/v1/runs", { method: "POST", headers: {
      ...appSessionHeaders("image-studio"), "Idempotency-Key": operation.id, "X-Image-Studio-Operation-Id": operation.id,
    }, body: form, signal });
    const body = await safeJson(response);
    if (!response.ok) throw new Error(typeof body.detail === "string" ? body.detail : `AI run submission failed: ${response.status}`);
    if (typeof body.run_id !== "string") throw new Error("AI run response has no run_id");
    return body.run_id;
  }

  async status(runId: string, signal: AbortSignal): Promise<AiRunStatus> {
    const response = await fetch(`/v1/runs/${encodeURIComponent(runId)}`, { headers: appSessionHeaders("image-studio"), signal });
    const body = await safeJson(response);
    if (!response.ok) throw new Error(typeof body.detail === "string" ? body.detail : `AI run status failed: ${response.status}`);
    return { status: String(body.status), resultReady: body.result_ready === true, message: typeof body.message === "string" ? body.message : undefined };
  }

  async result(runId: string, signal: AbortSignal): Promise<Blob> {
    const response = await fetch(`/v1/runs/${encodeURIComponent(runId)}/result`, { headers: appSessionHeaders("image-studio"), signal });
    const body = await safeJson(response);
    if (!response.ok || typeof body.url !== "string") throw new Error(`AI result delivery failed: ${response.status}`);
    const resultUrl = typeof body.content_url === "string" ? body.content_url : body.url;
    let artifact: Response;
    try {
      artifact = await fetch(resultUrl, { headers: resultUrl.startsWith("/v1/") ? appSessionHeaders("image-studio") : {}, signal });
    } catch {
      throw new Error("AI result download could not reach the server");
    }
    if (!artifact.ok) {
      const failure = await safeJson(artifact);
      throw new Error(typeof failure.detail === "string" ? failure.detail : `AI result download failed: ${artifact.status}`);
    }
    return artifact.blob();
  }
}

async function safeJson(response: Response): Promise<Record<string, any>> {
  try { return await response.json() as Record<string, any>; }
  catch { return {}; }
}
