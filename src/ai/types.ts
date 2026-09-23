import type { ImageStudioAiOperationStatus } from "../../../../frontend/src/shared/imageStudioAiOperationContract";

export type AiOperationStatus = ImageStudioAiOperationStatus;

export interface AiOperation {
  id: string;
  projectId: string;
  baseRevision: number;
  mode: string;
  inputLayerId: string;
  maskLayerId: string | null;
  parameters: Record<string, string>;
  baseDocumentRevision: string;
  runId: string | null;
  status: AiOperationStatus;
  resultLayerId: string | null;
  error: string | null;
  retryOf: string | null;
  recipeId: string | null;
  stepIndex: number | null;
}

export interface AiRecipeStep {
  id: string;
  mode: string;
  parameters: Record<string, string>;
}

export interface AiRunStatus {
  status: string;
  resultReady: boolean;
  message?: string;
}

export interface AiRunGateway {
  submit(operation: AiOperation, input: Blob, signal: AbortSignal, secondary?: { field: string; file: Blob }): Promise<string>;
  status(runId: string, signal: AbortSignal): Promise<AiRunStatus>;
  result(runId: string, signal: AbortSignal): Promise<Blob>;
}
