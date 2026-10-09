import { useEffect, useRef, useState } from "react";
import type Konva from "konva";
import {
  LOUPE_DIAMETER, LOUPE_SAMPLE_RADIUS, loupePlacement, sampledPixelColor, type LoupeBox, type LoupePoint,
} from "../domain/eyedropper";

/** Stage layers that draw editor chrome; they must never be sampled as artwork. */
export const UI_OVERLAY_LAYER_NAME = "ui-overlay";

/** Renders the stage without editor overlays, in stage (CSS pixel) coordinates. */
export function captureStagePixels(stage: Konva.Stage | null): HTMLCanvasElement | null {
  if (!stage) return null;
  const overlays = stage.find(`.${UI_OVERLAY_LAYER_NAME}`).filter((node) => node.visible());
  overlays.forEach((node) => node.hide());
  try { return stage.toCanvas({ pixelRatio: 1 }); }
  catch { return null; /* Cross-origin pixels make the stage unreadable. */ }
  finally { overlays.forEach((node) => node.show()); }
}

export function sampleCanvasColor(source: HTMLCanvasElement | null, point: LoupePoint): string | null {
  if (!source) return null;
  const x = Math.floor(point.x);
  const y = Math.floor(point.y);
  if (x < 0 || y < 0 || x >= source.width || y >= source.height) return null;
  try { return sampledPixelColor(source.getContext("2d")?.getImageData(x, y, 1, 1).data ?? []); }
  catch { return null; }
}

interface Props {
  source: HTMLCanvasElement | null;
  pointer: LoupePoint;
  surface: LoupeBox;
}

export function EyedropperLoupe({ source, pointer, surface }: Props): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [color, setColor] = useState<string | null>(null);
  const x = Math.floor(pointer.x);
  const y = Math.floor(pointer.y);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const cells = LOUPE_SAMPLE_RADIUS * 2 + 1;
    const cell = LOUPE_DIAMETER / cells;
    canvas.width = LOUPE_DIAMETER;
    canvas.height = LOUPE_DIAMETER;
    context.clearRect(0, 0, LOUPE_DIAMETER, LOUPE_DIAMETER);
    context.imageSmoothingEnabled = false;
    if (source) context.drawImage(source, x - LOUPE_SAMPLE_RADIUS, y - LOUPE_SAMPLE_RADIUS, cells, cells, 0, 0, LOUPE_DIAMETER, LOUPE_DIAMETER);
    context.strokeStyle = "rgba(17,24,39,.14)";
    context.lineWidth = 1;
    context.beginPath();
    for (let index = 1; index < cells; index += 1) {
      const offset = Math.round(index * cell) + .5;
      context.moveTo(offset, 0); context.lineTo(offset, LOUPE_DIAMETER);
      context.moveTo(0, offset); context.lineTo(LOUPE_DIAMETER, offset);
    }
    context.stroke();
    const center = LOUPE_SAMPLE_RADIUS * cell;
    context.lineWidth = 2;
    context.strokeStyle = "#fff";
    context.strokeRect(center - 1, center - 1, cell + 2, cell + 2);
    context.lineWidth = 1;
    context.strokeStyle = "#111827";
    context.strokeRect(center - 2.5, center - 2.5, cell + 5, cell + 5);
    setColor(sampleCanvasColor(source, { x, y }));
  }, [source, x, y]);

  const { left, top } = loupePlacement(pointer, surface);
  return <div className="eyedropper-loupe" style={{ left, top }} aria-hidden="true">
    <canvas ref={canvasRef} width={LOUPE_DIAMETER} height={LOUPE_DIAMETER} />
    <span className="eyedropper-readout"><i style={{ background: color ?? "transparent" }} />{color?.toUpperCase() ?? "—"}</span>
  </div>;
}
