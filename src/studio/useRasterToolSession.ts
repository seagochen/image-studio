import { useCallback, useEffect, useRef, useState, type Dispatch, type MutableRefObject, type RefObject, type SetStateAction } from "react";
import type Konva from "konva";
import type { Locale, MessageKey } from "../i18n";
import { clampPoint, imageToStage, screenToStage, stageToImage, type Viewport } from "../shared/canvas";
import { layerAncestors } from "../domain/layerHierarchy";
import { addLayer, addSelectionMaskedLocalLayer, addStroke, createAnnotationLayer, replaceLastStroke, replaceRasterPixels } from "../domain/commands";
import {
  createId, rasterSourceUrl, type AnnotationElement, type AnnotationRectElement, type AnnotationTextElement,
  type ImageStudioDocument, type ImageStudioLayer, type RasterLayer, type Stroke,
} from "../domain/document";
import { captureStagePixels, sampleCanvasColor } from "./EyedropperLoupe";
import { renderDrawingLayer, renderAnnotationLayer } from "../domain/layerRasterization";
import { encodeSelectionRuns } from "../domain/selectionMaskRuns";
import {
  BrushStrokeSession, MAX_STROKE_SAMPLES, fallbackSample, pointerSamples, renderBrushDabs,
  type BrushDab, type BrushSettings, type StrokeSample,
} from "../domain/brushEngine";
import {
  createArrowElement, createEllipseElement, createLineElement, createPolygonElement, createRectElement, createStarElement, createTextElement,
} from "../domain/annotation";
import {
  combineSelectionMask, contiguousColorSelectionMask, interpolatedPoints, invertSelectionMask,
  ellipticalSelectionMask, polygonSelectionMask, rectangularSelectionMask, type PixelSelectionMask, type SelectionOperation,
} from "../domain/pixelTools";
import { copySelectedRasterTiles, constrainRgbaToCoverage, editedRasterMimeType, eraseSelectedRasterTiles, liftSelectedRasterTiles, resolveRasterEditCoverage } from "../domain/editCoverage";
import { applyPixelTileDiffs, PixelTileRecorder, type PixelTileDiff } from "../domain/pixelTileHistory";
import { DIRECT_PIXEL_TOOLS, PIXEL_CANVAS_TOOLS, TOOL_LABELS, type PixelSelection, type MarqueeDraft, type ShapeTool, type Tool } from "./tools";
import type { InspectorTab } from "./Inspector";

type PointerKonvaEvent = Konva.KonvaEventObject<PointerEvent | MouseEvent | TouchEvent>;

export interface UseRasterToolSessionOptions {
  tool: Tool;
  document: ImageStudioDocument;
  selected: ImageStudioLayer | null;
  selectedEditable: boolean;
  selectedRasterTooLarge: boolean;
  viewport: Viewport;
  setViewport: Dispatch<SetStateAction<Viewport>>;
  stageRef: RefObject<Konva.Stage>;
  commit: (recipe: (current: ImageStudioDocument) => ImageStudioDocument, label: string, mergeKey?: string) => void;
  commitPixel: (recipe: (current: ImageStudioDocument) => ImageStudioDocument, label: string, layerId: string, diffs: readonly PixelTileDiff[], addedLayer?: RasterLayer) => void;
  canRecordPixel: (diffs: readonly PixelTileDiff[]) => boolean;
  canRecordPixelLift: (diffs: readonly PixelTileDiff[], addedLayer: RasterLayer) => boolean;
  canRecordPixelBytes: (bytes: number) => boolean;
  brushSettings: BrushSettings;
  brushSize: number;
  paintColor: string;
  changePaintColor: (color: string) => void;
  maskValue: number;
  magicTolerance: number;
  selectionOperation: SelectionOperation;
  smudgeStrength: number;
  pixelOpacity: number;
  gradientTransparent: boolean;
  gradientEndColor: string;
  shapeTool: ShapeTool;
  textTemplate: AnnotationTextElement;
  shapeTemplate: AnnotationRectElement;
  locale: Locale;
  setError: (error: MessageKey | null) => void;
  setTool: Dispatch<SetStateAction<Tool>>;
  setInspectorTab: (tab: InspectorTab) => void;
  setSelectedElementId: Dispatch<SetStateAction<string | null>>;
  setTextFocusRequest: Dispatch<SetStateAction<number>>;
}

export interface UseRasterToolSessionResult {
  cursorPreview: { x: number; y: number } | null;
  setCursorPreview: Dispatch<SetStateAction<{ x: number; y: number } | null>>;
  pixelSelection: PixelSelection | null;
  setPixelSelection: Dispatch<SetStateAction<PixelSelection | null>>;
  marqueeDraft: MarqueeDraft | null;
  lassoDraft: { x: number; y: number }[] | null;
  draftAnnotation: AnnotationElement | null;
  pixelPreviewVersion: number;
  directPixelCanvasRef: MutableRefObject<HTMLCanvasElement | null>;
  directPixelLayerIdRef: MutableRefObject<string | null>;
  activePointerIdRef: MutableRefObject<number | null>;
  restorePixelHistory: (document: ImageStudioDocument, layerId: string, diffs: readonly PixelTileDiff[], direction: "before" | "after") => Promise<ImageStudioDocument>;
  beginPointer: (event?: PointerKonvaEvent) => void;
  movePointer: (event?: PointerKonvaEvent) => void;
  endPointer: (event?: PointerKonvaEvent) => void;
  clearPixelSelection: () => void;
  copyPixelSelection: () => RasterLayer | null;
  liftPixelSelection: () => void;
  invertPixelSelection: () => void;
}

/**
 * Raw pointer-down/move/up state machine driving pixel tools (brush/eraser/
 * airbrush/smudge/clone/gradient), pixel selection (marquee/magic wand), and
 * shape/text drag-drafting on the main canvas — extracted from Studio.tsx
 * (Issue #163). Layer/document editing itself still flows through the
 * injected `commit`; this hook only owns the pointer session's own state.
 */
export function useRasterToolSession(options: UseRasterToolSessionOptions): UseRasterToolSessionResult {
  const {
    tool, document, selected, selectedEditable, selectedRasterTooLarge, viewport, setViewport, stageRef, commit, commitPixel, canRecordPixel, canRecordPixelLift, canRecordPixelBytes,
    brushSettings, brushSize, paintColor, changePaintColor, maskValue, magicTolerance, selectionOperation, smudgeStrength, pixelOpacity,
    gradientTransparent, gradientEndColor, shapeTool, textTemplate, shapeTemplate, locale, setError,
    setTool, setInspectorTab, setSelectedElementId, setTextFocusRequest,
  } = options;

  const [cursorPreview, setCursorPreview] = useState<{ x: number; y: number } | null>(null);
  const [pixelSelection, setPixelSelection] = useState<PixelSelection | null>(null);
  const [marqueeDraft, setMarqueeDraft] = useState<MarqueeDraft | null>(null);
  const [lassoDraft, setLassoDraft] = useState<{ x: number; y: number }[] | null>(null);
  const [draftAnnotation, setDraftAnnotation] = useState<AnnotationElement | null>(null);
  const [pixelPreviewVersion, refreshPixelPreview] = useState(0);

  const activeStrokeRef = useRef<Stroke | null>(null);
  const activeStrokeLayerIdRef = useRef<string | null>(null);
  const annotationStartRef = useRef<{ x: number; y: number } | null>(null);
  const marqueeStartRef = useRef<{ x: number; y: number } | null>(null);
  const marqueeEndRef = useRef<{ x: number; y: number } | null>(null);
  const lassoPointsRef = useRef<{ x: number; y: number }[]>([]);
  const draftAnnotationRef = useRef<AnnotationElement | null>(null);
  const directPixelCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const directPixelLayerIdRef = useRef<string | null>(null);
  const pixelDrawingRef = useRef(false);
  const pixelChangedRef = useRef(false);
  const pixelLastPointRef = useRef<{ x: number; y: number } | null>(null);
  const pixelStartPointRef = useRef<{ x: number; y: number } | null>(null);
  const cloneSourceRef = useRef<{ x: number; y: number } | null>(null);
  const cloneSnapshotRef = useRef<HTMLCanvasElement | null>(null);
  const smudgeBufferRef = useRef<HTMLCanvasElement | null>(null);
  const pixelBrushRef = useRef<BrushStrokeSession | null>(null);
  const pixelTileRecorderRef = useRef<PixelTileRecorder | null>(null);
  const pixelPreviewFrameRef = useRef<number | null>(null);
  const activePointerIdRef = useRef<number | null>(null);
  const airbrushTimerRef = useRef<number | null>(null);
  const panRef = useRef<{ x: number; y: number } | null>(null);

  const schedulePixelPreview = useCallback(() => {
    if (pixelPreviewFrameRef.current !== null) return;
    pixelPreviewFrameRef.current = window.requestAnimationFrame(() => {
      pixelPreviewFrameRef.current = null;
      refreshPixelPreview((value) => value + 1);
    });
  }, []);

  useEffect(() => () => {
    if (airbrushTimerRef.current !== null) window.clearInterval(airbrushTimerRef.current);
    if (pixelPreviewFrameRef.current !== null) window.cancelAnimationFrame(pixelPreviewFrameRef.current);
  }, []);

  useEffect(() => {
    cloneSourceRef.current = null;
    cloneSnapshotRef.current = null;
    smudgeBufferRef.current = null;
    if ((!PIXEL_CANVAS_TOOLS.includes(tool) && pixelSelection?.layerId !== selected?.id)
      || !selected || selected.type !== "raster" || !selectedEditable || selectedRasterTooLarge) {
      directPixelCanvasRef.current = null;
      directPixelLayerIdRef.current = null;
      refreshPixelPreview((value) => value + 1);
      return;
    }
    const controller = new AbortController();
    const layerId = selected.id;
    void fetch(rasterSourceUrl(selected.source), { signal: controller.signal }).then((response) => {
      if (!response.ok) throw new Error("pixel source fetch failed");
      return response.blob();
    }).then(createImageBitmap).then((image) => {
      if (controller.signal.aborted) { image.close(); return; }
      const canvas = window.document.createElement("canvas");
      canvas.width = selected.width; canvas.height = selected.height;
      canvas.getContext("2d", { willReadFrequently: true })?.drawImage(image, 0, 0, selected.width, selected.height);
      image.close();
      directPixelCanvasRef.current = canvas;
      directPixelLayerIdRef.current = layerId;
      refreshPixelPreview((value) => value + 1);
    }).catch((error: unknown) => {
      if (!(error instanceof DOMException && error.name === "AbortError")) setError("editFailed");
    });
    return () => controller.abort();
  }, [tool, pixelSelection?.layerId, selected?.id, selected?.type === "raster" ? rasterSourceUrl(selected.source) : "", selectedEditable, selectedRasterTooLarge]);

  useEffect(() => {
    if (pixelSelection && pixelSelection.layerId !== selected?.id) setPixelSelection(null);
  }, [pixelSelection, selected?.id]);

  const clearPixelSelection = useCallback(() => {
    if (!selected || !selectedEditable || selectedRasterTooLarge) return;
    if (!pixelSelection || pixelSelection.layerId !== selected.id || selected.type !== "raster") return;
    const canvas = directPixelCanvasRef.current;
    if (!canvas) return;
    let diffs: PixelTileDiff[] | null = null;
    try {
      resolveRasterEditCoverage(document, selected, pixelSelection);
      diffs = eraseSelectedRasterTiles(canvas, pixelSelection, null, canRecordPixelBytes, canRecordPixel);
      if (!diffs.length) { setPixelSelection(null); return; }
      const source = { kind: "data-url" as const, value: canvas.toDataURL("image/png"), mimeType: "image/png" };
      commitPixel((current) => replaceRasterPixels(current, selected.id, source), "Clear selected pixels", selected.id, diffs);
    } catch { if (diffs) applyPixelTileDiffs(canvas, diffs, "before"); refreshPixelPreview((value) => value + 1); setError("editFailed"); return; }
    setPixelSelection(null);
    refreshPixelPreview((value) => value + 1);
  }, [canRecordPixel, canRecordPixelBytes, commitPixel, document, pixelSelection, refreshPixelPreview, selected, selectedEditable, selectedRasterTooLarge, setError]);

  const copyPixelSelection = useCallback((): RasterLayer | null => {
    if (!selected || !["raster", "paint", "annotation"].includes(selected.type) || !pixelSelection || pixelSelection.layerId !== selected.id
      || !selectedEditable || selected.width * selected.height > 4096 * 4096 || activePointerIdRef.current !== null) {
      setError("editFailed"); return null;
    }
    let image: HTMLCanvasElement | null = null;
    let rendered: HTMLCanvasElement | null = null;
    try {
      const makeCanvas = (width: number, height: number) => {
        const canvas = window.document.createElement("canvas"); canvas.width = width; canvas.height = height; return canvas;
      };
      const canvas = selected.type === "raster"
        ? (directPixelLayerIdRef.current === selected.id ? directPixelCanvasRef.current : null)
        : selected.type === "paint" ? (rendered = renderDrawingLayer(selected, makeCanvas))
          : selected.type === "annotation" ? (rendered = renderAnnotationLayer(selected, makeCanvas)) : null;
      if (!canvas) throw new Error("Selection pixels are not ready");
      const raster = { ...selected, type: "raster" as const, source: { kind: "data-url" as const, value: "", mimeType: "image/png" } };
      const coverage = resolveRasterEditCoverage(document, raster, pixelSelection);
      const copied = copySelectedRasterTiles(canvas, pixelSelection, coverage, canRecordPixelBytes);
      image = copied.image;
      const position = imageToStage({ x: copied.x, y: copied.y }, selected.transform);
      return { ...raster, id: createId("raster"), name: selected.name + " selection", locked: false,
        rasterMaskId: undefined, rasterMaskInverted: undefined, rasterMaskFeatherPx: undefined,
        width: image.width, height: image.height, transform: { ...selected.transform, x: position.x, y: position.y },
        source: { kind: "data-url", value: image.toDataURL("image/png"), mimeType: "image/png" },
      };
    } catch { setError("editFailed"); return null; }
    finally {
      if (image) { image.width = 1; image.height = 1; }
      if (rendered) { rendered.width = 1; rendered.height = 1; }
    }
  }, [document, pixelSelection, selected, selectedEditable, selectedRasterTooLarge, canRecordPixelBytes, canRecordPixel, setError]);

  const liftPixelSelection = useCallback(() => {
    if (!selected || selected.type !== "raster" || !selectedEditable || selectedRasterTooLarge
      || !pixelSelection || pixelSelection.layerId !== selected.id || directPixelLayerIdRef.current !== selected.id) return;
    const canvas = directPixelCanvasRef.current;
    if (!canvas) return;
    let diffs: PixelTileDiff[] = [];
    let image: HTMLCanvasElement | null = null;
    try {
      const coverage = resolveRasterEditCoverage(document, selected, pixelSelection);
      const lifted = liftSelectedRasterTiles(canvas, pixelSelection, coverage, canRecordPixelBytes, canRecordPixel);
      image = lifted.image; diffs = lifted.diffs;
      const position = imageToStage({ x: lifted.x, y: lifted.y }, selected.transform);
      const layer: RasterLayer = {
        ...selected, id: createId("raster"), name: selected.name + " selection", locked: false,
        rasterMaskId: undefined, rasterMaskInverted: undefined, rasterMaskFeatherPx: undefined,
        width: image.width, height: image.height,
        transform: { ...selected.transform, x: position.x, y: position.y },
        source: { kind: "data-url", value: image.toDataURL("image/png"), mimeType: "image/png" },
      };
      if (!canRecordPixelLift(diffs, layer)) throw new Error("Selection lift exceeds history budget");
      const source = { kind: "data-url" as const, value: canvas.toDataURL("image/png"), mimeType: "image/png" };
      commitPixel((current) => addLayer(replaceRasterPixels(current, selected.id, source), layer),
        "Lift selected pixels", selected.id, diffs, layer);
      setPixelSelection(null);
      setTool("select");
      refreshPixelPreview((value) => value + 1);
    } catch {
      if (diffs.length) applyPixelTileDiffs(canvas, diffs, "before");
      refreshPixelPreview((value) => value + 1);
      setError("editFailed");
    } finally {
      if (image) { image.width = 1; image.height = 1; }
    }
  }, [canRecordPixel, canRecordPixelBytes, canRecordPixelLift, commitPixel, document, pixelSelection,
    selected, selectedEditable, selectedRasterTooLarge, setError, setTool]);

  const applyPixelSelection = useCallback((candidate: PixelSelectionMask) => {
    if (!selected || !["raster", "paint", "annotation"].includes(selected.type)) return;
    setPixelSelection((current) => {
      const previous = current?.layerId === selected.id ? current : null;
      return { layerId: selected.id, ...combineSelectionMask(previous, candidate, selectionOperation) };
    });
  }, [selected, selectionOperation]);

  const invertPixelSelection = useCallback(() => {
    if (!pixelSelection || !selected || pixelSelection.layerId !== selected.id) return;
    setPixelSelection({ ...pixelSelection, ...invertSelectionMask(pixelSelection) });
  }, [pixelSelection, selected]);

  const pointInLayer = useCallback((point: { x: number; y: number }) => {
    if (!selected) return point;
    let local = screenToStage(point, viewport);
    for (const layer of [...layerAncestors(document.layers, selected.id)].reverse()) local = stageToImage(local, layer.transform);
    return clampPoint(stageToImage(local, selected.transform), selected.width, selected.height);
  }, [document.layers, selected, viewport]);

  const pointerInSelectedLayer = useCallback((): { x: number; y: number } | null => {
    const pointer = stageRef.current?.getPointerPosition();
    if (!pointer || !selected) return null;
    return pointInLayer(pointer);
  }, [pointInLayer, selected, stageRef]);

  const pointerInDocument = useCallback((): { x: number; y: number } | null => {
    const pointer = stageRef.current?.getPointerPosition();
    return pointer ? clampPoint(screenToStage(pointer, viewport), document.canvas.width, document.canvas.height) : null;
  }, [document.canvas.height, document.canvas.width, stageRef, viewport]);

  const pointerForAnnotation = useCallback(() =>
    pixelSelection?.layerId === selected?.id ? pointerInSelectedLayer() : pointerInDocument(),
  [pixelSelection?.layerId, pointerInDocument, pointerInSelectedLayer, selected?.id]);

  const brushSamplesInSelectedLayer = useCallback((event: PointerKonvaEvent | undefined, fallback: { x: number; y: number }): StrokeSample[] => {
    if (!selected) return [fallbackSample(fallback, performance.now())];
    return pointerSamples(event?.evt, fallback).map((sample) => {
      const point = pointInLayer({ x: sample.x, y: sample.y });
      return { ...sample, ...point };
    });
  }, [pointInLayer, selected]);

  const annotationForDrag = useCallback((start: { x: number; y: number }, end: { x: number; y: number }): AnnotationElement | null => {
    if (shapeTool === "line") return createLineElement(start, end);
    if (shapeTool === "rect") return createRectElement(start, end);
    if (shapeTool === "ellipse") return createEllipseElement(start, end);
    if (shapeTool === "triangle") return createPolygonElement(start, end, 3);
    if (shapeTool === "pentagon") return createPolygonElement(start, end, 5);
    if (shapeTool === "arrow") return createArrowElement(start, end);
    return createStarElement(start, end);
  }, [shapeTool]);

  const colorAnnotation = useCallback((element: AnnotationElement): AnnotationElement => {
    if (element.kind === "text") return { ...element, fontFamily: textTemplate.fontFamily, fontSize: textTemplate.fontSize, fontWeight: textTemplate.fontWeight, italic: textTemplate.italic, letterSpacing: textTemplate.letterSpacing, lineHeight: textTemplate.lineHeight, align: textTemplate.align, fill: paintColor };
    const styled = { ...element, stroke: paintColor, strokeWidth: shapeTemplate.strokeWidth };
    if (styled.kind === "rect") return { ...styled, fill: shapeTemplate.fill, cornerRadius: shapeTemplate.cornerRadius };
    if (styled.kind === "ellipse" || styled.kind === "polygon") return { ...styled, fill: shapeTemplate.fill };
    return styled;
  }, [paintColor, shapeTemplate, textTemplate]);

  const addAnnotation = useCallback((element: AnnotationElement) => {
    const styled = colorAnnotation(element);
    const name = element.kind === "text" ? TOOL_LABELS[locale].text : TOOL_LABELS[locale].shape;
    const selection = pixelSelection?.layerId === selected?.id ? pixelSelection : null;
    try {
      if (selection && selected) {
        encodeSelectionRuns(selection);
        commit((current) => addSelectionMaskedLocalLayer(current, selected.id, selection,
          { type: "annotation", name, element: styled }), "Add selected annotation");
      } else {
        const layer = { ...createAnnotationLayer(document, name), elements: [styled] };
        commit((current) => addLayer(current, layer), "Add annotation");
      }
    } catch { setError("editFailed"); return; }
    setSelectedElementId(element.id);
    setTool("select");
    setInspectorTab("properties");
    if (element.kind === "text") setTextFocusRequest((value) => value + 1);
  }, [colorAnnotation, commit, document, locale, pixelSelection, selected, setError, setInspectorTab, setSelectedElementId, setTextFocusRequest, setTool]);

  const beginPointer = useCallback((event?: PointerKonvaEvent) => {
    const pointer = stageRef.current?.getPointerPosition();
    if (!pointer) return;
    if (typeof PointerEvent !== "undefined" && event?.evt instanceof PointerEvent) {
      if (activePointerIdRef.current !== null) return;
      activePointerIdRef.current = event.evt.pointerId;
      stageRef.current?.content.setPointerCapture?.(event.evt.pointerId);
    }
    if (tool === "hand") { panRef.current = pointer; return; }
    if (tool === "eyedropper") {
      // Same capture and pixel rounding as the loupe, so the click takes the colour it shows.
      const color = sampleCanvasColor(captureStagePixels(stageRef.current), pointer);
      if (color) changePaintColor(color);
      return;
    }
    if (tool === "marquee" || tool === "ellipseMarquee" || tool === "lasso" || tool === "polygonLasso" || tool === "magicWand") {
      const canvas = directPixelCanvasRef.current;
      const point = pointerInSelectedLayer();
      if (!point || !selected || !["raster", "paint", "annotation"].includes(selected.type) || !selectedEditable
        || (tool === "magicWand" && (selected.type !== "raster" || !canvas || directPixelLayerIdRef.current !== selected.id))) return;
      if (tool === "marquee" || tool === "ellipseMarquee") {
        marqueeStartRef.current = point;
        marqueeEndRef.current = point;
        setMarqueeDraft({ start: point, end: point });
        return;
      }
      if (tool === "lasso") { lassoPointsRef.current = [point]; setLassoDraft([point]); return; }
      if (tool === "polygonLasso") {
        const points = [...lassoPointsRef.current, point];
        if (event?.evt instanceof MouseEvent && event.evt.detail >= 2 && points.length >= 3) {
          applyPixelSelection(polygonSelectionMask(selected.width, selected.height, points));
          lassoPointsRef.current = [];
          setLassoDraft(null);
        } else { lassoPointsRef.current = points; setLassoDraft(points); }
        return;
      }
      if (!canvas) return;
      try {
        const pixels = canvas.getContext("2d", { willReadFrequently: true })?.getImageData(0, 0, canvas.width, canvas.height).data;
        if (pixels) applyPixelSelection(contiguousColorSelectionMask(pixels, canvas.width, canvas.height, point, magicTolerance));
      } catch { setError("editFailed"); }
      return;
    }
    if (DIRECT_PIXEL_TOOLS.includes(tool) && selected?.type === "raster") {
      const canvas = directPixelCanvasRef.current;
      const point = pointerInSelectedLayer();
      if (!canvas || !point || !selected || selected.type !== "raster" || !selectedEditable || directPixelLayerIdRef.current !== selected.id) return;
      if (tool === "clone" && (!cloneSourceRef.current || (event?.evt instanceof MouseEvent && event.evt.altKey))) {
        cloneSourceRef.current = point;
        return;
      }
      pixelDrawingRef.current = true;
      pixelChangedRef.current = false;
      pixelTileRecorderRef.current = new PixelTileRecorder(canvas);
      pixelLastPointRef.current = point;
      pixelStartPointRef.current = point;
      if (tool === "clone") cloneSnapshotRef.current = copyCanvas(canvas);
      if (tool === "smudge") smudgeBufferRef.current = captureCanvasPatch(canvas, point, brushSize / 2);
      if (tool === "airbrush" || tool === "brush" || tool === "eraser") {
        const settings = tool === "airbrush" ? { ...brushSettings, flow: Math.min(brushSettings.flow, .32), hardness: Math.min(brushSettings.hardness, .28) } : brushSettings;
        const session = new BrushStrokeSession(brushSize, settings);
        pixelBrushRef.current = session;
        const context = canvas.getContext("2d");
        const dabs = session.push(brushSamplesInSelectedLayer(event, pointer));
        captureDabRegion(pixelTileRecorderRef.current, dabs, brushSize);
        pixelChangedRef.current = dabs.some((dab) => dab.opacity > 0);
        if (context) renderBrushDabs(context, dabs, paintColor, tool === "eraser");
        if (tool === "airbrush") {
          if (airbrushTimerRef.current !== null) window.clearInterval(airbrushTimerRef.current);
          airbrushTimerRef.current = window.setInterval(() => {
            if (!pixelDrawingRef.current || !context) return;
            const dabs = session.dwell(performance.now());
            captureDabRegion(pixelTileRecorderRef.current, dabs, brushSize);
            pixelChangedRef.current ||= dabs.some((dab) => dab.opacity > 0);
            renderBrushDabs(context, dabs, paintColor);
            schedulePixelPreview();
          }, 50);
        }
      }
      schedulePixelPreview();
      return;
    }
    if (tool === "text") {
      const point = pointerForAnnotation(); if (!point) return;
      const element = createTextElement(point);
      if (element.kind === "text") {
        const draft = colorAnnotation({ ...element, text: TOOL_LABELS[locale].text });
        draftAnnotationRef.current = draft;
        setDraftAnnotation(draft);
      }
      return;
    }
    if (tool === "shape") {
      const point = pointerForAnnotation(); if (!point) return;
      annotationStartRef.current = point;
      return;
    }
    if ((tool !== "brush" && tool !== "eraser") || !selected || !selectedEditable || (selected.type !== "paint" && selected.type !== "mask")) return;
    const point = pointerInSelectedLayer();
    if (!point) return;
    if (brushSettings.opacity === 0 || brushSettings.flow === 0) return;
    const samples = brushSamplesInSelectedLayer(event, pointer);
    const stroke: Stroke = {
      id: createId("stroke"), points: samples.map(({ x, y }) => ({ x, y })), samples,
      brush: { ...brushSettings, seed: (Date.now() ^ Math.round(point.x * 65_537) ^ Math.round(point.y * 257)) >>> 0 },
      size: brushSize, mode: tool === "eraser" ? "erase" : "paint", value: maskValue, color: paintColor,
    };
    try {
      const selection = pixelSelection?.layerId === selected.id ? pixelSelection : null;
      if (selection && selected.type === "paint") {
        encodeSelectionRuns(selection);
        const layerId = createId("paint");
        commit((current) => addSelectionMaskedLocalLayer(current, selected.id, selection,
          { type: "paint", name: selected.name, stroke, layerId }), "Draw selected stroke", `stroke:${stroke.id}`);
        activeStrokeLayerIdRef.current = layerId;
      } else {
        commit((current) => addStroke(current, selected.id, stroke), "Draw stroke", `stroke:${stroke.id}`);
        activeStrokeLayerIdRef.current = selected.id;
      }
      activeStrokeRef.current = stroke;
    } catch { setError("editFailed"); }
  }, [
    applyPixelSelection, brushSamplesInSelectedLayer, brushSettings, brushSize, changePaintColor, colorAnnotation, commit, locale, magicTolerance, maskValue,
    paintColor, pixelSelection, pointerForAnnotation, pointerInSelectedLayer, schedulePixelPreview, selected, selectedEditable, setError, stageRef, tool,
  ]);

  const movePointer = useCallback((event?: PointerKonvaEvent) => {
    if (typeof PointerEvent !== "undefined" && event?.evt instanceof PointerEvent && activePointerIdRef.current !== null
      && event.evt.pointerId !== activePointerIdRef.current) return;
    const pointer = stageRef.current?.getPointerPosition();
    if (!pointer) return;
    setCursorPreview(pointer);
    if (panRef.current) {
      const previous = panRef.current;
      setViewport((current) => ({ ...current, offsetX: current.offsetX + pointer.x - previous.x, offsetY: current.offsetY + pointer.y - previous.y }));
      panRef.current = pointer;
      return;
    }
    if (annotationStartRef.current && tool === "shape") {
      const point = pointerForAnnotation(); if (!point) return;
      const shape = annotationForDrag(annotationStartRef.current, point);
      const draft = shape ? colorAnnotation(shape) : null;
      draftAnnotationRef.current = draft;
      setDraftAnnotation(draft);
      return;
    }
    if (marqueeStartRef.current && (tool === "marquee" || tool === "ellipseMarquee")) {
      const point = pointerInSelectedLayer();
      if (!point) return;
      marqueeEndRef.current = point;
      setMarqueeDraft({ start: marqueeStartRef.current, end: point });
      return;
    }
    if (tool === "lasso" && lassoPointsRef.current.length) {
      const point = pointerInSelectedLayer(); if (!point) return;
      const previous = lassoPointsRef.current.at(-1);
      if (!previous || Math.hypot(previous.x - point.x, previous.y - point.y) >= 1) { lassoPointsRef.current.push(point); setLassoDraft([...lassoPointsRef.current]); }
      return;
    }
    if (pixelDrawingRef.current && DIRECT_PIXEL_TOOLS.includes(tool)) {
      const canvas = directPixelCanvasRef.current;
      const point = pointerInSelectedLayer();
      if (!canvas || !point) return;
      const previous = pixelLastPointRef.current ?? point;
      if (pixelBrushRef.current) {
        const context = canvas.getContext("2d");
        const dabs = pixelBrushRef.current.push(brushSamplesInSelectedLayer(event, pointer));
        captureDabRegion(pixelTileRecorderRef.current, dabs, brushSize);
        pixelChangedRef.current ||= dabs.some((dab) => dab.opacity > 0);
        if (context) renderBrushDabs(context, dabs, paintColor, tool === "eraser");
      } else if (tool !== "gradient") {
        captureSegment(pixelTileRecorderRef.current, previous, point, brushSize / 2 + 2);
        for (const sample of interpolatedPoints(previous, point, Math.max(2, brushSize / 5))) {
          applyDirectPixelDab(canvas, tool, fallbackSample(sample), previous, pixelStartPointRef.current, brushSize, cloneSourceRef.current, cloneSnapshotRef.current, smudgeBufferRef, tool === "smudge" ? smudgeStrength : pixelOpacity);
          pixelChangedRef.current ||= (tool === "smudge" ? smudgeStrength : pixelOpacity) > 0;
        }
      }
      pixelLastPointRef.current = point;
      schedulePixelPreview();
      return;
    }
    const stroke = activeStrokeRef.current;
    if (!stroke || !selected) return;
    const point = pointerInSelectedLayer();
    if (!point) return;
    const samples = brushSamplesInSelectedLayer(event, pointer);
    const nextStroke = {
      ...stroke,
      points: [...stroke.points, ...samples.map(({ x, y }) => ({ x, y }))].slice(0, MAX_STROKE_SAMPLES),
      samples: [...(stroke.samples ?? []), ...samples].slice(0, MAX_STROKE_SAMPLES),
    };
    activeStrokeRef.current = nextStroke;
    const layerId = activeStrokeLayerIdRef.current;
    if (layerId) commit((current) => replaceLastStroke(current, layerId, nextStroke), "Draw stroke", `stroke:${stroke.id}`);
  }, [
    annotationForDrag, brushSamplesInSelectedLayer, brushSize, colorAnnotation, commit, gradientEndColor, gradientTransparent,
    paintColor, pixelOpacity, pointerForAnnotation, pointerInSelectedLayer, schedulePixelPreview, selected, setViewport, smudgeStrength, stageRef, tool,
  ]);

  const endPointer = useCallback((event?: PointerKonvaEvent) => {
    if (typeof PointerEvent !== "undefined" && event?.evt instanceof PointerEvent && activePointerIdRef.current !== null
      && event.evt.pointerId !== activePointerIdRef.current) return;
    if (draftAnnotationRef.current && event?.evt.type !== "pointercancel") addAnnotation(draftAnnotationRef.current);
    if (marqueeStartRef.current && marqueeEndRef.current && selected && ["raster", "paint", "annotation"].includes(selected.type)) {
      const mask = tool === "ellipseMarquee"
        ? ellipticalSelectionMask(selected.width, selected.height, marqueeStartRef.current, marqueeEndRef.current)
        : rectangularSelectionMask(selected.width, selected.height, marqueeStartRef.current, marqueeEndRef.current);
      applyPixelSelection(mask);
    }
    if (tool === "lasso" && selected && ["raster", "paint", "annotation"].includes(selected.type) && lassoPointsRef.current.length >= 3 && event?.evt.type !== "pointercancel") {
      applyPixelSelection(polygonSelectionMask(selected.width, selected.height, lassoPointsRef.current));
    }
    const pixelCanvas = directPixelCanvasRef.current;
    const pixelLayerId = directPixelLayerIdRef.current;
    if (pixelDrawingRef.current && pixelCanvas && pixelLayerId) {
      const cancelled = event?.evt.type === "pointercancel";
      if (tool === "gradient" && !cancelled && pixelStartPointRef.current && pixelLastPointRef.current) {
        pixelTileRecorderRef.current?.capture(0, 0, pixelCanvas.width, pixelCanvas.height);
        pixelChangedRef.current = pixelOpacity > 0 && Math.hypot(pixelStartPointRef.current.x - pixelLastPointRef.current.x, pixelStartPointRef.current.y - pixelLastPointRef.current.y) >= 2;
        applyGradient(pixelCanvas, pixelStartPointRef.current, pixelLastPointRef.current, paintColor, gradientTransparent ? "transparent" : gradientEndColor, pixelOpacity);
      }
      const layer = document.layers.find((candidate) => candidate.id === pixelLayerId);
      let diffs = pixelTileRecorderRef.current?.finish() ?? [];
      const selection = pixelSelection?.layerId === pixelLayerId ? pixelSelection : null;
      if (layer?.type === "raster" && diffs.length && (selection || layer.rasterMaskId)) {
        try {
          const context = pixelCanvas.getContext("2d", { willReadFrequently: true });
          if (!context) throw new Error("Pixel history canvas is unavailable");
          const coverage = resolveRasterEditCoverage(document, layer, selection);
          if (coverage) diffs = diffs.flatMap((diff) => {
            const after = constrainRgbaToCoverage(diff.before, diff.after, coverage, layer.width, layer.height, diff.x, diff.y, diff.width, diff.height);
            const image = context.createImageData(diff.width, diff.height);
            image.data.set(after);
            context.putImageData(image, diff.x, diff.y);
            return after.some((value, index) => value !== diff.before[index]) ? [{ ...diff, after }] : [];
          });
        } catch {
          applyPixelTileDiffs(pixelCanvas, diffs, "before");
          diffs = [];
          setError("editFailed");
        }
      }
      if (cancelled) {
        applyPixelTileDiffs(pixelCanvas, diffs, "before");
      } else if (layer?.type === "raster" && pixelChangedRef.current && diffs.length) {
        if (!canRecordPixel(diffs)) {
          applyPixelTileDiffs(pixelCanvas, diffs, "before");
          setError("editFailed");
        } else {
          try {
            const mimeType = editedRasterMimeType(layer.source.mimeType, Boolean(selection || layer.rasterMaskId), tool === "eraser");
            const value = pixelCanvas.toDataURL(mimeType);
            commitPixel((current) => replaceRasterPixels(current, pixelLayerId, { kind: "data-url", value, mimeType }), "Apply direct pixel edit", pixelLayerId, diffs);
          } catch {
            applyPixelTileDiffs(pixelCanvas, diffs, "before");
            setError("editFailed");
          }
        }
      }
    }
    pixelBrushRef.current = null;
    activePointerIdRef.current = null;
    activeStrokeRef.current = null; panRef.current = null; annotationStartRef.current = null; marqueeStartRef.current = null; marqueeEndRef.current = null;
    activeStrokeLayerIdRef.current = null;
    if (tool !== "polygonLasso") { lassoPointsRef.current = []; setLassoDraft(null); }
    draftAnnotationRef.current = null; setDraftAnnotation(null);
    setMarqueeDraft(null);
    pixelChangedRef.current = false;
    pixelTileRecorderRef.current = null;
    pixelDrawingRef.current = false; pixelLastPointRef.current = null; pixelStartPointRef.current = null;
    cloneSnapshotRef.current = null; smudgeBufferRef.current = null;
    if (airbrushTimerRef.current !== null) { window.clearInterval(airbrushTimerRef.current); airbrushTimerRef.current = null; }
    if (typeof PointerEvent !== "undefined" && event?.evt instanceof PointerEvent && stageRef.current?.content.hasPointerCapture?.(event.evt.pointerId)) {
      stageRef.current.content.releasePointerCapture(event.evt.pointerId);
    }
  }, [addAnnotation, applyPixelSelection, canRecordPixel, commitPixel, document.layers, gradientEndColor, gradientTransparent, paintColor, pixelOpacity, pixelSelection, selected, setError, stageRef, tool]);

  useEffect(() => {
    const finish = () => endPointer();
    window.addEventListener("blur", finish);
    return () => window.removeEventListener("blur", finish);
  }, [endPointer]);

  const restorePixelHistory = useCallback(async (
    current: ImageStudioDocument, layerId: string, diffs: readonly PixelTileDiff[], direction: "before" | "after",
  ): Promise<ImageStudioDocument> => {
    const layer = current.layers.find((candidate) => candidate.id === layerId);
    if (!layer || layer.type !== "raster" || layer.locked) throw new Error("Pixel history layer is unavailable");
    // A history jump may cross metadata entries that replace the same layer's source.
    const canvas = await rasterCanvas(layer);
    directPixelCanvasRef.current = canvas;
    directPixelLayerIdRef.current = layerId;
    const rollback = new PixelTileRecorder(canvas);
    try {
      for (const diff of diffs) rollback.capture(diff.x, diff.y, diff.width, diff.height);
      applyPixelTileDiffs(canvas, diffs, direction);
      const mimeType = "image/png";
      const next = replaceRasterPixels(current, layerId, { kind: "data-url", value: canvas.toDataURL(mimeType), mimeType });
      refreshPixelPreview((value) => value + 1);
      return next;
    } catch (error) {
      try { applyPixelTileDiffs(canvas, rollback.finish(), "before"); }
      catch { directPixelCanvasRef.current = null; directPixelLayerIdRef.current = null; }
      refreshPixelPreview((value) => value + 1);
      throw error;
    }
  }, []);

  return {
    cursorPreview, setCursorPreview, pixelSelection, setPixelSelection, marqueeDraft, lassoDraft, draftAnnotation, pixelPreviewVersion,
    directPixelCanvasRef, directPixelLayerIdRef, activePointerIdRef,
    beginPointer, movePointer, endPointer, clearPixelSelection, copyPixelSelection, liftPixelSelection, invertPixelSelection, restorePixelHistory,
  };
}

function captureDabRegion(recorder: PixelTileRecorder | null, dabs: readonly BrushDab[], fallbackSize: number): void {
  if (!recorder || !dabs.length) return;
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const dab of dabs) {
    const radiusX = Math.max(dab.radiusX, fallbackSize / 2) + 2;
    const radiusY = Math.max(dab.radiusY, fallbackSize / 2) + 2;
    left = Math.min(left, dab.x - radiusX); top = Math.min(top, dab.y - radiusY);
    right = Math.max(right, dab.x + radiusX); bottom = Math.max(bottom, dab.y + radiusY);
  }
  recorder.capture(left, top, right - left, bottom - top);
}

function captureSegment(recorder: PixelTileRecorder | null, start: { x: number; y: number }, end: { x: number; y: number }, radius: number): void {
  recorder?.capture(Math.min(start.x, end.x) - radius, Math.min(start.y, end.y) - radius, Math.abs(start.x - end.x) + radius * 2, Math.abs(start.y - end.y) + radius * 2);
}

async function rasterCanvas(layer: Extract<ImageStudioLayer, { type: "raster" }>): Promise<HTMLCanvasElement> {
  const response = await fetch(rasterSourceUrl(layer.source));
  if (!response.ok) throw new Error("Pixel history source fetch failed");
  const image = await createImageBitmap(await response.blob());
  try {
    const canvas = window.document.createElement("canvas");
    canvas.width = layer.width; canvas.height = layer.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Pixel history canvas is unavailable");
    context.drawImage(image, 0, 0, layer.width, layer.height);
    return canvas;
  } finally { image.close(); }
}

function copyCanvas(source: HTMLCanvasElement): HTMLCanvasElement {
  const copy = window.document.createElement("canvas");
  copy.width = source.width; copy.height = source.height;
  copy.getContext("2d")?.drawImage(source, 0, 0);
  return copy;
}

function captureCanvasPatch(source: HTMLCanvasElement, point: { x: number; y: number }, radius: number): HTMLCanvasElement {
  const size = Math.max(1, Math.round(radius * 2));
  const patch = window.document.createElement("canvas");
  patch.width = size; patch.height = size;
  patch.getContext("2d")?.drawImage(source, point.x - radius, point.y - radius, size, size, 0, 0, size, size);
  return patch;
}

function applyDirectPixelDab(
  canvas: HTMLCanvasElement,
  tool: Tool,
  target: StrokeSample,
  previous: { x: number; y: number },
  strokeStart: { x: number; y: number } | null,
  size: number,
  cloneSource: { x: number; y: number } | null,
  cloneSnapshot: HTMLCanvasElement | null,
  smudgeBufferRef: { current: HTMLCanvasElement | null },
  opacity: number,
): void {
  const context = canvas.getContext("2d"); if (!context) return;
  if (opacity <= 0) return;
  const radius = size / 2;
  if (tool === "clone" && cloneSource && cloneSnapshot && strokeStart) {
    const sourceX = cloneSource.x + target.x - strokeStart.x;
    const sourceY = cloneSource.y + target.y - strokeStart.y;
    context.save(); context.globalAlpha = opacity; context.beginPath(); context.arc(target.x, target.y, radius, 0, Math.PI * 2); context.clip();
    context.drawImage(cloneSnapshot, sourceX - radius, sourceY - radius, size, size, target.x - radius, target.y - radius, size, size);
    context.restore();
  } else if (tool === "smudge" && smudgeBufferRef.current) {
    context.save(); context.globalAlpha = opacity; context.beginPath(); context.arc(target.x, target.y, radius, 0, Math.PI * 2); context.clip();
    context.drawImage(smudgeBufferRef.current, target.x - radius, target.y - radius, size, size); context.restore();
    smudgeBufferRef.current = captureCanvasPatch(canvas, { x: (target.x + previous.x) / 2, y: (target.y + previous.y) / 2 }, radius);
  }
}

function applyGradient(canvas: HTMLCanvasElement, start: { x: number; y: number }, end: { x: number; y: number }, color: string, endColor: string, opacity: number): void {
  const context = canvas.getContext("2d"); if (!context || opacity <= 0 || Math.hypot(end.x - start.x, end.y - start.y) < 2) return;
  const gradient = context.createLinearGradient(start.x, start.y, end.x, end.y);
  gradient.addColorStop(0, color);
  gradient.addColorStop(1, endColor === "transparent" ? `${color}00` : endColor);
  context.save(); context.globalAlpha = opacity; context.fillStyle = gradient; context.fillRect(0, 0, canvas.width, canvas.height); context.restore();
}
