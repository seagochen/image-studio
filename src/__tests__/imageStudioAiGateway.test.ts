import { fetchImageModes, HttpAiRunGateway } from "../ai/httpGateway";
import type { AiOperation } from "../ai/types";

const operation: AiOperation = {
  id: "operation-1", projectId: "project-1", baseRevision: 4, baseDocumentRevision: "project-1:4",
  inputLayerId: "input-1", maskLayerId: null, mode: "denoise", parameters: { strength: "medium", output_format: "png" },
  runId: null, status: "draft", resultLayerId: null, error: null, retryOf: null, recipeId: null, stepIndex: null,
};

describe("Image Studio AI HTTP gateway", () => {
  afterEach(() => jest.restoreAllMocks());

  it("prepares a durable operation before submitting the existing run API", async () => {
    const form = { append: jest.fn() };
    jest.spyOn(globalThis, "FormData").mockImplementation(() => form as unknown as FormData);
    const fetchMock = jest.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(json({ operation: { ...operation, status: "submitting" } }, 201))
      .mockResolvedValueOnce(json({ run_id: "run-1", mode: "denoise" }, 201));
    const runId = await new HttpAiRunGateway().submit(operation, new Blob(["image"], { type: "image/png" }), new AbortController().signal);
    expect(runId).toBe("run-1");
    expect(fetchMock.mock.calls[0][0]).toBe("/image-studio/projects/project-1/operations");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({ id: "operation-1", baseRevision: 4, inputLayerId: "input-1" });
    expect(fetchMock.mock.calls[fetchMock.mock.calls.length - 1][0]).toBe("/v1/runs");
    expect(fetchMock.mock.calls[1][1]?.headers).toEqual({
      "Idempotency-Key": "operation-1", "X-Image-Studio-Operation-Id": "operation-1",
    });
    expect(form.append).toHaveBeenCalledWith("output_format", "png");
  });

  it("hides the output format field because Image Studio always requests PNG", async () => {
    jest.spyOn(globalThis, "fetch").mockResolvedValue(json({
      modes: { deblur: { enabled: true, input: "upload", mediaKind: "image", resultKind: "image", label: "Denoise", fields: ["strength", "output_format"] } },
      fields: { strength: { label: "Strength", options: ["low", "medium"] }, output_format: { label: "Output format", options: ["jpg", "png"] } },
    }));
    await expect(fetchImageModes("en")).resolves.toEqual([{ id: "deblur", label: "Denoise", fields: [{
      id: "strength", label: "Strength", options: ["low", "medium"], type: undefined,
      optionLabels: undefined, default: undefined, placeholder: undefined,
    }] }]);
  });

  it("keeps a manifest-declared image mask mode and submits its declared field", async () => {
    jest.spyOn(globalThis, "fetch").mockResolvedValue(json({
      modes: { object_remove: { enabled: true, input: "upload", mediaKind: "image", resultKind: "image", label: "Object removal", fields: [], secondary: { field: "mask_file", mediaKind: "image", required: true } } }, fields: {},
    }));
    await expect(fetchImageModes("en")).resolves.toEqual([{ id: "object_remove", label: "Object removal", maskField: "mask_file", maskRequired: true, fields: [] }]);

    const form = { append: jest.fn() };
    jest.spyOn(globalThis, "FormData").mockImplementation(() => form as unknown as FormData);
    const fetchMock = jest.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(json({ operation: { ...operation, status: "submitting" } }, 201))
      .mockResolvedValueOnce(json({ run_id: "run-mask" }, 201));
    await new HttpAiRunGateway().submit({ ...operation, mode: "object_remove" }, new Blob(["image"]), new AbortController().signal, {
      field: "mask_file", file: new Blob(["mask"], { type: "image/png" }),
    });
    expect(fetchMock.mock.calls[fetchMock.mock.calls.length - 1][0]).toBe("/v1/runs");
    expect(form.append).toHaveBeenCalledWith("mask_file", expect.any(Blob), "mask.png");
  });

  it("excludes every unrelated platform tool even when its output is an image", async () => {
    const enabled = { enabled: true, input: "upload", mediaKind: "image", resultKind: "image", fields: [] };
    jest.spyOn(globalThis, "fetch").mockResolvedValue(json({ modes: Object.fromEntries([
      "outpaint", "document_restore", "document_unwarp", "watermark_embed", "watermark_extract", "watermark_remove",
      "face_restore", "object_segment", "light_enhance", "virtual_try_on", "future_image_tool",
    ].map((id) => [id, enabled])) }));
    await expect(fetchImageModes("zh-CN")).resolves.toEqual([]);
  });

  it("keeps unavailable old-photo restoration distinct from face restoration", async () => {
    jest.spyOn(globalThis, "fetch").mockResolvedValue(json({ modes: {
      face_restore: { enabled: true, fields: [] },
      old_photo_restore: { enabled: false, fields: ["restoration_scale"] },
      colorize: { enabled: true, fields: ["input_size"] },
    }, fields: { restoration_scale: { default: 1, options: [1, 2] }, input_size: { default: 512, options: [256, 512] } } }));
    const modes = await fetchImageModes("en");
    expect(modes.map((mode) => mode.id)).toEqual(["old_photo_restore", "colorize"]);
    expect(modes[0].enabled).toBe(false);
    expect(modes[0].fields[0]).toMatchObject({ default: "1", options: ["1", "2"] });
    expect(modes[1].fields[0]).toMatchObject({ default: "512", options: ["256", "512"] });
  });

  it("rejects submitting an excluded tool without creating an operation", async () => {
    const fetchMock = jest.spyOn(globalThis, "fetch");
    await expect(new HttpAiRunGateway().submit({ ...operation, mode: "watermark_embed" }, new Blob(), new AbortController().signal))
      .rejects.toThrow("not available in Image Studio");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reuses the persisted run and does not submit it again", async () => {
    const fetchMock = jest.spyOn(globalThis, "fetch").mockResolvedValue(json({ operation: { ...operation, runId: "run-existing", status: "running" } }));
    await expect(new HttpAiRunGateway().submit(operation, new Blob(["image"]), new AbortController().signal)).resolves.toBe("run-existing");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("downloads completed results through the same-origin content endpoint", async () => {
    const fetchMock = jest.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(json({ url: "https://s3.example/result.jpg", content_url: "/v1/runs/run-1/result/content" }))
      .mockResolvedValueOnce(new Response(new Blob(["jpeg"], { type: "image/jpeg" }), {
        status: 200, headers: { "Content-Type": "image/jpeg" },
      }));

    const result = await new HttpAiRunGateway().result("run-1", new AbortController().signal);

    expect(result.type).toBe("image/jpeg");
    expect(fetchMock.mock.calls[1][0]).toBe("/v1/runs/run-1/result/content");
  });

  it("reports a useful message when the same-origin result stream is unavailable", async () => {
    jest.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(json({ url: "https://s3.example/result.jpg", content_url: "/v1/runs/run-1/result/content" }))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"));

    await expect(new HttpAiRunGateway().result("run-1", new AbortController().signal))
      .rejects.toThrow("AI result download could not reach the server");
  });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
