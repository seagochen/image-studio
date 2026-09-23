import { PREVIEW_TILE_EDGE, previewDocumentVersion, previewTiles } from "../studio/previewTiles";
import { createEmptyDocument } from "../domain/document";

describe("preview tile planning", () => {
  it("covers an image without overlapping or exceeding its edge", () => {
    expect(previewTiles(PREVIEW_TILE_EDGE + 1, PREVIEW_TILE_EDGE + 3)).toEqual([
      { x: 0, y: 0, width: PREVIEW_TILE_EDGE, height: PREVIEW_TILE_EDGE },
      { x: PREVIEW_TILE_EDGE, y: 0, width: 1, height: PREVIEW_TILE_EDGE },
      { x: 0, y: PREVIEW_TILE_EDGE, width: PREVIEW_TILE_EDGE, height: 3 },
      { x: PREVIEW_TILE_EDGE, y: PREVIEW_TILE_EDGE, width: 1, height: 3 },
    ]);
  });

  it("changes cache versions for a changed snapshot or pixel buffer", () => {
    const document = createEmptyDocument("2026-01-01T00:00:00.000Z");
    expect(previewDocumentVersion(document, 0)).not.toBe(previewDocumentVersion({ ...document, title: "Changed" }, 0));
    expect(previewDocumentVersion(document, 0)).not.toBe(previewDocumentVersion(document, 1));
  });

  it("rejects invalid tile dimensions", () => {
    expect(() => previewTiles(0, 1)).toThrow("Invalid preview tile dimensions");
  });
});
