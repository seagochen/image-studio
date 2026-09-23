import { addLayer, createAnnotationLayer, createGroupLayer, replaceAnnotationElement } from "../domain/commands";
import { createTextElement, createRectElement } from "../domain/annotation";
import { createEmptyDocument, parseDocument, serializeDocument, type AnnotationLayer, type AnnotationTextElement } from "../domain/document";
import { DocumentHistory } from "../domain/history";

describe("Image Studio annotation property edits", () => {
  const fixture = () => {
    const initial = createEmptyDocument();
    const text = { ...createTextElement({ x: 30, y: 40 }), text: "Original" } as AnnotationTextElement;
    const shape = createRectElement({ x: 10, y: 20 }, { x: 80, y: 90 })!;
    const layer = { ...createAnnotationLayer(initial, "Objects"), elements: [text, shape] };
    return { document: addLayer(initial, layer), layer, text, shape };
  };

  it("edits a specific text object without replacing siblings and round-trips every text property", () => {
    const { document, layer, text, shape } = fixture();
    const changed = { ...text, text: "中文と日本語", fontFamily: "Georgia", fontSize: 48, fill: "#336699", align: "center" as const };
    const result = replaceAnnotationElement(document, layer.id, changed);
    const history = new DocumentHistory();
    const recorded = history.execute(document, result, "Edit text");
    expect(history.undo(recorded)).toBe(document);
    expect(history.redo(document)).toBe(result);
    const parsed = parseDocument(serializeDocument(result));
    expect((parsed.layers[0] as AnnotationLayer).elements).toEqual([changed, shape]);
    expect((document.layers[0] as AnnotationLayer).elements[0]).toBe(text);
    expect((result.layers[0] as AnnotationLayer).elements[1]).toBe(shape);
  });

  it("keeps shape styling in the editable document", () => {
    const { document, layer, shape } = fixture();
    if (shape.kind !== "rect") throw Error("Expected rectangle fixture");
    const changed = { ...shape, fill: "#00aa55", stroke: "#112233", strokeWidth: 9, cornerRadius: 12 };
    const result = replaceAnnotationElement(document, layer.id, changed);
    expect((parseDocument(serializeDocument(result)).layers[0] as AnnotationLayer).elements[1]).toEqual(changed);
  });

  it("rejects missing objects, identity changes, locked layers and locked ancestors", () => {
    const { document, layer, text } = fixture();
    expect(replaceAnnotationElement(document, layer.id, { ...text, id: "missing" })).toBe(document);
    expect(replaceAnnotationElement(document, "missing", text)).toBe(document);
    expect(replaceAnnotationElement(document, layer.id, text)).toBe(document);
    const group = { ...createGroupLayer(document, "Group"), locked: true };
    const locked = { ...document, layers: [group, { ...layer, parentId: group.id }] };
    expect(replaceAnnotationElement(locked, layer.id, { ...text, text: "Blocked" })).toBe(locked);
    const ownLock = { ...document, layers: [{ ...layer, locked: true }] };
    expect(replaceAnnotationElement(ownLock, layer.id, { ...text, text: "Blocked" })).toBe(ownLock);
  });
});
