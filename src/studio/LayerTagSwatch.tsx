import { useEffect, useRef, useState } from "react";
import { hexToHsv, hsvToHex } from "../domain/color";
import type { Locale } from "../i18n";
import { ColorWheel } from "./ColorWheel";

export const layerTagCopy: Record<Locale, { color: string; brightness: string }> = {
  en: { color: "Layer color", brightness: "Brightness" },
  ja: { color: "レイヤーカラー", brightness: "明るさ" },
  "zh-CN": { color: "图层代表色", brightness: "亮度" },
  "zh-TW": { color: "圖層代表色", brightness: "亮度" },
};

const POPOVER_WIDTH = 170;
const POPOVER_HEIGHT = 216;
const POPOVER_GAP = 6;

interface Props {
  color: string;
  layerName: string;
  locale: Locale;
  onChange: (color: string) => void;
}

/** The layer's representative colour dot; clicking it opens a colour wheel popover. */
export function LayerTagSwatch({ color, layerName, locale, onChange }: Props): JSX.Element {
  const copy = layerTagCopy[locale];
  // Fixed placement escapes the scrolling layer list, which would clip an absolute popover.
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const root = useRef<HTMLSpanElement>(null);
  const hsv = hexToHsv(color);

  useEffect(() => {
    if (!position) return;
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !root.current?.contains(event.target as Node)) setPosition(null);
    };
    window.document.addEventListener("mousedown", close);
    window.document.addEventListener("keydown", close);
    window.addEventListener("resize", close);
    return () => {
      window.document.removeEventListener("mousedown", close);
      window.document.removeEventListener("keydown", close);
      window.removeEventListener("resize", close);
    };
  }, [position]);

  const toggle = (dot: HTMLElement) => {
    if (position) { setPosition(null); return; }
    const rect = dot.getBoundingClientRect();
    const below = rect.bottom + POPOVER_GAP;
    setPosition({
      left: Math.max(8, Math.min(rect.left - 8, window.innerWidth - POPOVER_WIDTH - 8)),
      top: below + POPOVER_HEIGHT > window.innerHeight ? Math.max(8, rect.top - POPOVER_GAP - POPOVER_HEIGHT) : below,
    });
  };

  // Row-level handlers select the layer or start a drag; the swatch must do neither.
  return <span className="layer-tag" ref={root} onClick={(event) => event.stopPropagation()}
    onDragStart={(event) => { event.preventDefault(); event.stopPropagation(); }}>
    <button type="button" className="layer-tag-dot" style={{ background: color }} aria-haspopup="dialog" aria-expanded={Boolean(position)}
      aria-label={`${copy.color}: ${layerName}`} title={`${copy.color} ${color.toUpperCase()}`} onClick={(event) => toggle(event.currentTarget)} />
    {position && <div className="layer-tag-popover" role="dialog" aria-label={copy.color} style={{ ...position, width: POPOVER_WIDTH }}>
      <ColorWheel value={color} label={copy.color} onChange={onChange} />
      <label className="color-slider-row"><span>{copy.brightness}</span><input type="range" min="20" max="100" value={Math.round(hsv.value * 100)}
        aria-label={copy.brightness} onChange={(event) => onChange(hsvToHex(hsv.hue, hsv.saturation, Number(event.target.value) / 100))} /></label>
      <code>{color.toUpperCase()}</code>
    </div>}
  </span>;
}
