import { useEffect, useRef, useState } from "react";
import { DEFAULT_SHORTCUTS, SHORTCUT_ACTIONS, saveShortcuts, shortcutFromEvent, validShortcut, type ShortcutAction, type ShortcutBindings } from "../domain/shortcutSettings";
import { trapDialogFocus } from "./dialogFocus";
import type { FileCopy } from "./fileCopy";
import { ProductIcon } from "./ProductIcon";
interface Props { bindings: ShortcutBindings; labels: Record<ShortcutAction,string>; copy: FileCopy; onSave: (bindings: ShortcutBindings) => void; onClose: () => void }
export function ShortcutSettingsDialog({bindings,labels,copy:t,onSave,onClose}: Props): JSX.Element {
  const [draft,setDraft] = useState({...bindings}), [error,setError] = useState("");
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null; root.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => previous?.focus();
  },[]);
  return <div className="ai-dialog-backdrop" role="dialog" aria-modal="true" aria-label={t.settings}>
    <section ref={root} className="ai-dialog shortcut-settings" onKeyDown={(event) => {
      trapDialogFocus(event.nativeEvent,root.current); if (event.key === "Escape") {event.preventDefault();onClose();} event.stopPropagation();
    }}><header><h2>{t.shortcuts}</h2><button aria-label={t.close} onClick={onClose}><ProductIcon name="close" /></button></header><p>{t.shortcutHint}</p>
      <div className="shortcut-list">{SHORTCUT_ACTIONS.map((action) => <div className="shortcut-row" key={action}>
        <label htmlFor={`shortcut-${action}`}>{labels[action]}</label>
        <input id={`shortcut-${action}`} readOnly value={draft[action].replace("Mod+","Ctrl/⌘+")} placeholder="—" onKeyDown={(event) => {
          if (["Tab","Escape","Control","Meta","Shift"].includes(event.key)) return;
          const value = shortcutFromEvent(event.nativeEvent); event.preventDefault();
          if (!value || !validShortcut(value)) {setError(t.invalidKey);return;}
          if (SHORTCUT_ACTIONS.some((other) => other !== action && draft[other] === value)
            || (action !== "redo" && value === "Mod+y" && draft.redo === DEFAULT_SHORTCUTS.redo)) {setError(t.conflict);return;}
          setDraft({...draft,[action]:value});setError("");
        }}/><button aria-label={`${t.clear}: ${labels[action]}`} onClick={() => {setDraft({...draft,[action]:""});setError("");}}>{t.clear}</button>
      </div>)}</div>
      {error && <p role="alert" className="ai-error">{error}</p>}
      <footer><button onClick={() => {setDraft({...DEFAULT_SHORTCUTS});setError("");}}>{t.defaults}</button><button onClick={onClose}>{t.cancel}</button>
        <button className="primary" onClick={() => {try {saveShortcuts(draft);onSave(draft);} catch {setError(t.storageFailed);}}}>{t.save}</button></footer>
    </section>
  </div>;
}
