import { useEffect, useRef, useState } from "react";
import type { CanvasResize } from "../adapters/conventionalEditor";
import type { CanvasAnchor } from "../domain/layoutCommands";
import { MAX_CANVAS_EDGE, MAX_CANVAS_PIXELS } from "../shared/imageStudioDomain";
import type { Locale } from "../i18n";
import { trapDialogFocus } from "./dialogFocus";

const en = {
  title: "Canvas size", width: "Width", height: "Height", lockRatio: "Lock aspect ratio", anchor: "Anchor",
  help: "Changes the canvas only. Layer pixels are not stretched; content outside the canvas is hidden, not deleted.",
  tooLarge: "The canvas exceeds the maximum pixel count.", apply: "Apply", cancel: "Cancel",
  anchors: ["Top left", "Top", "Top right", "Left", "Center", "Right", "Bottom left", "Bottom", "Bottom right"],
};
type Copy = typeof en;
export const canvasSizeCopy: Record<Locale, Copy> = {
  en,
  ja: { title: "キャンバスサイズ", width: "幅", height: "高さ", lockRatio: "縦横比を固定", anchor: "基準位置",
    help: "キャンバスだけを変更します。レイヤーの画素は伸縮されず、キャンバス外の内容は削除されずに非表示になります。",
    tooLarge: "キャンバスの画素数が上限を超えています。", apply: "適用", cancel: "キャンセル",
    anchors: ["左上", "上", "右上", "左", "中央", "右", "左下", "下", "右下"] },
  "zh-CN": { title: "画布大小", width: "宽度", height: "高度", lockRatio: "锁定宽高比", anchor: "锚点",
    help: "只改变画布。图层像素不会被拉伸；超出画布的内容只是不显示，不会被删除。",
    tooLarge: "画布像素数超过上限。", apply: "应用", cancel: "取消",
    anchors: ["左上", "上", "右上", "左", "居中", "右", "左下", "下", "右下"] },
  "zh-TW": { title: "畫布大小", width: "寬度", height: "高度", lockRatio: "鎖定寬高比", anchor: "錨點",
    help: "只變更畫布。圖層像素不會被拉伸；超出畫布的內容只是不顯示，不會被刪除。",
    tooLarge: "畫布像素數超過上限。", apply: "套用", cancel: "取消",
    anchors: ["左上", "上", "右上", "左", "置中", "右", "左下", "下", "右下"] },
};

const ANCHORS: CanvasAnchor[] = [0, 0.5, 1].flatMap((y) => [0, 0.5, 1].map((x) => ({ x, y }) as CanvasAnchor));
export const CENTER_ANCHOR: CanvasAnchor = { x: 0.5, y: 0.5 };

export function canvasResizeFits(value: CanvasResize): boolean {
  return value.width * value.height <= MAX_CANVAS_PIXELS;
}

interface FieldsProps {
  value: CanvasResize;
  locale: Locale;
  onChange: (value: CanvasResize) => void;
}

/** Shared by the conventional editor's size tool and the document-level canvas size dialog. */
export function CanvasSizeFields({ value, locale, onChange }: FieldsProps): JSX.Element {
  const t = canvasSizeCopy[locale];
  const [lockRatio, setLockRatio] = useState(false);
  const resize = (dimension: "width" | "height", raw: number) => {
    const safe = Math.max(1, Math.min(MAX_CANVAS_EDGE, Math.round(raw || 1)));
    if (!lockRatio) { onChange({ ...value, [dimension]: safe }); return; }
    const ratio = value.width / value.height;
    onChange(dimension === "width"
      ? { ...value, width: safe, height: Math.max(1, Math.min(MAX_CANVAS_EDGE, Math.round(safe / ratio))) }
      : { ...value, height: safe, width: Math.max(1, Math.min(MAX_CANVAS_EDGE, Math.round(safe * ratio))) });
  };
  return <div className="canvas-size-fields">
    <div className="editor-number-grid">
      <label>{t.width}<input type="number" min="1" max={MAX_CANVAS_EDGE} value={value.width} onChange={(event) => resize("width", Number(event.target.value))} /></label>
      <label>{t.height}<input type="number" min="1" max={MAX_CANVAS_EDGE} value={value.height} onChange={(event) => resize("height", Number(event.target.value))} /></label>
    </div>
    <label className="editor-check"><input type="checkbox" checked={lockRatio} onChange={(event) => setLockRatio(event.target.checked)} /> {t.lockRatio}</label>
    <fieldset className="canvas-anchor-grid">
      <legend>{t.anchor}</legend>
      {ANCHORS.map((anchor, index) => <button key={index} type="button" aria-label={t.anchors[index]} title={t.anchors[index]}
        aria-pressed={anchor.x === value.anchor.x && anchor.y === value.anchor.y} onClick={() => onChange({ ...value, anchor })} />)}
    </fieldset>
    <p className="canvas-size-help">{t.help}</p>
    {!canvasResizeFits(value) && <p className="field-error" role="alert">{t.tooLarge}</p>}
  </div>;
}

interface DialogProps {
  width: number;
  height: number;
  locale: Locale;
  onApply: (value: CanvasResize) => void;
  onClose: () => void;
}

export function CanvasSizeDialog({ width, height, locale, onApply, onClose }: DialogProps): JSX.Element {
  const t = canvasSizeCopy[locale];
  const [value, setValue] = useState<CanvasResize>({ width, height, anchor: CENTER_ANCHOR });
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = window.document.activeElement as HTMLElement | null;
    root.current?.querySelector<HTMLInputElement>("input")?.focus();
    return () => previous?.focus();
  }, []);
  const unchanged = value.width === width && value.height === height;
  return <div className="pixel-editor-backdrop" role="dialog" aria-modal="true" aria-label={t.title} ref={root}
    onKeyDown={(event) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
      trapDialogFocus(event.nativeEvent, root.current);
    }}>
    <form className="canvas-size-dialog" onSubmit={(event) => { event.preventDefault(); if (!unchanged && canvasResizeFits(value)) onApply(value); }}>
      <h2>{t.title}</h2>
      <CanvasSizeFields value={value} locale={locale} onChange={setValue} />
      <footer>
        <button type="button" onClick={onClose}>{t.cancel}</button>
        <button type="submit" className="primary" disabled={unchanged || !canvasResizeFits(value)}>{t.apply}</button>
      </footer>
    </form>
  </div>;
}
