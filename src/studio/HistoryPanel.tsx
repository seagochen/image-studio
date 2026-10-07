import type { DocumentHistory } from "../domain/history";
import type { Locale, MessageKey } from "../i18n";
import { workbenchCopy } from "./workbenchCopy";

export function HistoryPanel({ timeline, locale, onUndo, onRedo, onSeek, disabled, t }: {
  timeline: DocumentHistory["timeline"]; locale: Locale; onUndo: () => void; onRedo: () => void;
  onSeek: (index: number) => void; disabled?: boolean;
  t: (key: MessageKey) => string;
}): JSX.Element {
  const copy = workbenchCopy[locale];
  return <div className="history-panel">
    <div className="history-controls">
      <button disabled={disabled || !timeline.undo.length} onClick={onUndo}>{t("undo")}</button>
      <button disabled={disabled || !timeline.redo.length} onClick={onRedo}>{t("redo")}</button>
    </div>
    {!timeline.undo.length && !timeline.redo.length ? <p className="panel-empty">{copy.empty}</p> : <>
      <ol aria-label={copy.earlier} className="history-states">
        <li aria-current={!timeline.undo.length ? "true" : undefined} className={!timeline.undo.length ? "current" : ""}><button disabled={disabled || !timeline.undo.length} onClick={() => onSeek(0)}>{copy.initial}</button></li>
        {timeline.undo.map((label, index) => <li key={index} aria-current={index === timeline.undo.length - 1 ? "true" : undefined} className={index === timeline.undo.length - 1 ? "current" : ""}>
          <button disabled={disabled || index === timeline.undo.length - 1} onClick={() => onSeek(index + 1)}>{label}</button>{index === timeline.undo.length - 1 && <small>{copy.current}</small>}
        </li>)}
      </ol>
      <ol aria-label={copy.later} className="history-states redo-states">
        {timeline.redo.map((label, index) => <li key={index}><button disabled={disabled} onClick={() => onSeek(timeline.undo.length + index + 1)}>{label}</button></li>)}
      </ol>
    </>}
  </div>;
}
