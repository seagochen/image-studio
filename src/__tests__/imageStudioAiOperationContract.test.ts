import { IMAGE_STUDIO_AI_OPERATION_STATUSES, parseImageStudioAiOperation } from "../../../../frontend/src/shared/imageStudioAiOperationContract";

const operation = {
  id: "operation-1", projectId: "project-1", baseRevision: 3, mode: "deblur", inputLayerId: "layer-1",
  maskLayerId: null, parameters: { strength: "medium" }, runId: null, status: "submitting", resultLayerId: null,
  error: null, retryOf: null, recipeId: null, stepIndex: null, createdAt: "2026-09-15T00:00:00Z", updatedAt: "2026-09-15T00:00:00Z",
};

describe("Image Studio AI operation wire contract", () => {
  it.each(IMAGE_STUDIO_AI_OPERATION_STATUSES)("accepts status %s", (status) => {
    expect(parseImageStudioAiOperation({ ...operation, status }).status).toBe(status);
  });

  it.each([
    ["unknown status", { ...operation, status: "success" }],
    ["non-string parameter", { ...operation, parameters: { strength: 1 } }],
    ["missing identifier", { ...operation, id: undefined }],
  ])("rejects %s", (_label, value) => {
    expect(() => parseImageStudioAiOperation(value)).toThrow("Invalid Image Studio AI operation field");
  });
});
