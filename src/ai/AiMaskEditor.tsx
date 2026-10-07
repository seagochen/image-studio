import { useEffect, useRef, useState } from "react";
import type { PixelSelectionMask } from "../domain/pixelTools";
import { aiEditorCopy } from "./editorProfiles";

interface Props {
  width: number; height: number; source: string; initialMask: Blob | null;
  editedMask: PixelSelectionMask | null; disabled: boolean; language: string; onChange: (mask: PixelSelectionMask | null) => void;
}

/** Marks are stored in source-image coordinates, independently of preview scaling. */
export function AiMaskEditor({ width, height, source, initialMask, editedMask, disabled, language, onChange }: Props): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lastPoint = useRef<{ x: number; y: number } | null>(null);
  const [detail, setDetail] = useState(false);
  const [erase, setErase] = useState(false);
  const [size, setSize] = useState(32);
  const [resetKey, setResetKey] = useState(0);
  const copy = aiEditorCopy(language);
  const supported = width <= 4096 && height <= 4096;

  useEffect(() => {
    if (!supported) return;
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d", { willReadFrequently: true });
    if (!canvas || !context) return;
    context.globalCompositeOperation = "source-over";
    context.clearRect(0, 0, width, height);
    if (editedMask) {
      const data = context.createImageData(width, height);
      for (let index = 0; index < width * height; index++) {
        data.data[index * 4] = 244; data.data[index * 4 + 1] = 63; data.data[index * 4 + 2] = 94;
        data.data[index * 4 + 3] = editedMask.pixels[index] ? 255 : 0;
      }
      context.putImageData(data, 0, 0); return;
    }
    if (!initialMask) return;
    let active = true;
    const url = URL.createObjectURL(initialMask);
    const image = new Image();
    image.onload = () => {
      if (!active) return;
      context.drawImage(image, 0, 0, width, height);
      const data = context.getImageData(0, 0, width, height);
      for (let index = 0; index < width * height; index++) {
        // Keep the exact grayscale coverage until the user edits it.
        const coverage = data.data[index * 4];
        data.data[index * 4] = 244; data.data[index * 4 + 1] = 63; data.data[index * 4 + 2] = 94;
        data.data[index * 4 + 3] = coverage;
      }
      context.putImageData(data, 0, 0);
    };
    image.src = url;
    return () => { active = false; URL.revokeObjectURL(url); };
  }, [width, height, initialMask, editedMask, resetKey, supported]);

  const publish = () => {
    const data = canvasRef.current?.getContext("2d")?.getImageData(0, 0, width, height).data;
    if (!data) return;
    const pixels = new Uint8Array(width * height);
    for (let index = 0; index < pixels.length; index++) { pixels[index] = data[index * 4 + 3] > 0 ? 1 : 0; }
    onChange({ width, height, pixels });
  };
  const paint = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled || !lastPoint.current) return;
    const canvas = event.currentTarget; const bounds = canvas.getBoundingClientRect();
    const point = { x: (event.clientX - bounds.left) * width / bounds.width, y: (event.clientY - bounds.top) * height / bounds.height };
    const context = canvas.getContext("2d"); if (!context) return;
    context.globalCompositeOperation = erase ? "destination-out" : "source-over";
    context.strokeStyle = "#f43f5e"; context.fillStyle = "#f43f5e";
    context.lineWidth = size; context.lineCap = "round"; context.lineJoin = "round";
    context.beginPath(); context.moveTo(lastPoint.current.x, lastPoint.current.y); context.lineTo(point.x, point.y); context.stroke();
    context.beginPath(); context.arc(point.x, point.y, size / 2, 0, Math.PI * 2); context.fill();
    lastPoint.current = point;
  };
  if (!supported) return <section><p>{copy.maskLarge}</p><img className="ai-large-mask-source" src={source} alt={copy.original} /></section>;
  return <section className="ai-mask-editor">
    <div className="ai-preview-toolbar">
      <button aria-pressed={!detail} onClick={() => setDetail(false)}>{copy.fit}</button>
      <button aria-pressed={detail} onClick={() => setDetail(true)}>{copy.detail}</button>
      <button disabled={disabled} aria-pressed={!erase} onClick={() => setErase(false)}>{copy.draw}</button>
      <button disabled={disabled} aria-pressed={erase} onClick={() => setErase(true)}>{copy.erase}</button>
      <button disabled={disabled} onClick={() => { canvasRef.current?.getContext("2d")?.clearRect(0, 0, width, height); publish(); }}>{copy.clear}</button>
      <button disabled={disabled} onClick={() => { onChange(null); setResetKey((key) => key + 1); }}>{copy.reset}</button>
      <label>{copy.size}<input type="range" min="1" max="256" value={size} disabled={disabled} onChange={(event) => setSize(Number(event.target.value))} /><output>{size}px</output></label>
    </div>
    <div className="ai-mask-scroll"><div className={`ai-mask-surface ${detail ? "ai-mask-detail" : ""}`} style={{ width: detail ? width : undefined, aspectRatio: `${width}/${height}` }}>
      <img src={source} alt={copy.original} draggable={false} />
      <canvas ref={canvasRef} width={width} height={height} aria-label={copy.mask}
        onPointerDown={(event) => {
          if (disabled || event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          const bounds = event.currentTarget.getBoundingClientRect();
          lastPoint.current = { x: (event.clientX - bounds.left) * width / bounds.width, y: (event.clientY - bounds.top) * height / bounds.height };
          paint(event);
        }} onPointerMove={paint} onPointerUp={(event) => { if (!lastPoint.current) return; paint(event); lastPoint.current = null; publish(); }}
        onPointerCancel={() => { lastPoint.current = null; publish(); }} onLostPointerCapture={() => { if (lastPoint.current) { lastPoint.current = null; publish(); } }} />
    </div></div>
  </section>;
}
