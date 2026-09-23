import type { ImageStudioDocument } from "../domain/document";
import { replaceRasterLayer } from "../domain/commands";

export interface ConventionalEditorInput {
  sourceUrl: string;
  mimeType: string;
  width: number;
  height: number;
  name: string;
}

export interface ConventionalEditorOutput {
  dataUrl: string;
  mimeType: string;
  width: number;
  height: number;
  resizeCanvas?: boolean;
}

export type ConventionalEditorOutcome =
  | { kind: "saved"; output: ConventionalEditorOutput }
  | { kind: "cancelled" };

export function applyConventionalEditorOutcome(
  document: ImageStudioDocument,
  layerId: string,
  outcome: ConventionalEditorOutcome,
): ImageStudioDocument {
  if (outcome.kind === "cancelled") return document;
  const replaced = replaceRasterLayer(document, layerId, {
    width: outcome.output.width,
    height: outcome.output.height,
    source: { kind: "data-url", value: outcome.output.dataUrl, mimeType: outcome.output.mimeType },
    resetPosition: outcome.output.resizeCanvas,
  });
  if (!outcome.output.resizeCanvas || replaced === document) return replaced;
  return { ...replaced, canvas: { width: outcome.output.width, height: outcome.output.height } };
}
