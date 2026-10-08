import { cloneDocument, parseDocument, type ImageStudioDocument, type RasterLayer } from "../domain/document";
import type { AiOperation } from "../ai/types";
import { parseImageStudioAiOperation } from "../shared/imageStudioAiOperationContract";

export interface ProjectSummary {
  id: string;
  title: string;
  documentVersion: number;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

interface ProjectAsset {
  id: string;
  mimeType: string;
  width: number;
  height: number;
  sizeBytes: number;
  url: string;
}

export interface OpenProject extends ProjectSummary {
  document: ImageStudioDocument;
  operations: AiOperation[];
}

export class ProjectConflictError extends Error {
  constructor(public readonly currentRevision: number) { super("Project was changed in another session"); }
}

export async function listImageStudioProjects(signal?: AbortSignal): Promise<ProjectSummary[]> {
  const response = await fetch("/image-studio/projects", { signal });
  const body = await json(response);
  if (!response.ok) throw new Error(detail(body, "Project list failed"));
  return Array.isArray(body.items) ? body.items as ProjectSummary[] : [];
}

export async function openImageStudioProject(projectId: string, signal?: AbortSignal): Promise<OpenProject> {
  const response = await fetch(`/image-studio/projects/${encodeURIComponent(projectId)}`, { signal });
  const body = await json(response);
  if (!response.ok) throw new Error(detail(body, "Project open failed"));
  const assets = new Map((body.assets as ProjectAsset[] | undefined ?? []).map((asset) => [asset.id, asset]));
  const document = hydrateDocument(body.document, assets, projectId);
  const operations = Array.isArray(body.operations) ? body.operations.map((value): AiOperation => {
    const operation = parseImageStudioAiOperation(value);
    return { ...operation, baseDocumentRevision: `${body.id}:${operation.baseRevision}` };
  }) : [];
  return { ...(body as unknown as ProjectSummary), document, operations };
}

export async function saveImageStudioProject(
  projectId: string,
  revision: number,
  document: ImageStudioDocument,
  retainedAssetIds: string[] = [],
): Promise<{ project: ProjectSummary; document: ImageStudioDocument }> {
  const id = projectId;

  const uploaded = cloneDocument(document);
  const stagedIds: string[] = [];
  try {
    for (let index = 0; index < uploaded.layers.length; index += 1) {
      const layer = uploaded.layers[index];
      if (layer.type !== "raster" || layer.source.kind !== "data-url") continue;
      uploaded.layers[index] = await uploadRasterLayer(id, layer);
      const source = (uploaded.layers[index] as RasterLayer).source;
      if (source.kind === "asset") stagedIds.push(source.assetId);
    }
    const response = await fetch(`/image-studio/projects/${encodeURIComponent(id)}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: uploaded.title,
        revision,
        document: projectDocumentForSave(uploaded),
        retainedAssetIds,
      }),
    });
    const saved = await json(response);
    if (response.status === 409) throw new ProjectConflictError(Number(saved.currentRevision));
    if (!response.ok) throw new Error(detail(saved, "Project save failed"));
    return { project: saved as unknown as ProjectSummary, document: uploaded };
  } catch (error) {
    await Promise.allSettled(stagedIds.map((assetId) => fetch(`/image-studio/projects/${encodeURIComponent(id!)}/assets/${encodeURIComponent(assetId)}`, { method: "DELETE" })));
    throw error;
  }
}

/** Creation is separate so callers retain identity even if subsequent uploads fail. */
export async function createImageStudioProject(document: ImageStudioDocument): Promise<ProjectSummary> {
  const skeleton = { ...cloneDocument(document), layers: [], selection: { layerId: null } };
  const response = await fetch("/image-studio/projects", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: document.title, document: skeleton }),
  });
  const created = await json(response);
  if (!response.ok) throw new Error(detail(created, "Project creation failed"));
  if (typeof created.id !== "string" || !created.id || !Number.isInteger(created.revision) || Number(created.revision) < 1) {
    throw new Error("Project creation response has no valid identity");
  }
  return created as unknown as ProjectSummary;
}

export async function completeImageStudioAiOperation(projectId: string, operationId: string, resultLayerId: string): Promise<void> {
  const response = await fetch(`/image-studio/projects/${encodeURIComponent(projectId)}/operations/${encodeURIComponent(operationId)}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resultLayerId }),
  });
  if (!response.ok) throw new Error("AI operation result could not be linked to the project");
}

export function projectDocumentForSave(document: ImageStudioDocument): ImageStudioDocument {
  const saved = cloneDocument(document);
  for (const layer of saved.layers) {
    if (layer.type === "raster" && layer.source.kind === "asset") delete (layer.source as { url?: string }).url;
  }
  return saved;
}

async function uploadRasterLayer(projectId: string, layer: RasterLayer): Promise<RasterLayer> {
  if (layer.source.kind !== "data-url") return layer;
  const blob = dataUrlToBlob(layer.source.value);
  const response = await fetch(`/image-studio/projects/${encodeURIComponent(projectId)}/assets`, {
    method: "POST", headers: { "Content-Type": layer.source.mimeType }, body: blob,
  });
  const asset = await json(response) as unknown as ProjectAsset;
  if (!response.ok) throw new Error(detail(asset as unknown as Record<string, unknown>, "Asset upload failed"));
  return { ...layer, width: asset.width, height: asset.height, source: {
    kind: "asset", assetId: asset.id, mimeType: asset.mimeType, url: projectAssetUrl(projectId, asset.id),
  } };
}

function hydrateDocument(value: unknown, assets: Map<string, ProjectAsset>, projectId: string): ImageStudioDocument {
  const document = value as ImageStudioDocument;
  for (const layer of document.layers ?? []) {
    if (layer.type !== "raster" || layer.source.kind !== "asset") continue;
    const asset = assets.get(layer.source.assetId);
    if (!asset) throw new Error("Project references a missing asset");
    layer.source.url = projectAssetUrl(projectId, asset.id);
  }
  return parseDocument(JSON.stringify(document));
}

function projectAssetUrl(projectId: string, assetId: string): string {
  const path = `/image-studio/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(assetId)}`;
  return new URL(path, window.location.origin).toString();
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [header, encoded] = dataUrl.split(",", 2);
  const mimeType = /^data:([^;,]+)/.exec(header)?.[1] || "image/png";
  const bytes = atob(encoded);
  const value = new Uint8Array(bytes.length);
  for (let index = 0; index < bytes.length; index += 1) value[index] = bytes.charCodeAt(index);
  return new Blob([value], { type: mimeType });
}

async function json(response: Response): Promise<Record<string, unknown>> {
  try { return await response.json() as Record<string, unknown>; } catch { return {}; }
}

function detail(body: Record<string, unknown>, fallback: string): string {
  return typeof body.detail === "string" ? body.detail : fallback;
}
