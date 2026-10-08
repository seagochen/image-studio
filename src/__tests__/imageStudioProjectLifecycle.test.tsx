import React, { act, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { addLayer, createDrawingLayer } from "../domain/commands";
import { createEmptyDocument, touchDocument, type ImageStudioDocument } from "../domain/document";
import { DocumentHistory } from "../domain/history";
import { BrowserDraftStore, type ProjectDraft } from "../projects/draftStore";
import { listImageStudioProjects, openImageStudioProject, saveImageStudioProject, type OpenProject } from "../projects/projectClient";
import { useStudioProject, type UseStudioProjectResult } from "../studio/useStudioProject";

jest.mock("../projects/projectClient", () => ({
  ...jest.requireActual("../projects/projectClient"),
  listImageStudioProjects: jest.fn(), openImageStudioProject: jest.fn(), saveImageStudioProject: jest.fn(),
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
    history = new DocumentHistory(); fit = jest.fn();
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    function Harness() {
      const [document, setDocument] = useState(createEmptyDocument);
      const documentRef = useRef(document); documentRef.current = document;
      const historyRef = useRef(history);
      const [, refreshHistory] = useState(0);
      current = document;
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

});
