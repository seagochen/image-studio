import type { AiOperation, AiRecipeStep, AiRunGateway } from "./types";

export interface OrchestratorOptions {
  gateway: AiRunGateway;
  currentRevision: () => string;
  wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  pollIntervalMs?: number;
}

export class AiEditOrchestrator {
  private readonly wait: NonNullable<OrchestratorOptions["wait"]>;

  constructor(private readonly options: OrchestratorOptions) {
    this.wait = options.wait ?? abortableWait;
  }

  createOperation(input: Omit<AiOperation, "runId" | "status" | "resultLayerId" | "error">): AiOperation {
    return { ...input, runId: null, status: "draft", resultLayerId: null, error: null };
  }

  async run(
    operation: AiOperation, input: Blob, signal = new AbortController().signal,
    secondary?: { field: string; file: Blob },
  ): Promise<{ operation: AiOperation; result?: Blob }> {
    let current: AiOperation = { ...operation, status: operation.runId ? "running" : "submitting", error: null };
    let runSucceeded = operation.status === "result-ready" || operation.status === "delivery-failed";
    try {
      const runId = current.runId ?? await this.options.gateway.submit(current, input, signal, secondary);
      current = { ...current, runId, status: "running" };
      if (!runSucceeded) {
        while (true) {
          const state = await this.options.gateway.status(runId, signal);
          if (state.status === "failed") throw new Error(state.message || "AI image edit failed");
          if (state.status === "success") { runSucceeded = true; break; }
          await this.wait(this.options.pollIntervalMs ?? 1500, signal);
        }
      }
      const result = await this.options.gateway.result(runId, signal);
      if (this.options.currentRevision() !== current.baseDocumentRevision) {
        return { operation: { ...current, status: "stale", error: "Document changed while the AI edit was running" } };
      }
      return { operation: { ...current, status: "succeeded" }, result };
    } catch (error) {
      if (signal.aborted) return { operation: { ...current, status: "cancelled", error: null } };
      return { operation: { ...current, status: runSucceeded ? "delivery-failed" : "failed", error: (error as Error).message } };
    }
  }

  async runRecipe(steps: AiRecipeStep[], operation: AiOperation, input: Blob, signal = new AbortController().signal, completed: AiOperation[] = []): Promise<{ operations: AiOperation[]; result?: Blob }> {
    const operations: AiOperation[] = [];
    let currentInput = input;
    for (let index = 0; index < steps.length; index += 1) {
      const step = steps[index];
      const prior = completed.find((item) => item.id === step.id && item.status === "succeeded" && item.runId);
      if (prior?.runId) {
        currentInput = await this.options.gateway.result(prior.runId, signal);
        operations.push(prior);
        continue;
      }
      const current = this.createOperation({ ...operation, id: step.id, mode: step.mode, parameters: step.parameters, stepIndex: index });
      const outcome = await this.run(current, currentInput, signal);
      operations.push(outcome.operation);
      if (!outcome.result) return { operations };
      currentInput = outcome.result;
    }
    return { operations, result: currentInput };
  }
}

function abortableWait(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    signal.addEventListener("abort", () => { clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); }, { once: true });
  });
}
