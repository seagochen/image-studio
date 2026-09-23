import { cloneDocument, parseDocument, type ImageStudioDocument } from "../domain/document";

export interface ProjectDraft {
  key: string;
  projectId: string | null;
  baseRevision: number | null;
  savedAt: string;
  document: ImageStudioDocument;
}

export type DraftRecovery = "none" | "restore" | "restore-as-copy";

export function draftRecovery(draft: ProjectDraft | null, remote: { revision: number; document: ImageStudioDocument } | null): DraftRecovery {
  if (!draft) return "none";
  if (!remote) return draft.projectId === null ? "restore" : "restore-as-copy";
  if (draft.document.metadata.updatedAt <= remote.document.metadata.updatedAt) return "none";
  return draft.baseRevision === remote.revision ? "restore" : "restore-as-copy";
}

export class BrowserDraftStore {
  private readonly databaseName = "skillsmaster-image-studio";

  async put(draft: ProjectDraft): Promise<void> {
    const database = await this.open();
    await requestComplete(database.transaction("drafts", "readwrite").objectStore("drafts").put({ ...draft, document: cloneDocument(draft.document) }));
  }

  async get(key: string): Promise<ProjectDraft | null> {
    const database = await this.open();
    const value = await requestComplete(database.transaction("drafts").objectStore("drafts").get(key));
    return parseDraft(value);
  }

  async latestUnsaved(): Promise<ProjectDraft | null> {
    const database = await this.open();
    const values = await requestComplete(database.transaction("drafts").objectStore("drafts").getAll()) as unknown[];
    return values.map(parseDraft).filter((value): value is ProjectDraft => Boolean(value && value.projectId === null))
      .sort((left, right) => right.savedAt.localeCompare(left.savedAt))[0] ?? null;
  }

  async delete(key: string): Promise<void> {
    const database = await this.open();
    await requestComplete(database.transaction("drafts", "readwrite").objectStore("drafts").delete(key));
  }

  private open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.databaseName, 1);
      request.onupgradeneeded = () => request.result.createObjectStore("drafts", { keyPath: "key" });
      request.onerror = () => reject(request.error ?? new Error("Local draft storage is unavailable"));
      request.onsuccess = () => resolve(request.result);
    });
  }
}

function parseDraft(value: unknown): ProjectDraft | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<ProjectDraft>;
  if (typeof candidate.key !== "string" || (candidate.projectId !== null && typeof candidate.projectId !== "string")
    || (candidate.baseRevision !== null && typeof candidate.baseRevision !== "number") || typeof candidate.savedAt !== "string") return null;
  try { return { ...candidate, document: parseDocument(JSON.stringify(candidate.document)) } as ProjectDraft; } catch { return null; }
}

function requestComplete<T = unknown>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Local draft storage failed"));
  });
}
