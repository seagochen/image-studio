import { useCallback, useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import { screenToStage, type Viewport } from "../shared/canvas";

export const MIN_ZOOM = 0.01;
export const MAX_ZOOM = 16;

export interface CanvasSize { width: number; height: number; }

export interface UseCanvasViewportResult {
  viewport: Viewport;
  setViewport: Dispatch<SetStateAction<Viewport>>;
  surfaceSize: CanvasSize;
  fitView: (target?: CanvasSize) => void;
  zoomAt: (factor: number, anchor?: { x: number; y: number }) => void;
  actualSize: () => void;
}

export function recenterViewport(viewport: Viewport, before: CanvasSize, after: CanvasSize): Viewport {
  return {...viewport, offsetX: viewport.offsetX + (after.width-before.width)/2, offsetY: viewport.offsetY + (after.height-before.height)/2};
}

export function fitCanvasViewport(viewport: Viewport, surface: CanvasSize, canvas: CanvasSize): Viewport {
  const padding = Math.min(surface.width < 500 ? 20 : 64, Math.max(0, (Math.min(surface.width, surface.height) - 1) / 4));
  const scale = Math.max(MIN_ZOOM, Math.min((surface.width - padding * 2) / canvas.width, (surface.height - padding * 2) / canvas.height, 1));
  return { ...viewport, scale, offsetX: (surface.width - canvas.width * scale) / 2, offsetY: (surface.height - canvas.height * scale) / 2 };
}

/** Zoom/pan/fit state and the surface-size ResizeObserver, extracted from Studio.tsx (Issue #163). */
export function useCanvasViewport(surfaceRef: RefObject<HTMLDivElement>, canvasSize: CanvasSize): UseCanvasViewportResult {
  const [viewport, setViewport] = useState<Viewport>({ offsetX: 48, offsetY: 48, scale: 1, devicePixelRatio: window.devicePixelRatio || 1 });
  const [surfaceSize, setSurfaceSize] = useState<CanvasSize>({ width: 900, height: 620 });

  const measuredSize = useRef<CanvasSize | null>(null);

  useEffect(() => {
    const container = surfaceRef.current;
    if (!container) return;
    const measure = () => {
      const next = {width: Math.max(1, container.clientWidth), height: Math.max(1, container.clientHeight)};
      const previous = measuredSize.current;
      if (previous && previous.width === next.width && previous.height === next.height) return;
      measuredSize.current = next;
      if (previous) setViewport(current => recenterViewport(current, previous, next));
      setSurfaceSize(next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, [surfaceRef]);

  const fitView = useCallback((target: CanvasSize = canvasSize) => {
    setViewport((current) => fitCanvasViewport(current, surfaceSize, target));
  }, [canvasSize, surfaceSize]);

  const previousCanvasSize = useRef(canvasSize);
  useEffect(() => {
    const previous = previousCanvasSize.current;
    previousCanvasSize.current = canvasSize;
    if (previous.width !== canvasSize.width || previous.height !== canvasSize.height) fitView();
  }, [canvasSize.width, canvasSize.height, fitView]);

  const zoomAt = useCallback((factor: number, anchor?: { x: number; y: number }) => {
    setViewport((current) => {
      const point = anchor ?? { x: surfaceSize.width / 2, y: surfaceSize.height / 2 };
      const nextScale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, current.scale * factor));
      const world = screenToStage(point, current);
      return { ...current, scale: nextScale, offsetX: point.x - world.x * nextScale, offsetY: point.y - world.y * nextScale };
    });
  }, [surfaceSize]);

  const actualSize = useCallback(() => {
    setViewport((current) => ({
      ...current, scale: 1,
      offsetX: (surfaceSize.width - canvasSize.width) / 2,
      offsetY: (surfaceSize.height - canvasSize.height) / 2,
    }));
  }, [canvasSize, surfaceSize]);

  return { viewport, setViewport, surfaceSize, fitView, zoomAt, actualSize };
}
