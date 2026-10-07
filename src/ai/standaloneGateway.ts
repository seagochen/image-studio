import { isAiEditorMode } from "./editorProfiles";
import type { AiOperation, AiRunGateway, AiRunStatus } from "./types";

/**
 * Standalone AI adapter. The browser talks only to the Image Studio container
 * (/local-ai/*); the container holds the skillsmaster customer key, records the
 * operation and persists result bytes so a reconnect or restart can resume. It never
 * uses the platform's operation pre-registration or X-Image-Studio-Operation-Id.
 */
export const STANDALONE_MODE_MANIFEST_URL = "/local-ai/mode-manifest";

export class StandaloneAiRunGateway implements AiRunGateway {
  async submit(operation: AiOperation, input: Blob, signal: AbortSignal, secondary?: { field: string; file: Blob }): Promise<string> {
    if (!isAiEditorMode(operation.mode)) throw new Error("This AI mode is not available in Image Studio");
    const form = new FormData();
    form.append("operation", JSON.stringify({
      id: operation.id, baseRevision: operation.baseRevision, mode: operation.mode, inputLayerId: operation.inputLayerId,
      maskLayerId: operation.maskLayerId, parameters: operation.parameters, retryOf: operation.retryOf,
      recipeId: operation.recipeId, stepIndex: operation.stepIndex,
    }));
    form.append("file", input, "image.png");
    if (secondary) {
      form.append("mask_field", secondary.field);
      form.append("mask", secondary.file, "mask.png");
    }
    const response = await fetch(`/local-ai/projects/${encodeURIComponent(operation.projectId)}/operations`, { method: "POST", body: form, signal });
    const body = await safeJson(response);
    if (!response.ok) throw new Error(detail(body, `AI run submission failed: ${response.status}`));
    if (typeof body.runId !== "string") throw new Error("AI run response has no run id");
    return body.runId;
  }

  async status(runId: string, signal: AbortSignal): Promise<AiRunStatus> {
    const response = await fetch(`/local-ai/runs/${encodeURIComponent(runId)}`, { signal });
    const body = await safeJson(response);
    if (!response.ok) throw new Error(detail(body, `AI run status failed: ${response.status}`));
    return { status: String(body.status), resultReady: body.resultReady === true, message: typeof body.message === "string" ? body.message : undefined };
  }

  async result(runId: string, signal: AbortSignal): Promise<Blob> {
    let response: Response;
    try {
      response = await fetch(`/local-ai/runs/${encodeURIComponent(runId)}/result`, { signal });
    } catch {
      throw new Error("AI result download could not reach the server");
    }
    if (!response.ok) throw new Error(detail(await safeJson(response), `AI result download failed: ${response.status}`));
    return response.blob();
  }
}

async function safeJson(response: Response): Promise<Record<string, unknown>> {
  try { return await response.json() as Record<string, unknown>; } catch { return {}; }
}

function detail(body: Record<string, unknown>, fallback: string): string {
  return typeof body.detail === "string" ? body.detail : fallback;
}
