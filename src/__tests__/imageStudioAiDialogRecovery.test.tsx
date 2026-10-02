import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AiEditDialog } from "../ai/AiEditDialog";
import type { AiOperation } from "../ai/types";
import { rasterLayerFromImage } from "../domain/importImage";
import { setRuntimeConfigForTests } from "../runtime/runtimeConfig";

jest.mock("../ai/httpGateway", () => ({
  fetchImageModes: jest.fn(async () => [{ id: "denoise", label: "Denoise", fields: [] }]),
  HttpAiRunGateway: jest.fn().mockImplementation(() => ({
    submit: jest.fn(), status: jest.fn(),
    result: (_runId: string, signal: AbortSignal) => (globalThis as any).__imageStudioAiResult(signal),
  })),
}));

describe("Image Studio AI result recovery dialog", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    (globalThis as any).HTMLIFrameElement = document.defaultView!.HTMLIFrameElement;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    (globalThis as any).__imageStudioAiResult = jest.fn();
    setRuntimeConfigForTests({ mode: "platform", aiAvailable: true });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    delete (globalThis as any).__imageStudioAiResult;
    setRuntimeConfigForTests(null);
  });

  const renderRecoverable = async () => {
    const layer = rasterLayerFromImage({
      dataUrl: "data:image/png;base64,AA==", mimeType: "image/png", width: 10, height: 10, name: "Raster",
    });
    const operation: AiOperation = {
      id: "operation-1", projectId: "project-1", baseRevision: 1, mode: "denoise", inputLayerId: layer.id,
      maskLayerId: null, parameters: {}, baseDocumentRevision: "revision-1", runId: "run-1",
      status: "result-ready", resultLayerId: null, error: null, retryOf: null, recipeId: null, stepIndex: null,
    };

    await act(async () => {
      root.render(<AiEditDialog layer={layer} language="zh-CN" revision="revision-1" projectId="project-1"
        projectRevision={1} initialOperation={operation} currentRevision={() => "revision-1"}
        onApply={() => "result-layer"} onClose={() => undefined} t={(key) => key} />);
    });
  };

  it("offers recovery without pretending that a persisted result is currently running", async () => {
    await renderRecoverable();

    expect(host.textContent).toContain("statusResultReady");
    expect([...host.querySelectorAll("button")].find((button) => button.textContent === "stopWaiting")).toBeUndefined();
    expect([...host.querySelectorAll("button")].find((button) => button.textContent === "close")?.disabled).toBe(false);
    expect([...host.querySelectorAll("button")].find((button) => button.textContent === "resume")?.disabled).toBe(false);
  });

  it("stops only the current browser wait and leaves the same operation resumable", async () => {
    (globalThis as any).__imageStudioAiResult = (_signal: AbortSignal) => new Promise<Blob>((_resolve, reject) => {
      _signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    });
    await renderRecoverable();

    await act(async () => [...host.querySelectorAll("button")].find((button) => button.textContent === "resume")?.click());
    const stop = [...host.querySelectorAll("button")].find((button) => button.textContent === "stopWaiting");
    expect(stop).toBeDefined();
    await act(async () => { stop?.click(); await Promise.resolve(); });

    expect(host.textContent).toContain("statusCancelled");
    expect([...host.querySelectorAll("button")].find((button) => button.textContent === "close")?.disabled).toBe(false);
    expect([...host.querySelectorAll("button")].find((button) => button.textContent === "resume")?.disabled).toBe(false);
  });
});
