import { editShortcutAction, type EditAction, bindCanvasShortcuts } from "./shortcuts";
export const SHORTCUT_ACTIONS = ["undo","redo","select","hand","brush","eraser","eyedropper","text","shape","marquee","magicWand","airbrush","smudge","clone","gradient","fit"] as const;
export type ShortcutAction = typeof SHORTCUT_ACTIONS[number];
export type ShortcutBindings = Record<ShortcutAction,string>;
export const DEFAULT_SHORTCUTS: ShortcutBindings = {undo:"Mod+z",redo:"Mod+Shift+z",select:"v",hand:"h",brush:"b",eraser:"e",eyedropper:"i",text:"t",shape:"u",marquee:"m",magicWand:"w",airbrush:"a",smudge:"",clone:"s",gradient:"g",fit:"f"};
const STORAGE_KEY = "skillsmaster.image-studio.shortcuts.v1";
type KeyEvent = Pick<KeyboardEvent,"key"|"ctrlKey"|"metaKey"|"altKey"|"shiftKey"|"isComposing"|"keyCode"|"defaultPrevented">;

export function shortcutFromEvent(event: KeyEvent): string | null {
  if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.altKey || (event.ctrlKey && event.metaKey)) return null;
  const key = event.key.toLowerCase();
  if (!/^[a-z0-9]$/.test(key)) return null;
  return `${event.ctrlKey || event.metaKey ? "Mod+" : ""}${event.shiftKey ? "Shift+" : ""}${key}`;
}
export function validShortcut(value: string): boolean {
  if (!value) return true;
  if (!/^(Mod\+)?(Shift\+)?[a-z0-9]$/.test(value)) return false;
  const key = value.at(-1)!;
  // Keep browser navigation, clipboard and developer shortcuts available.
  return !value.startsWith("Mod+") || !"acvxlwtnrqpfhoju0123456789".includes(key);
}
export function validateBindings(bindings: ShortcutBindings): boolean {
  const values = SHORTCUT_ACTIONS.map((action) => bindings[action]);
  return !(bindings.redo === DEFAULT_SHORTCUTS.redo && SHORTCUT_ACTIONS.some((action) => action !== "redo" && bindings[action] === "Mod+y")) && values.every((value) => typeof value === "string" && validShortcut(value)) && new Set(values.filter(Boolean)).size === values.filter(Boolean).length;
}
export function loadShortcuts(storage?: Pick<Storage,"getItem">): ShortcutBindings {
  try {
    const value = JSON.parse((storage ?? localStorage).getItem(STORAGE_KEY) ?? "null");
    if (value?.version === 1 && value.bindings && validateBindings(value.bindings)) return {...value.bindings};
  } catch { /* Invalid or unavailable local preferences use deterministic defaults. */ }
  return {...DEFAULT_SHORTCUTS};
}
export function saveShortcuts(bindings: ShortcutBindings, storage: Pick<Storage,"setItem"> = localStorage): void {
  if (!validateBindings(bindings)) throw new Error("Invalid or conflicting shortcuts");
  storage.setItem(STORAGE_KEY,JSON.stringify({version:1,bindings}));
}
export function configuredShortcutAction(event: KeyEvent, bindings: ShortcutBindings): ShortcutAction | null {
  const key = shortcutFromEvent(event); if (!key) return null;
  const action = SHORTCUT_ACTIONS.find((candidate) => bindings[candidate] === key);
  if (action) return action;
  if (event.ctrlKey && key === "Mod+y" && bindings.redo === DEFAULT_SHORTCUTS.redo) return "redo";
  return null;
}
export function bindConfiguredShortcuts(surface: HTMLElement, bindings: ShortcutBindings, execute: (action: ShortcutAction | EditAction) => void): () => void {
  return bindCanvasShortcuts(surface, (event) => event.repeat ? null : editShortcutAction(event) ?? configuredShortcutAction(event,bindings), execute);
}
