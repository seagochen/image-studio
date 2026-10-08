import {
  createImageStudioProject, openImageStudioProject, ProjectConflictError, projectDocumentForSave, saveImageStudioProject,
} from "../projects/projectClient";
import { createEmptyDocument, IMAGE_STUDIO_DOCUMENT_VERSION } from "../domain/document";
import { rasterLayerFromImage } from "../domain/importImage";

const DATA_URL = "data:image/png;base64,iVBORw0KGgo=";

describe("Image Studio project client", () => {
  afterEach(() => jest.restoreAllMocks());

  it("creates a project, uploads local pixels, then saves asset references only", async () => {
    const document = createEmptyDocument("2026-09-06T00:00:00.000Z");
    document.title = "Portrait";
    document.layers = [rasterLayerFromImage({ dataUrl: DATA_URL, mimeType: "image/png", width: 10, height: 10, name: "portrait.png" })];
    document.selection.layerId = document.layers[0].id;
    const fetchMock = jest.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(response({ id: "project-1", title: "Portrait", revision: 1, documentVersion: IMAGE_STUDIO_DOCUMENT_VERSION }))
      .mockResolvedValueOnce(response({ id: "asset-1", mimeType: "image/png", width: 10, height: 10, sizeBytes: 10, url: "https://assets.test/a" }))
      .mockResolvedValueOnce(response({ id: "project-1", title: "Portrait", revision: 2, documentVersion: IMAGE_STUDIO_DOCUMENT_VERSION }));

    const created = await createImageStudioProject(document);
    const saved = await saveImageStudioProject(created.id, created.revision, document, ["asset-from-undo-history"]);
    expect(saved.project.revision).toBe(2);
    expect(saved.document.layers[0].type === "raster" && saved.document.layers[0].source).toMatchObject({
      kind: "asset", assetId: "asset-1", url: "http://localhost/image-studio/projects/project-1/assets/asset-1",
    });
    const finalBody = JSON.parse(String(fetchMock.mock.calls[2][1]?.body));
    expect(JSON.stringify(finalBody.document)).not.toContain("data:image");
    expect(JSON.stringify(finalBody.document)).not.toContain("assets.test");
    expect(finalBody.retainedAssetIds).toEqual(["asset-from-undo-history"]);
  });

  it("hydrates same-origin authenticated asset URLs when reopening", async () => {
    const document = createEmptyDocument();
    const layer = rasterLayerFromImage({ dataUrl: DATA_URL, mimeType: "image/png", width: 10, height: 10, name: "portrait.png" });
    layer.source = { kind: "asset", assetId: "asset-1", mimeType: "image/png", url: "" };
    document.layers = [layer];
    jest.spyOn(globalThis, "fetch").mockResolvedValue(response({
      id: "project-1", title: "Portrait", revision: 3, documentVersion: IMAGE_STUDIO_DOCUMENT_VERSION, document,
      assets: [{ id: "asset-1", mimeType: "image/png", width: 10, height: 10, sizeBytes: 10, url: "https://assets.test/signed" }],
    }));
    const opened = await openImageStudioProject("project-1");
    expect(opened.document.layers[0].type === "raster" && opened.document.layers[0].source).toMatchObject({
      url: "http://localhost/image-studio/projects/project-1/assets/asset-1",
    });
  });

  it("rejects malformed AI operations instead of trusting the wire payload", async () => {
    const document = createEmptyDocument();
    jest.spyOn(globalThis, "fetch").mockResolvedValue(response({
      id: "project-1", title: "Portrait", revision: 3, documentVersion: IMAGE_STUDIO_DOCUMENT_VERSION,
      document, assets: [], operations: [{ id: "operation-1", status: "unexpected" }],
    }));
    await expect(openImageStudioProject("project-1")).rejects.toThrow("Invalid Image Studio AI operation field");
  });

  it("surfaces revision conflicts and compensates newly staged assets", async () => {
    const document = createEmptyDocument();
    document.layers = [rasterLayerFromImage({ dataUrl: DATA_URL, mimeType: "image/png", width: 10, height: 10, name: "portrait.png" })];
    const fetchMock = jest.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(response({ id: "asset-new", mimeType: "image/png", width: 10, height: 10, url: "https://assets.test/new" }))
      .mockResolvedValueOnce(response({ detail: "Project revision conflict", currentRevision: 7 }, 409))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(saveImageStudioProject("project-1", 6, document)).rejects.toEqual(new ProjectConflictError(7));
    expect(fetchMock.mock.calls[2][0]).toBe("/image-studio/projects/project-1/assets/asset-new");
    expect(fetchMock.mock.calls[2][1]).toMatchObject({ method: "DELETE" });
  });

  it("strips only transient signed URLs from an otherwise stable document", () => {
    const document = createEmptyDocument();
    const layer = rasterLayerFromImage({ dataUrl: DATA_URL, mimeType: "image/png", width: 10, height: 10, name: "portrait.png" });
    layer.source = { kind: "asset", assetId: "asset-1", mimeType: "image/png", url: "https://assets.test/signed" };
    document.layers = [layer];
    const saved = projectDocumentForSave(document);
    expect(JSON.stringify(saved)).not.toContain("assets.test");
    expect(document.layers[0].type === "raster" && document.layers[0].source).toHaveProperty("url");
  });
});

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
