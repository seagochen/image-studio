import React, { act, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { addLayer, createDrawingLayer } from "../domain/commands";
import { createEmptyDocument, touchDocument, type ImageStudioDocument } from "../domain/document";
import { DocumentHistory } from "../domain/history";
import { BrowserDraftStore, type ProjectDraft } from "../projects/draftStore";
import { createImageStudioProject, listImageStudioProjects, openImageStudioProject, ProjectConflictError, saveImageStudioProject, type OpenProject } from "../projects/projectClient";
import { rasterLayerFromImage } from "../domain/importImage";
import { useStudioProject, type UseStudioProjectResult } from "../studio/useStudioProject";

jest.mock("../projects/projectClient", () => ({
  ...jest.requireActual("../projects/projectClient"),
  createImageStudioProject: jest.fn(), listImageStudioProjects: jest.fn(), openImageStudioProject: jest.fn(), saveImageStudioProject: jest.fn(),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function project(id = "project-1", document = createEmptyDocument()): OpenProject {
  return { id, document, revision: 1, title: document.title, documentVersion: document.version,
    createdAt: document.metadata.createdAt, updatedAt: document.metadata.updatedAt, operations: [] };
}

describe("project lifecycle", () => {
  let root: Root;
  let host: HTMLDivElement;
  let state: UseStudioProjectResult;
  let current: ImageStudioDocument;
  let edit: () => void;
  let addRaster: () => void;
  let history: DocumentHistory;
  let fit: jest.Mock;

  beforeEach(async () => {
    jest.useFakeTimers();
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    (globalThis as any).HTMLIFrameElement = document.defaultView!.HTMLIFrameElement;
    (globalThis as any).addEventListener = document.defaultView!.addEventListener.bind(document.defaultView);
    (globalThis as any).removeEventListener = document.defaultView!.removeEventListener.bind(document.defaultView);
    (globalThis as any).requestAnimationFrame = jest.fn();
    (globalThis as any).confirm = jest.fn(() => true);
    jest.spyOn(BrowserDraftStore.prototype, "latestUnsaved").mockResolvedValue(null);
    jest.spyOn(BrowserDraftStore.prototype, "get").mockResolvedValue(null);
    jest.spyOn(BrowserDraftStore.prototype, "put").mockResolvedValue();
    jest.spyOn(BrowserDraftStore.prototype, "delete").mockResolvedValue();
    (listImageStudioProjects as jest.Mock).mockResolvedValue([]);
    (openImageStudioProject as jest.Mock).mockReset();
    (saveImageStudioProject as jest.Mock).mockReset();
    (createImageStudioProject as jest.Mock).mockReset();
    history = new DocumentHistory(); fit = jest.fn();
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    function Harness() {
      const [document, setDocument] = useState(createEmptyDocument);
      const documentRef = useRef(document); documentRef.current = document;
      const historyRef = useRef(history);
      const [, refreshHistory] = useState(0);
      current = document;
      addRaster = () => setDocument((before) => addLayer(before, rasterLayerFromImage({
        dataUrl: "data:image/png;base64,iVBORw0KGgo=", mimeType: "image/png", width: 10, height: 10, name: "Source",
      })));
      edit = () => setDocument((before) => {
        const next = touchDocument(addLayer(before, createDrawingLayer(before, "paint", "New edit")));
        next.metadata.updatedAt = new Date(Date.parse(before.metadata.updatedAt) + 1).toISOString();
        return history.execute(before, next, "New edit");
      });
      state = useStudioProject({ document, documentRef, setDocument, historyRef, refreshHistory,
        fitView: fit, setError: () => undefined, locale: "en" });
      return null;
    }
    await act(async () => root.render(<Harness />));
  });

  afterEach(async () => {
    await act(async () => root.unmount()); host.remove();
    jest.restoreAllMocks(); jest.useRealTimers();
    for (const key of ["IS_REACT_ACT_ENVIRONMENT", "HTMLIFrameElement", "addEventListener", "removeEventListener", "requestAnimationFrame", "confirm"]) delete (globalThis as any)[key];
  });

  it("keeps edits and history made while opening, and blocks overlapping file operations", async () => {
    const pending = deferred<OpenProject>();
    (openImageStudioProject as jest.Mock).mockReturnValueOnce(pending.promise).mockResolvedValue(project());
    let opening!: Promise<void>;
    await act(async () => { opening = state.openProject("project-1"); });
    expect(state.fileBusy).toBe(true);
    await act(async () => {
      await state.openProject("project-2");
      await state.importStudioFile(new File(["{}"], "project.json"));
      expect(await state.saveProject()).toBe(false);
      expect(await state.renameProject("Other")).toBe(false);
      edit();
    });
    const edited = current;
    await act(async () => { pending.resolve(project()); await opening; });
    expect(current).toBe(edited);
    expect(history.timeline.undo).toEqual(["New edit"]);
    expect(state.projectId).toBeNull();
    expect(state.persistenceError).toContain("document changed");
    expect(state.fileBusy).toBe(false);
    expect(openImageStudioProject).toHaveBeenCalledTimes(1);
    expect(saveImageStudioProject).not.toHaveBeenCalled();
    await act(async () => state.openProject("project-1"));
    expect(state.projectId).toBe("project-1");
    expect(history.timeline.undo).toEqual([]);
  });

  it("also checks edits made while local recovery metadata is loading", async () => {
    const draft = deferred<ProjectDraft | null>();
    jest.mocked(BrowserDraftStore.prototype.get).mockReturnValueOnce(draft.promise);
    (openImageStudioProject as jest.Mock).mockResolvedValue(project());
    let opening!: Promise<void>;
    await act(async () => { opening = state.openProject("project-1"); });
    await act(async () => edit());
    const edited = current;
    await act(async () => { draft.resolve(null); await opening; });
    expect(current).toBe(edited);
    expect(state.projectId).toBeNull();
  });

  it("respects discard cancellation and releases the lock after a failed open", async () => {
    await act(async () => edit());
    (window.confirm as jest.Mock).mockReturnValueOnce(false);
    await act(async () => state.openProject("project-1"));
    expect(openImageStudioProject).not.toHaveBeenCalled();
    (openImageStudioProject as jest.Mock).mockRejectedValueOnce(new Error("Unavailable")).mockResolvedValueOnce(project());
    await act(async () => state.openProject("project-1"));
    expect(state.fileBusy).toBe(false);
    await act(async () => state.openProject("project-1"));
    expect(state.projectId).toBe("project-1");
  });

  it("keeps the active document when recovery is requested during an open", async () => {
    const draftDocument = touchDocument(createEmptyDocument());
    jest.mocked(BrowserDraftStore.prototype.latestUnsaved).mockResolvedValue(null);
    const opened = project();
    opened.document.metadata.updatedAt = "2026-01-01T00:00:00.000Z";
    jest.mocked(BrowserDraftStore.prototype.get).mockResolvedValueOnce({ key: "project:project-1", projectId: "project-1", baseRevision: 1,
      savedAt: draftDocument.metadata.updatedAt, document: draftDocument });
    (openImageStudioProject as jest.Mock).mockResolvedValueOnce(opened);
    await act(async () => state.openProject("project-1"));
    expect(state.draftCandidate?.recovery).toBe("restore");
    const pending = deferred<OpenProject>();
    (openImageStudioProject as jest.Mock).mockReturnValueOnce(pending.promise);
    let opening!: Promise<void>;
    await act(async () => { opening = state.openProject("project-2"); state.applyDraft(true); });
    expect(state.projectId).toBe("project-1");
    await act(async () => { pending.resolve(project("project-2")); await opening; });
    expect(state.projectId).toBe("project-2");
  });

  it("stops autosaving after a conflict, including after further edits", async () => {
    (openImageStudioProject as jest.Mock).mockResolvedValue(project());
    (saveImageStudioProject as jest.Mock).mockRejectedValue(new ProjectConflictError(2));
    await act(async () => state.openProject("project-1"));
    await act(async () => edit());
    await act(async () => jest.advanceTimersByTime(1500));
    expect(state.persistence).toBe("conflict");
    expect(state.draftCandidate?.recovery).toBe("restore-as-copy");
    await act(async () => edit());
    await act(async () => jest.advanceTimersByTime(60_000));
    expect(saveImageStudioProject).toHaveBeenCalledTimes(1);
    expect(BrowserDraftStore.prototype.put).toHaveBeenCalled();
    (openImageStudioProject as jest.Mock).mockRejectedValueOnce(new Error("Open unavailable"));
    await act(async () => state.openProject("project-2"));
    expect(state.persistence).toBe("conflict");
    await act(async () => jest.advanceTimersByTime(60_000));
    expect(saveImageStudioProject).toHaveBeenCalledTimes(1);
    await act(async () => state.applyDraft(true));
    expect(state.projectId).toBeNull();
    expect(state.persistence).toBe("idle");
  });

  it("backs off failed saves and stops after three automatic retries until a manual save", async () => {
    const opened = project();
    (openImageStudioProject as jest.Mock).mockResolvedValue(opened);
    (saveImageStudioProject as jest.Mock).mockRejectedValue(new Error("Network unavailable"));
    await act(async () => state.openProject("project-1"));
    await act(async () => edit());
    await act(async () => jest.advanceTimersByTime(1500));
    expect(saveImageStudioProject).toHaveBeenCalledTimes(1);
    for (const [index, delay] of [3000, 6000, 12000].entries()) {
      await act(async () => jest.advanceTimersByTime(delay - 1));
      expect(saveImageStudioProject).toHaveBeenCalledTimes(index + 1);
      await act(async () => jest.advanceTimersByTime(1));
      expect(saveImageStudioProject).toHaveBeenCalledTimes(index + 2);
    }
    await act(async () => edit());
    await act(async () => jest.advanceTimersByTime(60_000));
    expect(saveImageStudioProject).toHaveBeenCalledTimes(4);
    (saveImageStudioProject as jest.Mock).mockImplementation(async (_id, _revision, document) => ({ project: { ...opened, revision: 2 }, document }));
    await act(async () => { expect(await state.saveProject()).toBe(true); });
    expect(state.persistence).toBe("saved");
    await act(async () => jest.advanceTimersByTime(60_000));
    expect(saveImageStudioProject).toHaveBeenCalledTimes(5);
  });

  it("pauses offline and resumes dirty autosaves when the browser comes online", async () => {
    const opened = project();
    const online = jest.spyOn(navigator, "onLine", "get");
    (openImageStudioProject as jest.Mock).mockResolvedValue(opened);
    (saveImageStudioProject as jest.Mock).mockImplementation(async (_id, _revision, document) => ({ project: { ...opened, revision: 2 }, document }));
    await act(async () => state.openProject("project-1"));
    online.mockReturnValue(false);
    await act(async () => { document.defaultView!.dispatchEvent(new Event("offline")); edit(); });
    await act(async () => jest.advanceTimersByTime(60_000));
    expect(saveImageStudioProject).not.toHaveBeenCalled();
    online.mockReturnValue(true);
    await act(async () => { document.defaultView!.dispatchEvent(new Event("online")); });
    await act(async () => jest.advanceTimersByTime(1500));
    expect(saveImageStudioProject).toHaveBeenCalledTimes(1);
    expect(state.persistence).toBe("saved");
  });

  it.each(["upload", "save"])("reuses a newly created project after %s failure and keeps the local draft", async (failure) => {
    const actual = jest.requireActual<typeof import("../projects/projectClient")>("../projects/projectClient");
    jest.mocked(createImageStudioProject).mockImplementation(actual.createImageStudioProject);
    jest.mocked(saveImageStudioProject).mockImplementation(actual.saveImageStudioProject);
    const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    const created = project("created-project");
    const asset = (id: string) => ({ id, width: 10, height: 10, mimeType: "image/png" });
    const fetchMock = jest.spyOn(globalThis, "fetch").mockResolvedValueOnce(response(created));
    if (failure === "upload") fetchMock.mockResolvedValueOnce(response({ detail: "Upload unavailable" }, 502));
    else fetchMock.mockResolvedValueOnce(response(asset("staged"))).mockResolvedValueOnce(response({ detail: "Save unavailable" }, 502))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    fetchMock.mockResolvedValueOnce(response(asset("final"))).mockResolvedValueOnce(response({ ...created, revision: 2 }));
    await act(async () => addRaster());
    const unsaved = current;
    await act(async () => { expect(await state.saveProject()).toBe(false); });
    expect(state.projectId).toBe("created-project");
    expect(state.projectRevision).toBe(1);
    expect(current).toBe(unsaved);
    await act(async () => jest.advanceTimersByTime(700));
    expect(BrowserDraftStore.prototype.put).toHaveBeenCalledWith(expect.objectContaining({ projectId: "created-project", baseRevision: 1, document: unsaved }));
    await act(async () => { expect(await state.saveProject()).toBe(true); });
    expect(state.projectRevision).toBe(2);
    expect(BrowserDraftStore.prototype.delete).toHaveBeenCalledWith(`unsaved:${unsaved.id}`);
    expect(fetchMock.mock.calls.filter(([url, options]) => url === "/image-studio/projects" && options?.method === "POST")).toHaveLength(1);
    const saved = current;
    expect(saved.layers[0]).toMatchObject({ source: { kind: "asset", assetId: "final" } });
    jest.mocked(openImageStudioProject).mockImplementation(actual.openImageStudioProject);
    fetchMock.mockResolvedValueOnce(response({ ...created, revision: 2, document: saved, assets: [asset("final")] }));
    await act(async () => state.openProject("created-project"));
    expect(current.layers[0]).toMatchObject({ source: { kind: "asset", assetId: "final" } });
  });
});
