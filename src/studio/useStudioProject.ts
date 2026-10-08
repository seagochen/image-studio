import { useCallback, useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { Locale, MessageKey } from "../i18n";
import type { AiOperation } from "../ai/types";
import { createEmptyDocument, touchDocument, type ImageStudioDocument } from "../domain/document";
import { addLayer } from "../domain/commands";
import {
  documentFromImage, rasterLayerFromImage, validateImageDimensions, validateImageFile, type DecodedImage, type ImageImportError,
} from "../domain/importImage";
import { importOpenRaster } from "../projects/openRaster";
import { BrowserDraftStore, draftRecovery, type ProjectDraft, type DraftRecovery } from "../projects/draftStore";
import { parseProjectPackage, PROJECT_PACKAGE_MAX_BYTES } from "../projects/projectPackage";
import {
  createImageStudioProject, listImageStudioProjects, openImageStudioProject, ProjectConflictError,
  saveImageStudioProject, type ProjectSummary,
} from "../projects/projectClient";
import { fileCopy } from "./fileCopy";
import type { DocumentHistory } from "../domain/history";
import type { CanvasSize } from "./useCanvasViewport";

export type PersistenceStatus = "idle" | "saving" | "saved" | "conflict" | "error";
const AUTOSAVE_DELAY_MS = 1500;
const AUTOSAVE_RETRY_DELAYS_MS = [3000, 6000, 12000] as const;

export interface UseStudioProjectOptions {
  document: ImageStudioDocument;
  documentRef: MutableRefObject<ImageStudioDocument>;
  setDocument: Dispatch<SetStateAction<ImageStudioDocument>>;
  historyRef: MutableRefObject<DocumentHistory>;
  refreshHistory: Dispatch<SetStateAction<number>>;
  fitView: (target?: CanvasSize) => void;
  setError: (error: MessageKey | null) => void;
  locale: Locale;
}

export interface UseStudioProjectResult {
  projects: ProjectSummary[];
  projectId: string | null;
  projectRevision: number | null;
  projectRevisionRef: MutableRefObject<string>;
  persistence: PersistenceStatus;
  persistenceError: string;
  online: boolean;
  draftError: boolean;
  draftCandidate: { draft: ProjectDraft; recovery: DraftRecovery; remoteId: string | null } | null;
  recoverableOperation: AiOperation | null;
  setRecoverableOperation: Dispatch<SetStateAction<AiOperation | null>>;
  fileBusy: boolean;
  fileError: string;
  lastSavedUpdatedAtRef: MutableRefObject<string | null>;
  refreshProjects: () => Promise<void>;
  saveProject: (override?: ImageStudioDocument) => Promise<boolean>;
  openProject: (id: string) => Promise<void>;
  canSwitchDocument: () => boolean;
  importStudioFile: (file: File) => Promise<void>;
  renameProject: (title: string) => Promise<boolean>;
  applyDraft: (asCopy: boolean) => void;
  discardDraft: () => void;
  discardAndOpenRemote: () => Promise<void>;
}

/**
 * Project loading, draft recovery, autosave and file import/save, extracted
 * from Studio.tsx (Issue #163). Owns everything needed to open, save, rename,
 * import and recover an Image Studio project; document editing itself stays
 * with the caller (via `document`/`setDocument`/`historyRef`).
 */
export function useStudioProject(options: UseStudioProjectOptions): UseStudioProjectResult {
  const { document, documentRef, setDocument, historyRef, refreshHistory, fitView, setError, locale } = options;

  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectRevision, setProjectRevision] = useState<number | null>(null);
  const [persistence, setPersistence] = useState<PersistenceStatus>("idle");
  const [persistenceError, setPersistenceError] = useState("");
  const [online, setOnline] = useState(navigator.onLine);
  const [draftError, setDraftError] = useState(false);
  const [draftCandidate, setDraftCandidate] = useState<{ draft: ProjectDraft; recovery: DraftRecovery; remoteId: string | null } | null>(null);
  const [recoverableOperation, setRecoverableOperation] = useState<AiOperation | null>(null);
  const [fileBusy, setFileBusy] = useState(false);
  const [fileError, setFileError] = useState("");

  const fileInFlightRef = useRef(false);
  const saveInFlightRef = useRef(false);
  const [saveFailures, setSaveFailures] = useState(0);
  const draftStoreRef = useRef(new BrowserDraftStore());
  const deepLinkOpenedRef = useRef(false);
  const lastSavedUpdatedAtRef = useRef<string | null>(null);
  const projectRevisionRef = useRef("");
  projectRevisionRef.current = projectId && projectRevision ? `${projectId}:${projectRevision}` : "";

  const refreshProjects = useCallback(async () => {
    try { setProjects(await listImageStudioProjects()); } catch { /* Saving remains usable if the list projection is unavailable. */ }
  }, []);

  useEffect(() => { void refreshProjects(); }, [refreshProjects]);

  useEffect(() => {
    const update = () => {
      if (navigator.onLine) setSaveFailures(0);
      setOnline(navigator.onLine);
    };
    window.addEventListener("online", update); window.addEventListener("offline", update);
    void draftStoreRef.current.latestUnsaved().then((draft) => {
      if (draft && draft.document.layers.length) setDraftCandidate({ draft, recovery: "restore", remoteId: null });
    }).catch(() => setDraftError(true));
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);

  const saveProject = useCallback(async (override?: ImageStudioDocument, automatic = false): Promise<boolean> => {
    if (fileInFlightRef.current || saveInFlightRef.current) return false;
    if (!automatic) setSaveFailures(0);
    saveInFlightRef.current = true;
    setPersistence("saving"); setPersistenceError("");
    const before = documentRef.current;
    const snapshot = override ?? before;
    let saveId = projectId;
    let saveRevision = projectRevision;
    try {
      const previousDraftKey = draftKey(projectId, snapshot);
      if (!saveId) {
        const created = await createImageStudioProject(snapshot);
        saveId = created.id; saveRevision = created.revision;
        setProjectId(saveId); setProjectRevision(saveRevision);
      }
      const result = await saveImageStudioProject(
        saveId,
        saveRevision!,
        snapshot,
        historyRef.current.retainedAssetIds(),
      );
      setProjectId(result.project.id);
      setProjectRevision(result.project.revision);
      lastSavedUpdatedAtRef.current = snapshot.metadata.updatedAt;
      setDocument((current) => current.metadata.updatedAt === before.metadata.updatedAt ? result.document : override ? touchDocument({ ...current, title: snapshot.title }) : current);
      setPersistence("saved");
      setSaveFailures(0);
      for (const key of new Set([previousDraftKey, draftKey(null, snapshot)])) {
        void draftStoreRef.current.delete(key).catch(() => undefined);
      }
      void refreshProjects();
      return true;
    } catch (error) {
      setSaveFailures((count) => count + 1);
      setPersistence(error instanceof ProjectConflictError ? "conflict" : "error");
      setPersistenceError((error as Error).message);
      if (error instanceof ProjectConflictError && saveId) {
        const draft: ProjectDraft = { key: draftKey(saveId, snapshot), projectId: saveId, baseRevision: saveRevision, savedAt: new Date().toISOString(), document: snapshot };
        setDraftCandidate({ draft, recovery: "restore-as-copy", remoteId: saveId });
      }
      return false;
    } finally { saveInFlightRef.current = false; }
  }, [documentRef, historyRef, projectId, projectRevision, refreshProjects, setDocument]);

  useEffect(() => {
    if (!document.layers.length) return;
    const key = draftKey(projectId, document);
    if (projectId && document.metadata.updatedAt === lastSavedUpdatedAtRef.current) {
      void draftStoreRef.current.delete(key).catch(() => undefined);
      return;
    }
    const timer = window.setTimeout(() => {
      void draftStoreRef.current.put({ key, projectId, baseRevision: projectRevision, savedAt: new Date().toISOString(), document })
        .then(() => setDraftError(false)).catch(() => setDraftError(true));
    }, 700);
    return () => window.clearTimeout(timer);
  }, [document, projectId, projectRevision]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (document.layers.length && document.metadata.updatedAt !== lastSavedUpdatedAtRef.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [document]);

  useEffect(() => {
    if (!projectId || !online || fileBusy || persistence === "saving" || persistence === "conflict"
      || document.metadata.updatedAt === lastSavedUpdatedAtRef.current) return;
    const delay = persistence === "error" && saveFailures > 0
      ? AUTOSAVE_RETRY_DELAYS_MS[saveFailures - 1] : AUTOSAVE_DELAY_MS;
    if (delay === undefined) return;
    const timer = window.setTimeout(() => void saveProject(undefined, true), delay);
    return () => window.clearTimeout(timer);
  }, [document.metadata.updatedAt, fileBusy, online, persistence, projectId, saveFailures, saveProject]);

  const canSwitchDocument = useCallback(() => !documentRef.current.layers.length
    || documentRef.current.metadata.updatedAt === lastSavedUpdatedAtRef.current || window.confirm(fileCopy[locale].discard), [documentRef, locale]);

  const openProject = useCallback(async (id: string) => {
    if (fileInFlightRef.current || saveInFlightRef.current) return;
    if (!canSwitchDocument()) return;
    if (!id) {
      const next = createEmptyDocument();
      setSaveFailures(0);
      historyRef.current.clear(); documentRef.current = next; setDocument(next); setProjectId(null); setProjectRevision(null);
      lastSavedUpdatedAtRef.current = null; setRecoverableOperation(null); setDraftCandidate(null); setPersistence("idle"); refreshHistory((value) => value + 1); return;
    }
    const initial = documentRef.current;
    fileInFlightRef.current = true; setFileBusy(true);
    setPersistence("saving"); setPersistenceError("");
    try {
      const opened = await openImageStudioProject(id);
      const draft = await draftStoreRef.current.get(`project:${id}`).catch(() => null);
      // Loading is not permission to discard edits made after the switch was confirmed.
      if (documentRef.current !== initial) throw new Error("The document changed while opening the project; open it again to confirm discarding edits");
      const recovery = draftRecovery(draft, { revision: opened.revision, document: opened.document });
      setSaveFailures(0);
      historyRef.current.clear(); documentRef.current = opened.document; setDocument(opened.document); setProjectId(opened.id); setProjectRevision(opened.revision);
      setRecoverableOperation([...opened.operations].reverse().find((operation) =>
        ["submitting", "running", "result-ready", "delivery-failed", "cancelled"].includes(operation.status)) ?? null);
      lastSavedUpdatedAtRef.current = opened.document.metadata.updatedAt; setPersistence("saved");
      setDraftCandidate(draft && recovery !== "none" ? { draft, recovery, remoteId: id } : null);
      refreshHistory((value) => value + 1);
      requestAnimationFrame(() => fitView(opened.document.canvas));
    } catch (error) { setPersistence(persistence === "conflict" ? "conflict" : "error"); setPersistenceError((error as Error).message); }
    finally { fileInFlightRef.current = false; setFileBusy(false); }
  }, [canSwitchDocument, documentRef, fitView, historyRef, persistence, refreshHistory, setDocument]);

  useEffect(() => {
    if (deepLinkOpenedRef.current) return;
    deepLinkOpenedRef.current = true;
    const id = new URLSearchParams(window.location.search).get("project");
    if (id && /^[a-zA-Z0-9_-]{1,200}$/.test(id)) void openProject(id);
  }, [openProject]);

  const importProjectFile = useCallback(async (file: File) => {
    const initial = documentRef.current;
    setError(null); setPersistenceError("");
    if (file.size > PROJECT_PACKAGE_MAX_BYTES) { setError("packageFailed"); return; }
    try {
      const next = file.name.toLowerCase().endsWith(".ora") || file.type === "image/openraster"
        ? await importOpenRaster(new Uint8Array(await file.arrayBuffer()))
        : await parseProjectPackage(await file.text());
      if (documentRef.current !== initial) throw new Error("Project changed while importing");
      setSaveFailures(0);
      historyRef.current.clear(); setDocument(next); setProjectId(null); setProjectRevision(null);
      setRecoverableOperation(null); setDraftCandidate(null); lastSavedUpdatedAtRef.current = null; setPersistence("idle");
      refreshHistory((value) => value + 1); requestAnimationFrame(() => fitView(next.canvas));
    } catch { setError("packageFailed"); }
  }, [documentRef, fitView, historyRef, refreshHistory, setDocument, setError]);

  const importFile = useCallback(async (file: File) => {
    setError(null);
    const fileError = validateImageFile(file);
    if (fileError) { setError(importErrorMessage(fileError)); return; }
    try {
      const decoded = await decodeImage(file);
      const dimensionsError = validateImageDimensions(decoded.width, decoded.height);
      if (dimensionsError) { setError(importErrorMessage(dimensionsError)); return; }
      const current = documentRef.current;
      if (current.layers.length >= 500) throw new Error("Layer limit reached");
      const imported = current.layers.length ? addLayer(current, rasterLayerFromImage(decoded)) : documentFromImage(current, decoded);
      const next = current.layers.length || current.title === "Untitled" ? imported : { ...imported, title: current.title };
      if (!historyRef.current.canRecord(current, next)) throw new Error("Image import exceeds undo budget");
      setDocument(historyRef.current.execute(current, next, "Import image layer"));
      refreshHistory((value) => value + 1);
      if (!current.layers.length) requestAnimationFrame(() => fitView(next.canvas));
    } catch {
      setError("decodeFailed");
    }
  }, [documentRef, fitView, historyRef, refreshHistory, setDocument, setError]);

  const importStudioFile = useCallback(async (file: File) => {
    if (fileInFlightRef.current || saveInFlightRef.current) return;
    const isProject = /\.(ora|json)$/i.test(file.name) || file.type === "image/openraster";
    if (isProject && !canSwitchDocument()) return;
    fileInFlightRef.current = true; setFileBusy(true); setFileError("");
    try { if (isProject) await importProjectFile(file); else await importFile(file); }
    catch { setFileError(fileCopy[locale].failed); }
    finally { fileInFlightRef.current = false; setFileBusy(false); }
  }, [canSwitchDocument, importFile, importProjectFile, locale]);

  const renameProject = useCallback(async (title: string): Promise<boolean> => {
    if (fileInFlightRef.current || saveInFlightRef.current) return false;
    if (!title.trim() || title.trim().length > 160) { setFileError(fileCopy[locale].invalidName); return false; }
    const next = touchDocument({ ...documentRef.current, title: title.trim() });
    if (projectId) return saveProject(next);
    setDocument((current) => historyRef.current.execute(current, next, "Rename project"));
    refreshHistory((value) => value + 1);
    return true;
  }, [documentRef, historyRef, locale, projectId, refreshHistory, saveProject, setDocument]);

  const applyDraft = useCallback((asCopy: boolean) => {
    if (!draftCandidate || fileInFlightRef.current || saveInFlightRef.current) return;
    const next = draftCandidate.draft.document;
    setSaveFailures(0);
    historyRef.current.clear(); setDocument(next);
    if (asCopy) { setProjectId(null); setProjectRevision(null); lastSavedUpdatedAtRef.current = null; setPersistence("idle"); }
    else { setProjectId(draftCandidate.draft.projectId); setProjectRevision(draftCandidate.draft.baseRevision); setPersistence("idle"); }
    setDraftCandidate(null); refreshHistory((value) => value + 1); requestAnimationFrame(() => fitView(next.canvas));
  }, [draftCandidate, fitView, historyRef, refreshHistory, setDocument]);

  const discardDraft = useCallback(() => {
    if (!draftCandidate) return;
    void draftStoreRef.current.delete(draftCandidate.draft.key).catch(() => undefined);
    setDraftCandidate(null);
  }, [draftCandidate]);

  const discardAndOpenRemote = useCallback(async () => {
    if (fileInFlightRef.current || saveInFlightRef.current) return;
    const candidate = draftCandidate;
    if (!candidate?.remoteId) return;
    void draftStoreRef.current.delete(candidate.draft.key).catch(() => undefined);
    setDraftCandidate(null);
    await openProject(candidate.remoteId);
  }, [draftCandidate, openProject]);

  return {
    projects, projectId, projectRevision, projectRevisionRef, persistence, persistenceError,
    online, draftError, draftCandidate, recoverableOperation, setRecoverableOperation,
    fileBusy, fileError, lastSavedUpdatedAtRef,
    refreshProjects, saveProject, openProject, canSwitchDocument,
    importStudioFile, renameProject, applyDraft, discardDraft, discardAndOpenRemote,
  };
}

function draftKey(projectId: string | null, document: ImageStudioDocument): string {
  return projectId ? `project:${projectId}` : `unsaved:${document.id}`;
}

function decodeImage(file: File): Promise<DecodedImage> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("read failed"));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error("decode failed"));
      image.onload = () => resolve({ dataUrl: String(reader.result), mimeType: file.type, width: image.naturalWidth, height: image.naturalHeight, name: file.name });
      image.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

function importErrorMessage(error: ImageImportError): MessageKey {
  return error === "too-large" ? "tooLarge" : error === "unsupported" ? "unsupported" : "decodeFailed";
}
