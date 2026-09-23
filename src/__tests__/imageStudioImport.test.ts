import { documentFromImage, validateImageDimensions, validateImageFile } from "../domain/importImage";
import { createEmptyDocument } from "../domain/document";
import { shortcutAction } from "../domain/shortcuts";

describe("Image Studio import and interaction contracts", () => {
  it("validates file types, byte size, pixel count and image edges", () => {
    expect(validateImageFile({ type: "image/gif", size: 10 })).toBe("unsupported");
    expect(validateImageFile({ type: "image/png", size: 51 * 1024 * 1024 })).toBe("too-large");
    expect(validateImageDimensions(10_000, 5_000)).toBe("too-large");
    expect(validateImageDimensions(4000, 3000)).toBeNull();
  });

  it("creates one selected raster layer in original pixel coordinates", () => {
    const document = documentFromImage(createEmptyDocument(), {
      dataUrl: "data:image/png;base64,AA==", mimeType: "image/png", width: 640, height: 480, name: "photo.png",
    });
    expect(document.canvas).toEqual({ width: 640, height: 480 });
    expect(document.layers[0]).toMatchObject({ type: "raster", width: 640, height: 480 });
    expect(document.selection.layerId).toBe(document.layers[0].id);
  });

  it("maps keyboard interactions without treating plain Z as undo", () => {
    expect(shortcutAction({ key: "z", ctrlKey: true, metaKey: false, shiftKey: false })).toBe("undo");
    expect(shortcutAction({ key: "z", ctrlKey: true, metaKey: false, shiftKey: true })).toBe("redo");
    expect(shortcutAction({ key: "z", ctrlKey: false, metaKey: false, shiftKey: false })).toBeNull();
  });
});
