import { AiEditOrchestrator } from "../ai/orchestrator";
import type { AiRunGateway, AiRunStatus } from "../ai/types";

class FakeGateway implements AiRunGateway {
  submitted: Array<{ mode: string; parameters: Record<string, string>; secondary?: { field: string; file: Blob } }> = [];
  resultCalls = 0;
  statuses: AiRunStatus[] = [{ status: "pending", resultReady: false }, { status: "success", resultReady: true }];
  async submit(operation: import("../ai/types").AiOperation, _input: Blob, _signal: AbortSignal, secondary?: { field: string; file: Blob }): Promise<string> {
    this.submitted.push({ mode: operation.mode, parameters: operation.parameters, secondary });
    return `run-${this.submitted.length}`;
  }
  async status(): Promise<AiRunStatus> { return this.statuses.shift() ?? { status: "success", resultReady: true }; }
  async result(): Promise<Blob> { this.resultCalls += 1; return new Blob(["result"], { type: "image/png" }); }
}

const baseOperation = {
  id: "operation-1", projectId: "project-1", baseRevision: 1, mode: "denoise", inputLayerId: "layer-1", maskLayerId: null,
  parameters: { strength: "medium" }, baseDocumentRevision: "revision-1",
  retryOf: null, recipeId: null, stepIndex: null,
};

describe("AI edit orchestrator", () => {
  it("submits, polls and returns a non-destructive result artifact", async () => {
    const gateway = new FakeGateway();
    const orchestrator = new AiEditOrchestrator({ gateway, currentRevision: () => "revision-1", wait: async () => undefined });
    const outcome = await orchestrator.run(orchestrator.createOperation(baseOperation), new Blob(["input"]));
    expect(outcome.operation).toMatchObject({ runId: "run-1", status: "succeeded", inputLayerId: "layer-1", parameters: { strength: "medium" } });
    expect(outcome.result).toBeInstanceOf(Blob);
    expect(gateway.submitted).toEqual([{ mode: "denoise", parameters: { strength: "medium" }, secondary: undefined }]);
  });

  it("passes an already-encoded mask only to the initial submission", async () => {
    const gateway = new FakeGateway();
    gateway.statuses = [{ status: "success", resultReady: true }];
    const orchestrator = new AiEditOrchestrator({ gateway, currentRevision: () => "revision-1", wait: async () => undefined });
    const mask = { field: "mask_file", file: new Blob(["mask"], { type: "image/png" }) };
    await orchestrator.run(orchestrator.createOperation(baseOperation), new Blob(["input"]), new AbortController().signal, mask);
    expect(gateway.submitted[0].secondary).toBe(mask);
  });

  it("marks a late result stale instead of returning it for application", async () => {
    const gateway = new FakeGateway();
    const orchestrator = new AiEditOrchestrator({ gateway, currentRevision: () => "revision-2", wait: async () => undefined });
    const outcome = await orchestrator.run(orchestrator.createOperation(baseOperation), new Blob(["input"]));
    expect(outcome.operation.status).toBe("stale");
    expect(outcome.result).toBeUndefined();
  });

  it("preserves failure state and supports a sequential multi-model recipe", async () => {
    const failedGateway = new FakeGateway();
    failedGateway.statuses = [{ status: "failed", resultReady: false, message: "model unavailable" }];
    const failed = new AiEditOrchestrator({ gateway: failedGateway, currentRevision: () => "revision-1", wait: async () => undefined });
    const failure = await failed.run(failed.createOperation(baseOperation), new Blob(["input"]));
    expect(failure.operation).toMatchObject({ status: "failed", error: "model unavailable" });

    const gateway = new FakeGateway();
    gateway.statuses = [{ status: "success", resultReady: true }, { status: "success", resultReady: true }];
    const orchestrator = new AiEditOrchestrator({ gateway, currentRevision: () => "revision-1", wait: async () => undefined });
    const recipe = await orchestrator.runRecipe([
      { id: "step-1", mode: "denoise", parameters: {} },
      { id: "step-2", mode: "upscale", parameters: { scale: "2" } },
    ], orchestrator.createOperation(baseOperation), new Blob(["input"]));
    expect(recipe.operations.map((operation) => operation.status)).toEqual(["succeeded", "succeeded"]);
    expect(gateway.submitted.map(({ mode }) => mode)).toEqual(["denoise", "upscale"]);
  });

  it("reports cancellation without a result", async () => {
    const controller = new AbortController();
    const gateway = new FakeGateway();
    const orchestrator = new AiEditOrchestrator({ gateway, currentRevision: () => "revision-1", wait: async () => { controller.abort(); throw new DOMException("Aborted", "AbortError"); } });
    const outcome = await orchestrator.run(orchestrator.createOperation(baseOperation), new Blob(["input"]), controller.signal);
    expect(outcome.operation.status).toBe("cancelled");
    expect(outcome.result).toBeUndefined();
  });

  it("resumes a persisted run without submitting or charging again", async () => {
    const gateway = new FakeGateway();
    gateway.statuses = [{ status: "success", resultReady: false }];
    const orchestrator = new AiEditOrchestrator({ gateway, currentRevision: () => "revision-1", wait: async () => undefined });
    const existing = { ...orchestrator.createOperation(baseOperation), runId: "persisted-run", status: "running" as const };
    const outcome = await orchestrator.run(existing, new Blob(["input"]));
    expect(outcome.operation).toMatchObject({ runId: "persisted-run", status: "succeeded" });
    expect(gateway.submitted).toHaveLength(0);
    expect(gateway.resultCalls).toBe(1);
  });

  it("downloads a server-confirmed result without polling or submitting again", async () => {
    const gateway = new FakeGateway();
    gateway.status = jest.fn(async () => { throw new Error("status should not be polled"); });
    const orchestrator = new AiEditOrchestrator({ gateway, currentRevision: () => "revision-1", wait: async () => undefined });
    const existing = { ...orchestrator.createOperation(baseOperation), runId: "persisted-run", status: "result-ready" as const };

    const outcome = await orchestrator.run(existing, new Blob());

    expect(outcome.operation).toMatchObject({ runId: "persisted-run", status: "succeeded" });
    expect(gateway.submitted).toHaveLength(0);
    expect(gateway.resultCalls).toBe(1);
  });

  it("keeps a completed run resumable when only result delivery fails", async () => {
    const gateway = new FakeGateway();
    gateway.statuses = [{ status: "success", resultReady: false }];
    gateway.result = async () => { throw new Error("result stream unavailable"); };
    const orchestrator = new AiEditOrchestrator({ gateway, currentRevision: () => "revision-1", wait: async () => undefined });
    const existing = { ...orchestrator.createOperation(baseOperation), runId: "persisted-run", status: "running" as const };

    const outcome = await orchestrator.run(existing, new Blob(["input"]));

    expect(outcome.operation).toMatchObject({ runId: "persisted-run", status: "delivery-failed", error: "result stream unavailable" });
    expect(gateway.submitted).toHaveLength(0);
  });

  it("continues a recipe from completed steps and stops at the first failure", async () => {
    const gateway = new FakeGateway();
    gateway.statuses = [{ status: "failed", resultReady: false, message: "step failed" }];
    const orchestrator = new AiEditOrchestrator({ gateway, currentRevision: () => "revision-1", wait: async () => undefined });
    const completed = { ...orchestrator.createOperation({ ...baseOperation, id: "step-1" }), runId: "completed-run", status: "succeeded" as const };
    const outcome = await orchestrator.runRecipe([
      { id: "step-1", mode: "denoise", parameters: {} },
      { id: "step-2", mode: "upscale", parameters: {} },
      { id: "step-3", mode: "restore", parameters: {} },
    ], orchestrator.createOperation(baseOperation), new Blob(["input"]), new AbortController().signal, [completed]);
    expect(outcome.operations.map(({ id, status }) => [id, status])).toEqual([["step-1", "succeeded"], ["step-2", "failed"]]);
    expect(gateway.submitted.map(({ mode }) => mode)).toEqual(["upscale"]);
  });
});
