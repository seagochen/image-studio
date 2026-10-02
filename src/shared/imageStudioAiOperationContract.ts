export const IMAGE_STUDIO_AI_OPERATION_STATUSES = [
  "draft", "submitting", "running", "result-ready", "succeeded", "failed", "delivery-failed", "cancelled", "stale",
] as const;

export type ImageStudioAiOperationStatus = typeof IMAGE_STUDIO_AI_OPERATION_STATUSES[number];

export interface ImageStudioAiOperationDto {
  id: string;
  projectId: string;
  baseRevision: number;
  mode: string;
  inputLayerId: string;
  maskLayerId: string | null;
  parameters: Record<string, string>;
  runId: string | null;
  status: ImageStudioAiOperationStatus;
  resultLayerId: string | null;
  error: string | null;
  retryOf: string | null;
  recipeId: string | null;
  stepIndex: number | null;
  createdAt: string;
  updatedAt: string;
}

const STATUS_SET = new Set<string>(IMAGE_STUDIO_AI_OPERATION_STATUSES);

export function parseImageStudioAiOperation(value: unknown): ImageStudioAiOperationDto {
  const operation = record(value, "AI operation");
  return {
    id: text(operation.id, "id"),
    projectId: text(operation.projectId, "projectId"),
    baseRevision: integer(operation.baseRevision, "baseRevision"),
    mode: text(operation.mode, "mode"),
    inputLayerId: text(operation.inputLayerId, "inputLayerId"),
    maskLayerId: nullableText(operation.maskLayerId, "maskLayerId"),
    parameters: stringRecord(operation.parameters, "parameters"),
    runId: nullableText(operation.runId, "runId"),
    status: status(operation.status),
    resultLayerId: nullableText(operation.resultLayerId, "resultLayerId"),
    error: nullableText(operation.error, "error"),
    retryOf: nullableText(operation.retryOf, "retryOf"),
    recipeId: nullableText(operation.recipeId, "recipeId"),
    stepIndex: nullableInteger(operation.stepIndex, "stepIndex"),
    createdAt: text(operation.createdAt, "createdAt"),
    updatedAt: text(operation.updatedAt, "updatedAt"),
  };
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid(field);
  return value as Record<string, unknown>;
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || !value) throw invalid(field);
  return value;
}

function nullableText(value: unknown, field: string): string | null {
  return value === null ? null : text(value, field);
}

function integer(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw invalid(field);
  return value;
}

function nullableInteger(value: unknown, field: string): number | null {
  return value === null ? null : integer(value, field);
}

function stringRecord(value: unknown, field: string): Record<string, string> {
  const values = record(value, field);
  if (Object.values(values).some((entry) => typeof entry !== "string")) throw invalid(field);
  return values as Record<string, string>;
}

function status(value: unknown): ImageStudioAiOperationStatus {
  if (typeof value !== "string" || !STATUS_SET.has(value)) throw invalid("status");
  return value as ImageStudioAiOperationStatus;
}

function invalid(field: string): Error {
  return new Error(`Invalid Image Studio AI operation field: ${field}`);
}
