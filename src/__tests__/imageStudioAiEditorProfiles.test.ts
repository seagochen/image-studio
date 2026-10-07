import { AI_EDITOR_MODE_IDS, aiEditorCopy, isAiEditorMode } from "../ai/editorProfiles";
import { expectedUpscaleSize } from "../ai/AiEditDialog";
import { StandaloneAiRunGateway } from "../ai/standaloneGateway";

it("caps super-resolution output without upscaling beyond the model factor", () => {
  expect(expectedUpscaleSize(320, 200, { scale: "4", long_edge: "1920" })).toBe("1280 × 800px");
  expect(expectedUpscaleSize(1000, 500, { scale: "4x", long_edge: "1920" })).toBe("1920 × 960px");
  expect(expectedUpscaleSize(1000, 500, { scale: "2x" })).toBe("1920 × 960px");
});

it("keeps the seven editor tasks labeled in every supported locale", () => {
  for (const language of ["en", "ja", "zh-CN", "zh-TW"]) {
    for (const id of AI_EDITOR_MODE_IDS) expect(aiEditorCopy(language)[id]).toHaveLength(3);
  }
  expect(isAiEditorMode("face_restore")).toBe(false);
  expect(isAiEditorMode("old_photo_restore")).toBe(true);
});

it("rejects excluded tools in standalone mode before uploading an image", async () => {
  const fetchMock = jest.spyOn(globalThis, "fetch");
  try {
    await expect(new StandaloneAiRunGateway().submit({ mode: "watermark_embed" } as any, new Blob(), new AbortController().signal))
      .rejects.toThrow("not available in Image Studio");
    expect(fetchMock).not.toHaveBeenCalled();
  } finally { fetchMock.mockRestore(); }
});
