import { useEffect, useRef, useState } from "react";
import type { DecodedImage } from "../domain/importImage";
import { aiEditorCopy } from "./editorProfiles";

interface Props { source: string; width: number; height: number; result: DecodedImage | null; language: string; cutout: boolean; inspectDetail?: boolean; }
export function AiPreview({ source, width, height, result, language, cutout, inspectDetail = false }: Props): JSX.Element {
  const copy = aiEditorCopy(language);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [space, setSpace] = useState({ width: 600, height: 400 });
  useEffect(() => {
    const element = scrollRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setSpace({ width: Math.max(1, element.clientWidth - 40), height: Math.max(1, element.clientHeight - 40) }));
    observer.observe(element); return () => observer.disconnect();
  }, []);
  const [view, setView] = useState<"original" | "result" | "compare">("compare");
  const [zoom, setZoom] = useState<number | null>(inspectDetail ? 100 : null);
  const [split, setSplit] = useState(50);
  const [background, setBackground] = useState("transparent");
  const previewResult = Boolean(result && view !== "original");
  const image = previewResult && result ? result : { dataUrl: source, width, height };
  return <section className="ai-preview">
    <div className="ai-preview-toolbar">
      {result && (["original", "result", "compare"] as const).map((value) => <button key={value} aria-pressed={view === value} onClick={() => setView(value)}>{copy[value]}</button>)}
      <button aria-pressed={zoom === null} onClick={() => setZoom(null)}>{copy.fit}</button>
      <button aria-pressed={zoom === 100} onClick={() => setZoom(100)}>{copy.detail}</button>
      <label>{copy.zoom}<input aria-label={copy.zoom} type="range" min="25" max="200" step="25" value={zoom ?? 100} onChange={(event) => setZoom(Number(event.target.value))} /></label>
      {cutout && <label>{copy.background}<select value={background} onChange={(event) => setBackground(event.target.value)}>
        <option value="transparent">{copy.transparent}</option><option value="light">{copy.light}</option><option value="dark">{copy.dark}</option>
      </select></label>}
    </div>
    <div ref={scrollRef} className={`ai-preview-scroll ai-preview-background-${background}`}>
      <div className={`ai-preview-image ${zoom === null ? "ai-preview-fit" : ""}`} style={{ width: zoom === null ? Math.min(space.width, space.height * image.width / image.height) : image.width * zoom / 100, aspectRatio: `${image.width}/${image.height}` }}>
        <img src={image.dataUrl} alt={previewResult ? copy.result : copy.original} />
        {result && view === "compare" && <><img className="ai-preview-original" src={source} alt={copy.original} style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }} /><span className="ai-preview-divider" style={{ left: `${split}%` }} /></>}
      </div>
    </div>
    {result && view === "compare" && <label className="ai-comparison-slider">{copy.original}<input aria-label={copy.compare} type="range" min="0" max="100" value={split} onChange={(event) => setSplit(Number(event.target.value))} />{copy.result}</label>}
    <p className="ai-preview-dimensions">{copy.original}: {width} × {height}px{result ? ` · ${copy.actual}: ${result.width} × ${result.height}px` : ""}</p>
  </section>;
}
