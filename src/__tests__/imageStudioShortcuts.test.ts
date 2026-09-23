import { bindCanvasHistoryShortcuts } from "../domain/shortcuts";

describe("Image Studio canvas history keyboard scope", () => {
  let surface: HTMLElement;
  let execute: jest.Mock;
  let dispose: () => void;
  const press = (target: EventTarget, key: string, options: KeyboardEventInit = {}) => {
    const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...options });
    target.dispatchEvent(event);
    return event;
  };
  beforeEach(() => {
    document.body.innerHTML = '<div id="canvas" tabindex="0"></div><input id="name"><section role="dialog"><button id="modal">Close</button></section>';
    surface = document.getElementById("canvas")!;
    execute = jest.fn();
    dispose = bindCanvasHistoryShortcuts(surface, execute);
  });
  afterEach(() => { dispose(); document.body.innerHTML = ""; });

  it("handles history only while the canvas itself holds focus", () => {
    expect(press(surface, "z", { ctrlKey: true }).defaultPrevented).toBe(false);
    surface.focus();
    for (const options of [{ ctrlKey: true }, { metaKey: true }]) {
      expect(press(surface, "z", options).defaultPrevented).toBe(true);
      expect(execute).toHaveBeenLastCalledWith("undo");
      press(surface, "Z", { ...options, shiftKey: true });
      expect(execute).toHaveBeenLastCalledWith("redo");
    }
    press(surface, "y", { ctrlKey: true });
    expect(execute).toHaveBeenLastCalledWith("redo");
    expect(execute).toHaveBeenCalledTimes(5);
  });

  it("preserves typing, text undo and deletion in editable descendants", () => {
    for (const markup of ['<input>', '<textarea></textarea>', '<select><option>A</option></select>', '<div contenteditable="true" tabindex="0"><span>text</span></div>']) {
      surface.innerHTML = markup;
      const editor = surface.firstElementChild as HTMLElement;
      editor.focus();
      for (const key of ["z", "y", "Backspace", "Delete", "i", "f", " "]) {
        expect(press(editor.lastElementChild ?? editor, key, { ctrlKey: true }).defaultPrevented).toBe(false);
      }
    }
    expect(execute).not.toHaveBeenCalled();
  });

  it("ignores IME lifecycle, composing flags and legacy composition codes", () => {
    surface.focus();
    surface.dispatchEvent(new Event("compositionstart", { bubbles: true }));
    expect(press(surface, "z", { ctrlKey: true }).defaultPrevented).toBe(false);
    surface.dispatchEvent(new Event("compositionend", { bubbles: true }));
    expect(press(surface, "z", { ctrlKey: true, isComposing: true }).defaultPrevented).toBe(false);
    const legacy = new KeyboardEvent("keydown", { key: "z", ctrlKey: true, cancelable: true });
    Object.defineProperty(legacy, "keyCode", { value: 229 });
    surface.dispatchEvent(legacy);
    expect(legacy.defaultPrevented).toBe(false);
    expect(execute).not.toHaveBeenCalled();
    press(surface, "z", { ctrlKey: true });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("preserves browser keys, tools, deletion, navigation and AltGr", () => {
    surface.focus();
    for (const key of ["l", "t", "w", "n", "r", "p", "f", "s", "c", "v", "x", "a"]) {
      for (const options of [{ ctrlKey: true }, { metaKey: true }]) expect(press(surface, key, options).defaultPrevented).toBe(false);
    }
    for (const key of ["b", "e", "i", "m", "w", "t", "g", "f", " ", "[", "]", "Delete", "Backspace", "ArrowLeft", "Escape", "+", "-", "0", "Tab"]) {
      expect(press(surface, key).defaultPrevented).toBe(false);
    }
    for (const options of [{ ctrlKey: true, altKey: true }, { ctrlKey: true, metaKey: true }]) {
      expect(press(surface, "z", options).defaultPrevented).toBe(false);
    }
    expect(press(surface, "y", { metaKey: true }).defaultPrevented).toBe(false);
    expect(execute).not.toHaveBeenCalled();
  });

  it("releases focus scope and removes listeners during suspension or unmount", () => {
    surface.focus();
    surface.dispatchEvent(new Event("compositionstart"));
    for (const id of ["name", "modal"]) {
      const target = document.getElementById(id)!;
      target.focus();
      expect(press(target, "z", { ctrlKey: true }).defaultPrevented).toBe(false);
    }
    surface.focus();
    press(surface, "z", { ctrlKey: true });
    expect(execute).toHaveBeenCalledTimes(1);
    dispose();
    expect(press(surface, "z", { ctrlKey: true }).defaultPrevented).toBe(false);
    dispose = bindCanvasHistoryShortcuts(surface, execute);
    press(surface, "z", { ctrlKey: true });
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("respects an event already handled by another control", () => {
    surface.focus();
    const event = new KeyboardEvent("keydown", { key: "z", ctrlKey: true, cancelable: true });
    event.preventDefault();
    surface.dispatchEvent(event);
    expect(execute).not.toHaveBeenCalled();
  });
});
