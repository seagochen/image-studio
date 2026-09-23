import { useEffect, useRef, useState } from "react";
import type { ConventionalEditorInput, ConventionalEditorOutcome } from "../adapters/conventionalEditor";
import { fullImageQuad, validOutputSize, validQuad, warpPerspective, type Pixels, type Quad } from "../domain/perspective";
import { trapDialogFocus } from "./dialogFocus";
import { perspectiveCopy } from "./perspectiveCopy";
import { MAX_CANVAS_EDGE } from "../../../../frontend/src/shared/imageStudioDomain";
import type { Locale } from "../i18n";

interface Props { input: ConventionalEditorInput; language: Locale; onComplete: (outcome: ConventionalEditorOutcome) => void }

export function PerspectiveDialog({ input, language, onComplete }: Props): JSX.Element {
  const t = perspectiveCopy[language];
  const [quad, setQuad] = useState<Quad>(() => fullImageQuad(input.width, input.height));
  const [width, setWidth] = useState(input.width), [height, setHeight] = useState(input.height);
  const [source, setSource] = useState<Pixels | null>(null);
  const [failed, setFailed] = useState(false), [busy, setBusy] = useState(false), [previewReady, setPreviewReady] = useState(false);
  const [progress, setProgress] = useState(0);
  const root = useRef<HTMLDivElement>(null), preview = useRef<HTMLCanvasElement>(null);
  const outputController = useRef<AbortController | null>(null);
  const complete = useRef(onComplete); complete.current = onComplete;
  const valid = validQuad(quad, input.width, input.height) && validOutputSize(width, height);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    root.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => { outputController.current?.abort(); previous?.focus(); };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      if (!validOutputSize(input.width, input.height)) throw new Error("Image dimensions exceed editing limits");
      const response = await fetch(input.sourceUrl, { signal: controller.signal });
      if (!response.ok) throw new Error("Image fetch failed");
      const bitmap = await createImageBitmap(await response.blob());
      try {
        controller.signal.throwIfAborted();
        if (bitmap.width !== input.width || bitmap.height !== input.height) throw new Error("Image dimensions do not match layer");
        const canvas = document.createElement("canvas"); canvas.width = bitmap.width; canvas.height = bitmap.height;
        const context = canvas.getContext("2d"); if (!context) throw new Error("Canvas unavailable");
        context.drawImage(bitmap, 0, 0);
        setSource(context.getImageData(0, 0, canvas.width, canvas.height));
      } finally { bitmap.close(); }
    })().catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [input]);

  useEffect(() => {
    const controller = new AbortController();
    setPreviewReady(false);
    if (!source || !valid || busy) return () => controller.abort();
    const scale = Math.min(1, 640 / Math.max(width, height));
    const timer = window.setTimeout(() => {
      void warpPerspective(source, quad, Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)), controller.signal)
        .then((pixels) => {
          if (controller.signal.aborted || !preview.current) return;
          drawPixels(preview.current, pixels); setPreviewReady(true);
        }).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    }, 35);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [source, quad, width, height, valid, busy]);

  const moveCorner = (index: number, x: number, y: number) => {
    setQuad((previous) => previous.map((p, i) => i === index ? {
      x: Math.max(0, Math.min(input.width, x)), y: Math.max(0, Math.min(input.height, y)),
    } : p) as Quad);
  };
  const save = async () => {
    if (!source || !valid || busy) return;
    const controller = new AbortController(); outputController.current = controller;
    setBusy(true); setFailed(false); setProgress(0);
    try {
      const pixels = await warpPerspective(source, quad, width, height, controller.signal, setProgress);
      const canvas = document.createElement("canvas"); drawPixels(canvas, pixels);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("PNG encoding failed")), "image/png"));
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob);
      });
      controller.signal.throwIfAborted();
      onComplete({ kind: "saved", output: { dataUrl, mimeType: "image/png", width, height } });
    } catch { if (!controller.signal.aborted) setFailed(true); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  };

  return <div ref={root} className="pixel-editor-backdrop" role="dialog" aria-modal="true" aria-label={t.title} onKeyDown={(event) => {
    trapDialogFocus(event.nativeEvent, root.current);
    if (event.key === "Escape") { event.preventDefault(); outputController.current?.abort(); complete.current({ kind: "cancelled" }); }
    event.stopPropagation();
  }}>
    <div className="perspective-editor">
      <header><h2>{t.title}</h2><button disabled={busy} onClick={() => { setQuad(fullImageQuad(input.width, input.height)); setWidth(input.width); setHeight(input.height); }}>{t.reset}</button>
        <button onClick={() => { outputController.current?.abort(); onComplete({ kind: "cancelled" }); }}>{t.cancel}</button>
        <button className="primary" disabled={!source || !valid || busy} onClick={() => void save()}>{t.apply}</button></header>
      <p>{t.hint}</p>
      <fieldset disabled={busy}><div className="perspective-views">
        <section><h3>{t.source}</h3><div className="perspective-source" style={{ aspectRatio: `${input.width} / ${input.height}`, width: `min(100%, ${50 * input.width / input.height}vh)` }}>
          <img src={input.sourceUrl} alt={input.name} draggable={false} />
          <svg viewBox={`0 0 ${input.width} ${input.height}`} preserveAspectRatio="none" aria-hidden="true"><polygon points={quad.map((p) => `${p.x},${p.y}`).join(" ")} /></svg>
          {quad.map((p, index) => <button key={index} className="perspective-corner" aria-label={`${t.corner} ${index + 1}`} style={{ left: `${100 * p.x / input.width}%`, top: `${100 * p.y / input.height}%` }}
            onPointerDown={(event) => { event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId); }}
            onPointerMove={(event) => {
              if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
              const bounds = event.currentTarget.parentElement!.getBoundingClientRect();
              moveCorner(index, (event.clientX - bounds.left) / bounds.width * input.width, (event.clientY - bounds.top) / bounds.height * input.height);
            }}
            onPointerUp={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
            onKeyDown={(event) => {
              const steps: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
              const step = steps[event.key]; if (!step) return; event.preventDefault();
              moveCorner(index, p.x + step[0] * (event.shiftKey ? 10 : 1), p.y + step[1] * (event.shiftKey ? 10 : 1));
            }}>{index + 1}</button>)}
        </div></section>
        <section><h3>{t.preview}</h3><div className="perspective-preview"><canvas ref={preview} hidden={!previewReady} />{!previewReady && <p>{!valid ? t.invalid : t.loading}</p>}</div></section>
      </div>
      <div className="perspective-dimensions"><label>{t.width} (px)<input type="number" min="1" max={MAX_CANVAS_EDGE} step="1" value={width || ""} onChange={(event) => setWidth(Number(event.target.value))} /></label>
        <label>{t.height} (px)<input type="number" min="1" max={MAX_CANVAS_EDGE} step="1" value={height || ""} onChange={(event) => setHeight(Number(event.target.value))} /></label></div></fieldset>
      {!valid && <p role="alert">{t.invalid}</p>}{failed && <p role="alert">{t.failed}</p>}
      {busy && <p role="status">{t.working} {Math.round(progress * 100)}%</p>}
    </div>
  </div>;
}

function drawPixels(canvas: HTMLCanvasElement, pixels: Pixels): void {
  canvas.width = pixels.width; canvas.height = pixels.height;
  const context = canvas.getContext("2d"); if (!context) throw new Error("Canvas unavailable");
  const image = context.createImageData(pixels.width, pixels.height); image.data.set(pixels.data); context.putImageData(image, 0, 0);
}
