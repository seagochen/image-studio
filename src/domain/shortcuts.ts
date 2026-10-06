export type StudioAction = "undo" | "redo" | null;

type ShortcutEvent = Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "shiftKey">
  & Partial<Pick<KeyboardEvent, "altKey" | "isComposing" | "keyCode" | "defaultPrevented">>;

export function shortcutAction(event: ShortcutEvent): StudioAction {
  if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.altKey
    || event.ctrlKey === event.metaKey) return null;
  const key = event.key.toLowerCase();
  if (key === "z") return event.shiftKey ? "redo" : "undo";
  if (event.ctrlKey && !event.shiftKey && key === "y") return "redo";
  return null;
}

export function bindCanvasHistoryShortcuts(
  surface: HTMLElement, execute: (action: Exclude<StudioAction, null>) => void,
): () => void {
  return bindCanvasShortcuts(surface, shortcutAction, execute);
}

export function bindCanvasShortcuts<Action extends string>(
  surface: HTMLElement, resolve: (event: KeyboardEvent) => Action | null, execute: (action: Action) => void,
): () => void {
  let composing = false;
  const startComposition = () => { composing = true; };
  const endComposition = () => { composing = false; };
  const onKeyDown = (event: KeyboardEvent) => {
    // Descendant controls own their keys, even when they are inside the canvas surface.
    if (surface.ownerDocument.activeElement !== surface || event.target !== surface || composing) return;
    const action = resolve(event);
    if (!action) return;
    event.preventDefault();
    execute(action);
  };
  surface.addEventListener("keydown", onKeyDown);
  surface.addEventListener("compositionstart", startComposition);
  surface.addEventListener("compositionend", endComposition);
  surface.addEventListener("blur", endComposition);
  return () => {
    surface.removeEventListener("keydown", onKeyDown);
    surface.removeEventListener("compositionstart", startComposition);
    surface.removeEventListener("compositionend", endComposition);
    surface.removeEventListener("blur", endComposition);
  };
}

export type EditAction = "copy" | "cut" | "paste" | "delete";

export function editShortcutAction(event: ShortcutEvent): EditAction | null {
  if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.altKey || event.shiftKey) return null;
  if (event.key === "Delete" && !event.ctrlKey && !event.metaKey) return "delete";
  if (event.ctrlKey === event.metaKey) return null;
  const key = event.key.toLowerCase();
  return key === "c" ? "copy" : key === "x" ? "cut" : key === "v" ? "paste" : null;
}
