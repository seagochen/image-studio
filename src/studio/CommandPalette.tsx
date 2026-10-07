import { useEffect, useMemo, useRef, useState } from "react";
import { invokeEditorCommand, searchEditorCommands, type EditorCommand } from "../domain/editorCommands";
import type { Locale } from "../i18n";
import { trapDialogFocus } from "./dialogFocus";
import { workbenchCopy } from "./workbenchCopy";

export function CommandPalette({ commands, locale, onClose }: {
  commands: readonly EditorCommand[]; locale: Locale; onClose: () => void;
}): JSX.Element {
  const copy = workbenchCopy[locale];
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const hits = useMemo(() => searchEditorCommands(commands, query).slice(0, 16), [commands, query]);
  const index = Math.min(active, Math.max(0, hits.length - 1));
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    input.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      trapDialogFocus(event, root.current);
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); }
    };
    document.addEventListener("keydown", keydown);
    return () => { document.removeEventListener("keydown", keydown); if (previous?.isConnected) previous.focus(); };
  }, [onClose]);
  useEffect(() => { root.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: "nearest" }); }, [index]);
  const run = (command: EditorCommand) => {
    if (!command.enabled) return;
    onClose();
    invokeEditorCommand(commands, command.id);
  };
  return <div className="command-palette-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={root} className="command-palette" role="dialog" aria-modal="true" aria-label={copy.commands}>
      <input ref={input} role="combobox" aria-label={copy.search} aria-expanded="true" aria-controls="studio-command-results"
        aria-activedescendant={hits.length ? `studio-command-${index}` : undefined} autoComplete="off" value={query} placeholder={copy.search}
        onChange={(event) => { setQuery(event.target.value); setActive(0); }} onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault(); setActive(Math.max(0, Math.min(hits.length - 1, index + (event.key === "ArrowDown" ? 1 : -1))));
          } else if (event.key === "Enter" && hits[index]) { event.preventDefault(); run(hits[index]); }
        }} />
      <div id="studio-command-results" role="listbox" aria-label={copy.commands} className="command-results">
        {hits.map((command, row) => <div key={command.id} id={`studio-command-${row}`} role="option"
          aria-selected={row === index} aria-disabled={!command.enabled} className={`command-result${row === index ? " active" : ""}${!command.enabled ? " unavailable" : ""}`}
          onPointerMove={() => setActive(row)} onPointerDown={(event) => event.preventDefault()} onClick={() => run(command)}>
          <span>{command.label}<small>{command.category}</small></span><kbd>{command.shortcut}</kbd>
        </div>)}
        {!hits.length && <p role="status">{copy.noResults}</p>}
      </div>
      <footer>{copy.hint}</footer>
    </div>
  </div>;
}
