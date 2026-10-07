import { useCallback, useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import { screenToStage, type Viewport } from "../shared/canvas";

export const MIN_ZOOM = 0.05;
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
    const padding = surfaceSize.width < 500 ? 20 : 64;
    const scale = Math.min(
      (surfaceSize.width - padding * 2) / target.width,
      (surfaceSize.height - padding * 2) / target.height,
      1,
    );
    const safeScale = Math.max(MIN_ZOOM, scale);
    setViewport((current) => ({
      ...current, scale: safeScale,
      offsetX: (surfaceSize.width - target.width * safeScale) / 2,
      offsetY: (surfaceSize.height - target.height * safeScale) / 2,
    }));
  }, [canvasSize, surfaceSize]);

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
