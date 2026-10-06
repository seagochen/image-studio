import { copyLayer, pasteLayer } from "../domain/layerClipboard";
import { createEmptyDocument } from "../domain/document";
import { addLayer, createDrawingLayer, deleteLayer } from "../domain/commands";
import { DocumentHistory } from "../domain/history";
import { bindConfiguredShortcuts, DEFAULT_SHORTCUTS } from "../domain/shortcutSettings";

it("keeps a snapshot after deletion and assigns fresh IDs on every paste", () => {
  const empty = createEmptyDocument();
  const layer = createDrawingLayer(empty, "paint", "Drawing");
  const source = addLayer(empty, layer);
  const copied = copyLayer(source)!;
  layer.strokes.push({ id: "later", points: [], size: 1, mode: "paint", value: 255 });
  const cut = deleteLayer(source, layer.id);
  const first = pasteLayer(cut, copied);
  const second = pasteLayer(first, copied);
  expect(first.layers).toHaveLength(1);
  expect(second.layers).toHaveLength(2);
  expect(new Set(second.layers.map((item) => item.id)).size).toBe(2);
  expect((first.layers[0] as typeof layer).strokes).toHaveLength(0);
  const history = new DocumentHistory();
  history.execute(cut, first, "Paste layer");
  expect(history.undo(first)).toEqual(cut);
  expect(history.redo(cut)).toEqual(first);
  expect(copyLayer(empty)).toBeNull();
});

it("copies group descendants and remaps companion masks", () => {
  const empty = createEmptyDocument();
  const base = createDrawingLayer(empty, "paint", "Child");
  const mask = { ...createDrawingLayer(empty, "mask", "Mask"), parentId: "group" };
  const child = { ...base, parentId: "group", rasterMaskId: mask.id };
  const group = { ...base, id: "group", type: "group" as const };
  const source = { ...empty, layers: [group, child, mask], selection: { layerId: group.id } };
  const copied = copyLayer(source)!;
  const pasted = pasteLayer(empty, copied);
  expect(pasted.layers).toHaveLength(3);
  const root = pasted.layers.find((layer) => layer.type === "group")!;
  const paint = pasted.layers.find((layer) => layer.type === "paint")!;
  const companion = pasted.layers.find((layer) => layer.type === "mask")!;
  expect(root.parentId).toBeNull();
  expect(paint.parentId).toBe(root.id);
  expect(paint.rasterMaskId).toBe(companion.id);
  expect(companion.parentId).toBe(root.id);
});

it("handles editing only on the focused canvas and preserves text inputs and IME", () => {
  const surface = document.createElement("div");
  surface.tabIndex = 0;
  document.body.append(surface);
  const execute = jest.fn();
  const dispose = bindConfiguredShortcuts(surface, DEFAULT_SHORTCUTS, execute);
  const press = (target: HTMLElement, key: string, options: KeyboardEventInit = {}) => {
    const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...options });
    target.dispatchEvent(event);
    return event;
  };
  surface.focus();
  for (const modifier of [{ ctrlKey: true }, { metaKey: true }]) {
    for (const [key, action] of [["c", "copy"], ["x", "cut"], ["v", "paste"]]) {
      expect(press(surface, key, modifier).defaultPrevented).toBe(true);
      expect(execute).toHaveBeenLastCalledWith(action);
    }
  }
  press(surface, "Delete");
  expect(execute).toHaveBeenLastCalledWith("delete");
  expect(press(surface, "c", { ctrlKey: true, isComposing: true }).defaultPrevented).toBe(false);
  expect(press(surface, "v", { ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(false);
  const input = document.createElement("input");
  surface.append(input);
  input.focus();
  for (const key of ["c", "x", "v", "Delete"]) expect(press(input, key, { ctrlKey: key !== "Delete" }).defaultPrevented).toBe(false);
  dispose();
  surface.remove();
});
