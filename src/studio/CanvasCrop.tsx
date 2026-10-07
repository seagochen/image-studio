import { useRef, useState } from "react";
import type { Locale } from "../i18n";
import { editingCopy } from "./editingCopy";
export interface CanvasCropRect {
    x: number;
    y: number;
    width: number;
    height: number;
}
export function CanvasCrop({ width, height, offsetX, offsetY, scale, locale, onApply, onCancel }: {
    width: number;
    height: number;
    offsetX: number;
    offsetY: number;
    scale: number;
    locale: Locale;
    onApply: (rect: CanvasCropRect) => void;
    onCancel: () => void;
}): JSX.Element {
    const copy = editingCopy[locale];
    const [rect, setRect] = useState<CanvasCropRect>({ x: 0, y: 0, width, height });
    const start = useRef<{
        x: number;
        y: number;
    } | null>(null);
    const point = (event: React.PointerEvent<HTMLDivElement>) => { const b = event.currentTarget.getBoundingClientRect(); return { x: Math.max(0, Math.min(width, Math.round((event.clientX - b.left) / scale))), y: Math.max(0, Math.min(height, Math.round((event.clientY - b.top) / scale))) }; };
    const update = (field: keyof CanvasCropRect, value: number) => {
        if (!Number.isFinite(value))
            return;
        setRect(current => {
            const next = { ...current, [field]: Math.round(value) };
            next.x = Math.max(0, Math.min(width - 1, next.x));
            next.y = Math.max(0, Math.min(height - 1, next.y));
            next.width = Math.max(1, Math.min(width - next.x, next.width));
            next.height = Math.max(1, Math.min(height - next.y, next.height));
            return next;
        });
    };
    return <div className="canvas-crop-mode" onKeyDown={event => { if (event.key === "Escape")
        onCancel(); }}>
  <div className="canvas-crop-controls" role="toolbar" aria-label={copy.crop}>
   <strong>{copy.crop}</strong>{(["x", "y", "width", "height"] as const).map(field => <label key={field}>{field.toUpperCase()}<input type="number" autoFocus={field === "x"} aria-label={`Crop ${field}`} value={rect[field]} onChange={e => update(field, e.target.valueAsNumber)}/></label>)}
   <button onClick={() => onApply(rect)}>{copy.apply}</button><button onClick={onCancel}>{copy.cancel}</button>
  </div>
  <div className="canvas-crop-area" style={{ left: offsetX, top: offsetY, width: width * scale, height: height * scale }} onPointerDown={event => { if (event.button !== 0)
        return; event.currentTarget.setPointerCapture(event.pointerId); start.current = point(event); }} onPointerMove={event => { if (!start.current)
        return; const p = point(event), a = start.current; const x = Math.min(a.x, p.x), y = Math.min(a.y, p.y); setRect({ x: Math.min(width - 1, x), y: Math.min(height - 1, y), width: Math.max(1, Math.abs(p.x - a.x)), height: Math.max(1, Math.abs(p.y - a.y)) }); }} onPointerUp={() => { start.current = null; }} onPointerCancel={() => { start.current = null; }}>
   <div className="canvas-crop-box" style={{ left: rect.x * scale, top: rect.y * scale, width: rect.width * scale, height: rect.height * scale }}><i /><i /></div>
  </div>
 </div>;
}
