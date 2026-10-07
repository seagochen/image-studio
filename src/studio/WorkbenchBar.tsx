import type { ReactNode } from "react";
import { editingCopy } from "./editingCopy";
import type { Locale } from "../i18n";
import { workbenchCopy } from "./workbenchCopy";

export function WorkbenchBar({ title, width, height, locale, onCommands, onCrop, snap, onSnap, layoutControls }: {
  title: string; width: number; height: number; locale: Locale;
  layoutControls?: ReactNode;
  onCommands: () => void; onCrop: () => void; snap: boolean; onSnap: () => void;
}): JSX.Element {
  return <div className="workbench-document-bar">
    <span className="workbench-document-tab">{title}<small>{width} × {height} px · RGB</small></span>
    <span className="toolbar-spacer" />
    {layoutControls}
    <button onClick={onCrop}>{editingCopy[locale].crop}</button>
    <button aria-pressed={snap} onClick={onSnap}>{editingCopy[locale].snap}</button>
    <button className="command-palette-trigger" aria-label={workbenchCopy[locale].commands} aria-keyshortcuts="Control+K Meta+K" aria-haspopup="dialog" onClick={onCommands}>{workbenchCopy[locale].commands}<kbd>Ctrl / ⌘ K</kbd></button>
  </div>;
}
