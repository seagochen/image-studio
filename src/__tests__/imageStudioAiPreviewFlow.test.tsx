import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AiEditDialog } from "../ai/AiEditDialog";
import { completeImageStudioAiOperation } from "../projects/projectClient";
import { rasterLayerFromImage } from "../domain/importImage";
import { setRuntimeConfigForTests } from "../runtime/runtimeConfig";
import type { AiOperation } from "../ai/types";

jest.mock("../ai/httpGateway", () => ({
  IMAGE_STUDIO_AI_OUTPUT_FORMAT: "png",
  fetchImageModes: async () => [{ id: "denoise", label: "Denoise", fields: [] }],
  HttpAiRunGateway: jest.fn().mockImplementation(() => ({
    submit: async () => "run-new", status: async () => ({ status: "success" }), result: async () => new Blob(),
  })),
}));
jest.mock("../ai/imageInput", () => ({
  decodeBlob: async () => ({ dataUrl: "data:image/png;base64,AA==", width: 10, height: 10, mimeType: "image/png", name: "Result" }),
  rasterSourceToBlob: async () => new Blob(),
}));
jest.mock("../projects/projectClient", () => ({ completeImageStudioAiOperation: jest.fn() }));

describe("AI result review and application", () => {
  let host: HTMLDivElement; let root: Root; let revision: string;
  const apply = jest.fn(() => "layer-result"); const close = jest.fn();
  const button = (label: string) => [...host.querySelectorAll("button")].find((item) => item.textContent === label)!;
  beforeEach(async () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    (globalThis as any).HTMLIFrameElement = document.defaultView!.HTMLIFrameElement;
    setRuntimeConfigForTests({ mode: "platform", aiAvailable: true });
    apply.mockClear(); close.mockClear(); jest.mocked(completeImageStudioAiOperation).mockReset().mockResolvedValue(); revision = "revision-1";
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    const layer = rasterLayerFromImage({ dataUrl: "data:image/png;base64,AA==", width: 10, height: 10, mimeType: "image/png", name: "Source" });
    const operation: AiOperation = { id: "operation-1", projectId: "project-1", baseRevision: 1, mode: "denoise", inputLayerId: layer.id, maskLayerId: null, parameters: {}, baseDocumentRevision: revision, runId: "run-1", status: "result-ready", resultLayerId: null, error: null, retryOf: null, recipeId: null, stepIndex: null };
    await act(async () => root.render(<AiEditDialog layer={layer} language="en" revision={revision} projectId="project-1" projectRevision={1}
      initialOperation={operation} currentRevision={() => revision} onApply={apply} onClose={close} t={(key) => key} />));
    await act(async () => button("resume").click());
  });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); setRuntimeConfigForTests(null); });

  it("waits for explicit application and retries completion without adding another layer", async () => {
    expect(apply).not.toHaveBeenCalled(); expect(completeImageStudioAiOperation).not.toHaveBeenCalled();
    jest.mocked(completeImageStudioAiOperation).mockRejectedValueOnce(new Error("Temporary completion failure"));
    await act(async () => button("Apply as new layer").click());
    expect(apply).toHaveBeenCalledTimes(1); expect(close).not.toHaveBeenCalled();
    revision = "revision-after-local-application";
    await act(async () => button("Apply as new layer").click());
    expect(apply).toHaveBeenCalledTimes(1); expect(completeImageStudioAiOperation).toHaveBeenCalledTimes(2); expect(close).toHaveBeenCalledTimes(1);
  });

  it("refuses a stale preview before changing the document", async () => {
    revision = "changed";
    await act(async () => button("Apply as new layer").click());
    expect(apply).not.toHaveBeenCalled(); expect(host.textContent).toContain("The document changed");
  });

  it("returns to editable settings without applying the preview", async () => {
    await act(async () => button("Adjust settings").click());
    expect(button("Apply as new layer")).toBeUndefined(); expect(button("run").disabled).toBe(false); expect(apply).not.toHaveBeenCalled();
  });
});
