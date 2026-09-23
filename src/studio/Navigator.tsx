import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { ImageStudioDocument } from "../domain/document";
import { renderImageStudioDocument } from "../domain/exportImage";
import { screenToStage, type Viewport } from "../../../shared/canvas";
import type { MessageKey } from "../i18n";
import { clampNavigatorPosition, type NavigatorPosition } from "./navigatorPosition";
import { ProductIcon } from "./ProductIcon";

const NAVIGATOR_MAX_WIDTH = 200;
const NAVIGATOR_MAX_HEIGHT = 150;
const NAVIGATOR_DEBOUNCE_MS = 250;

interface Props {
  document: ImageStudioDocument;
  viewport: Viewport;
  surfaceSize: { width: number; height: number };
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  onPan: (offsetX: number, offsetY: number) => void;
  t: (key: MessageKey) => string;
}

/** Debounced, independent from the editing composite preview: staleness during an active stroke is acceptable here. */
export function Navigator({ document, viewport, surfaceSize, collapsed, onCollapsedChange, onPan, t }: Props): JSX.Element {
  const [preview, setPreview] = useState<HTMLCanvasElement | null>(null);
  const [position, setPosition] = useState<NavigatorPosition | null>(null);
  const [draggingPanel, setDraggingPanel] = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const panelDragRef = useRef<{ pointerId: number; grabX: number; grabY: number } | null>(null);

  const availableWidth = Math.max(80, Math.min(NAVIGATOR_MAX_WIDTH, surfaceSize.width * 0.45));
  const availableHeight = Math.max(60, Math.min(NAVIGATOR_MAX_HEIGHT, surfaceSize.height * 0.4));
  const navScale = Math.min(availableWidth / document.canvas.width, availableHeight / document.canvas.height, 1);
  const navWidth = Math.max(1, Math.round(document.canvas.width * navScale));
  const navHeight = Math.max(1, Math.round(document.canvas.height * navScale));

  useEffect(() => {
    if (!document.layers.length) { setPreview(null); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void renderImageStudioDocument(document, { signal: controller.signal, scale: navScale })
        .then((canvas) => { if (!controller.signal.aborted) setPreview(canvas); })
        .catch(() => undefined);
    }, NAVIGATOR_DEBOUNCE_MS);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [document.layers, document.canvas.width, document.canvas.height, navScale]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (preview) context.drawImage(preview, 0, 0, canvas.width, canvas.height);
  }, [preview, navWidth, navHeight, collapsed]);

  useEffect(() => () => { if (preview) { preview.width = 1; preview.height = 1; } }, [preview]);

  useEffect(() => {
    if (!position) return;
    const frame = window.requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (!panel) return;
      setPosition((current) => current && clampNavigatorPosition(current, surfaceSize,
        { width: panel.offsetWidth, height: panel.offsetHeight }));
    });
    return () => window.cancelAnimationFrame(frame);
  }, [collapsed, surfaceSize.height, surfaceSize.width]);

  const startPanelDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    const panel = panelRef.current;
    const surface = panel?.parentElement;
    if (!panel || !surface) return;
    const panelRect = panel.getBoundingClientRect();
    const surfaceRect = surface.getBoundingClientRect();
    const initial = { x: panelRect.left - surfaceRect.left, y: panelRect.top - surfaceRect.top };
    setPosition(clampNavigatorPosition(initial, surfaceSize, { width: panelRect.width, height: panelRect.height }));
    panelDragRef.current = { pointerId: event.pointerId, grabX: event.clientX - panelRect.left, grabY: event.clientY - panelRect.top };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDraggingPanel(true);
    event.preventDefault();
  };

  const movePanel = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = panelDragRef.current;
    const panel = panelRef.current;
    const surface = panel?.parentElement;
    if (!drag || drag.pointerId !== event.pointerId || !panel || !surface) return;
    const surfaceRect = surface.getBoundingClientRect();
    setPosition(clampNavigatorPosition({
      x: event.clientX - surfaceRect.left - drag.grabX,
      y: event.clientY - surfaceRect.top - drag.grabY,
    }, surfaceSize, { width: panel.offsetWidth, height: panel.offsetHeight }));
  };

  const endPanelDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (panelDragRef.current?.pointerId !== event.pointerId) return;
    panelDragRef.current = null;
    setDraggingPanel(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const panTo = (clientX: number, clientY: number) => {
    const rect = bodyRef.current?.getBoundingClientRect();
    if (!rect) return;
    const docX = (clientX - rect.left) / navScale;
    const docY = (clientY - rect.top) / navScale;
    onPan(surfaceSize.width / 2 - docX * viewport.scale, surfaceSize.height / 2 - docY * viewport.scale);
  };

  const topLeft = screenToStage({ x: 0, y: 0 }, viewport);
  const bottomRight = screenToStage({ x: surfaceSize.width, y: surfaceSize.height }, viewport);
  const boxStyle = {
    left: topLeft.x * navScale, top: topLeft.y * navScale,
    width: Math.max(0, (bottomRight.x - topLeft.x) * navScale),
    height: Math.max(0, (bottomRight.y - topLeft.y) * navScale),
  };

  const panelStyle = position ? { left: position.x, top: position.y, right: "auto", bottom: "auto" } : undefined;
  return <section ref={panelRef} className={`navigator-panel ${collapsed ? "collapsed" : ""} ${draggingPanel ? "dragging" : ""}`}
    aria-label={t("navigator")} style={panelStyle}>
    <header className="navigator-titlebar" onPointerDown={startPanelDrag} onPointerMove={movePanel}
      onPointerUp={endPanelDrag} onPointerCancel={endPanelDrag}>
      <span>{t("navigator")}</span>
      <button type="button" className="navigator-toggle" aria-label={collapsed ? t("navigatorExpand") : t("navigatorCollapse")}
        onPointerDown={(event) => event.stopPropagation()} onClick={() => onCollapsedChange(!collapsed)}><ProductIcon name={collapsed ? "image" : "minus"} /></button>
    </header>
    {!collapsed && <div className="navigator-content">
      <div ref={bodyRef} className="navigator-body" style={{ width: navWidth, height: navHeight }}
        onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); draggingRef.current = true; panTo(event.clientX, event.clientY); }}
        onPointerMove={(event) => { if (draggingRef.current) panTo(event.clientX, event.clientY); }}
        onPointerUp={(event) => { draggingRef.current = false; event.currentTarget.releasePointerCapture(event.pointerId); }}
        onPointerCancel={() => { draggingRef.current = false; }}>
        <canvas ref={canvasRef} width={navWidth} height={navHeight} className="navigator-canvas" />
        <div className="navigator-viewport-box" style={boxStyle} />
      </div>
      <footer><output>{Math.round(viewport.scale * 100)}%</output></footer>
    </div>}
  </section>;
}
