import { invokeEditorCommand, searchEditorCommands, type EditorCommand } from "../domain/editorCommands";
import { addLayer, createAttachedRasterMask, createDrawingLayer, patchLayer } from "../domain/commands";
import { createEmptyDocument } from "../domain/document";
import { DocumentHistory } from "../domain/history";
import { quickTransformLayer, type QuickTransform } from "../domain/layerQuickTransform";

describe("workbench commands", () => {
  const make = (id: string, label: string, enabled = true): EditorCommand => ({ id, label, category: "Tools", keywords: "Brush", enabled, run: jest.fn() });
  it("searches localized labels, English terms and command identifiers", () => {
    const commands = [make("tool.brush", "画笔"), make("tool.hand", "平移")];
    expect(searchEditorCommands(commands, "画笔").map((command) => command.id)).toEqual(["tool.brush"]);
    expect(searchEditorCommands(commands, "tool.brush").map((command) => command.id)).toEqual(["tool.brush"]);
    expect(searchEditorCommands(commands, "xyz")).toEqual([]);
    expect(searchEditorCommands(commands, "")).toEqual(commands);
  });
  it("ranks an exact label before incidental keyword matches and blocks disabled invocation", () => {
    const commands = [make("layer.brush", "Brush settings"), make("tool.brush", "Brush", false)];
    expect(searchEditorCommands(commands, "brush")[0].id).toBe("tool.brush");
    expect(invokeEditorCommand(commands, "tool.brush")).toBe(false);
    expect(commands[1].run).not.toHaveBeenCalled();
    expect(invokeEditorCommand(commands, "missing")).toBe(false);
    expect(invokeEditorCommand(commands, "layer.brush")).toBe(true);
    expect(commands[0].run).toHaveBeenCalledTimes(1);
  });
});

describe("workbench history and quick transforms", () => {
  const fixture = () => {
    const empty = createEmptyDocument();
    const layer = { ...createDrawingLayer(empty, "paint", "Paint"), width: 80, height: 40,
      transform: { x: 31, y: 19, scaleX: 1.5, scaleY: .75, rotation: 27 } };
    return { layer, document: addLayer(empty, layer) };
  };
  const center = (layer: ReturnType<typeof fixture>["layer"]) => {
    const angle = layer.transform.rotation * Math.PI / 180;
    const x = layer.width * layer.transform.scaleX / 2, y = layer.height * layer.transform.scaleY / 2;
    return { x: layer.transform.x + x * Math.cos(angle) - y * Math.sin(angle), y: layer.transform.y + x * Math.sin(angle) + y * Math.cos(angle) };
  };
  it.each(["rotate-left", "rotate-right", "flip-horizontal", "flip-vertical"] as QuickTransform[])("preserves the center and linked mask for %s", (operation) => {
    const { document, layer } = fixture();
    const mask = createAttachedRasterMask(document, layer, "Mask");
    const linked = patchLayer(addLayer(document, mask), layer.id, { rasterMaskId: mask.id });
    const next = quickTransformLayer(linked, layer.id, operation);
    const transformed = next.layers.find((candidate) => candidate.id === layer.id)! as typeof layer;
    expect(center(transformed).x).toBeCloseTo(center(layer).x);
    expect(center(transformed).y).toBeCloseTo(center(layer).y);
    expect(next.layers.find((candidate) => candidate.id === mask.id)!.transform).toEqual(transformed.transform);
    const history = new DocumentHistory(); history.execute(linked, next, "Transform");
    expect(history.undo(next)).toBe(linked);
    expect(history.redo(linked)).toBe(next);
  });
  it("ignores locked layers and unknown IDs", () => {
    const { document, layer } = fixture();
    const locked = patchLayer(document, layer.id, { locked: true });
    expect(quickTransformLayer(locked, layer.id, "rotate-right")).toBe(locked);
    expect(quickTransformLayer(document, "missing", "rotate-right")).toBe(document);
  });
  it("shows merged labels and redo order without exposing mutable history entries", () => {
    const { document, layer } = fixture();
    const history = new DocumentHistory();
    const next = history.execute(document, patchLayer(document, layer.id, { name: "One" }), "Rename", "name");
    const renamed = history.execute(next, patchLayer(next, layer.id, { name: "Two" }), "Rename", "name");
    const transformed = history.execute(renamed, quickTransformLayer(renamed, layer.id, "flip-horizontal"), "Flip");
    expect(history.timeline).toEqual({ undo: ["Rename", "Flip"], redo: [] });
    const undo = history.undo(transformed); history.undo(undo);
    expect(history.timeline).toEqual({ undo: [], redo: ["Rename", "Flip"] });
    (history.timeline.redo as string[]).push("Unrelated");
    expect(history.timeline.redo).toEqual(["Rename", "Flip"]);
    history.clear(); expect(history.timeline).toEqual({ undo: [], redo: [] });
  });
});
