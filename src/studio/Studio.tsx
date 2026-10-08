import { applyAiResult } from "../domain/applyAiResult";
import { CanvasPathEditor, pathCopy } from "./CanvasPathEditor";
import { LayerFiltersPanel } from "./LayerFiltersPanel";
import { CanvasGuides } from "./CanvasGuides";
import { layoutCopy } from "./layoutCopy";
import { encodeSelectionRuns, decodeSelectionRuns } from "../domain/selectionMaskRuns";
import { CanvasTextEditor } from "./CanvasTextEditor";
import { SelectionRefinementPanel } from "./SelectionRefinementPanel";
import { LayerEffectsPanel } from "./LayerEffectsPanel";
import { CanvasCrop } from "./CanvasCrop";
import { cropCanvas, snapLayer } from "../domain/layoutCommands";
import { editingCopy } from "./editingCopy";
import { disabledReasonCopy, hintTitle, layerEditBlocker, type DisabledReason } from "./disabledReasons";
import { copyLayer, pasteLayer } from "../domain/layerClipboard";
import { AnnotationProperties } from "./AnnotationProperties";
import { PROPERTY_LABELS } from "./propertyLabels";
import { useCompositePreview } from "./useCompositePreview";
import { useCanvasViewport, MAX_ZOOM, MIN_ZOOM } from "./useCanvasViewport";
import { useStudioProject } from "./useStudioProject";
import { useRasterToolSession } from "./useRasterToolSession";
import {
  SECONDARY_TOOLS, SELECTION_TOOLS, DIRECT_PIXEL_TOOLS, PIXEL_CANVAS_TOOLS, SIZED_CURSOR_TOOLS, TOOL_LABELS,
  type Tool, type ShapeTool, type PixelSelection, type MarqueeDraft,
} from "./tools";
import { LayerInteractions } from "./LayerInteractions";
import { layerAncestors, layerIsEditable } from "../domain/layerHierarchy";
import { planLayerMerge } from "../domain/layerMerge";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Circle, Ellipse, Group, Image as KonvaImage, Layer, Line, Rect, Stage, Transformer } from "react-konva";
import type Konva from "konva";
import { useI18n, type Locale, type MessageKey } from "../i18n";
import { applyConventionalEditorOutcome, type ConventionalEditorInput } from "../adapters/conventionalEditor";
import { AiEditDialog } from "../ai/AiEditDialog";
import {
  addLayer, addSelectionMaskedAdjustmentLayer, addStroke, attachPaintAsRasterMask, createAnnotationLayer, createAttachedRasterMask, createDrawingLayer, deleteLayer, duplicateLayer, clearSelectedVectorPixels,
  insertLayerAfter, liftSelectedVectorLayer, moveLayer, patchLayer, replaceAdjacentLayers, replaceLastStroke, replaceRasterLayer, replaceRasterPixels,
  selectLayer, setLayerTransform, replaceAnnotationElement,
} from "../domain/commands";
import { clampPoint, screenToStage, stageToImage } from "../shared/canvas";
import { colorSchemeSwatches, hexToHsv, hsvToHex, COLOR_SCHEME_KINDS, type ColorSchemeKind } from "../domain/color";
import {
  canvasBlendMode, createEmptyDocument, createId, LAYER_BLEND_MODES, rasterSourceUrl,
  touchDocument, type AdjustmentKind, type AdjustmentLayer, type AnnotationElement, type AnnotationTextElement, type AnnotationRectElement, type AnnotationLayer, type ImageStudioDocument, type ImageStudioLayer, type RasterLayer, type Stroke,
} from "../domain/document";
import {
  BRUSH_PRESET_IDS, BrushStrokeSession, MAX_STROKE_SAMPLES, fallbackSample, pointerSamples, renderBrushDabs, settingsForPreset,
  type BrushPresetId, type BrushSettings, type StrokeSample,
} from "../domain/brushEngine";
import {
  createArrowElement, createEllipseElement, createLineElement, createPolygonElement, createRectElement, createStarElement, createTextElement,
} from "../domain/annotation";
import { requestNativeColor, sampledPixelColor, type EyeDropperConstructor } from "../domain/eyedropper";
import { DocumentHistory } from "../domain/history";
import { applyPixelTileDiffs, PixelTileArchive, type PixelTileDiff } from "../domain/pixelTileHistory";
import { rasterLayerFromImage } from "../domain/importImage";
import { bakeSelectedAdjustmentTiles, canBakeSelectedAdjustment, resolveRasterEditCoverage } from "../domain/editCoverage";
import { bindConfiguredShortcuts, loadShortcuts, SHORTCUT_ACTIONS, type ShortcutAction } from "../domain/shortcutSettings";
import { FileMenu, type DeliveryFormat } from "./FileMenu";
import { clearPreviewTileCache, previewStorageStatus } from "./previewTiles";
import { ShortcutSettingsDialog } from "./ShortcutSettingsDialog";
import { ApiKeySettingsDialog } from "./ApiKeySettingsDialog";
import { fileCopy } from "./fileCopy";
import { BRUSH_UI, BRUSH_PRESET_LABELS, LAYER_UI } from "./brushLayerLabels";
import { DrawingNode } from "./DrawingNode";
import { Navigator } from "./Navigator";
import { DeliveryDialog } from "./DeliveryDialog";
import { exportImage } from "../domain/exportImage";
import { createAdjustmentLayer, previewLuminosityHistogram } from "../domain/adjustmentEngine";
import { ADJUSTMENT_KIND_LABELS, AdjustmentPanel } from "./AdjustmentPanel";
import { AdjustmentEditorDialog } from "./AdjustmentEditorDialog";
import { AdjustmentMenu } from "./AdjustmentMenu";
import { RasterNode } from "./RasterNode";
import { AnnotationNode } from "./AnnotationNode";
import { ColorWheel } from "./ColorWheel";
import { PerspectiveDialog } from "./PerspectiveDialog";
import { perspectiveCopy } from "./perspectiveCopy";
import { RasterEditorDialog } from "./RasterEditorDialog";
import {
  rectangularSelectionMask, type PixelSelectionMask, type SelectionOperation,
} from "../domain/pixelTools";
import { ProductIcon, type ProductIconName } from "./ProductIcon";
import { ToolRail } from "./ToolRail";
import { Inspector, type InspectorTab } from "./Inspector";
import { LayerPanel } from "./LayerPanel";
import { APP_BASE_PATH, isStandaloneMode } from "../runtime/runtimeConfig";
import { invokeEditorCommand } from "../domain/editorCommands";
import { studioCommands } from "./studioCommands";
import { CommandPalette } from "./CommandPalette";
import { HistoryPanel } from "./HistoryPanel";
import { ToolOptions } from "./ToolOptions";
import { WorkbenchBar } from "./WorkbenchBar";
import { quickTransformLayer, type QuickTransform } from "../domain/layerQuickTransform";
import { quickTransformCopy, selectionCommandCopy } from "./workbenchCopy";
import { LayerTransformProperties } from "./LayerTransformProperties";

const MAX_DIRECT_PIXEL_COUNT = 4096 * 4096;

const SCHEME_LABEL_KEY: Record<ColorSchemeKind, MessageKey> = {
  complementary: "schemeComplementary",
  splitComplementary: "schemeSplitComplementary",
  monochromatic: "schemeMonochromatic",
  analogous: "schemeAnalogous",
  triadic: "schemeTriadic",
  tetradic: "schemeTetradic",
};

export function Studio(): JSX.Element {
  const { locale, setLocale, t } = useI18n();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const closePalette = useCallback(() => setPaletteOpen(false), []);
  const [cacheStatus, setCacheStatus] = useState(fileCopy[locale].localCacheChecking);
  const refreshCacheStatus = useCallback(() => { void previewStorageStatus().then((value) => setCacheStatus(formatCacheStatus(fileCopy[locale], value))).catch(() => setCacheStatus(fileCopy[locale].localCacheUnavailable)); }, [locale]);
  useEffect(() => { refreshCacheStatus(); }, [refreshCacheStatus]);
  const [clipboard, setClipboard] = useState<ImageStudioDocument | null>(null);
  const [document, setDocument] = useState<ImageStudioDocument>(createEmptyDocument);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const { viewport, setViewport, surfaceSize, fitView, zoomAt, actualSize } = useCanvasViewport(surfaceRef, document.canvas);
  const [tool, setTool] = useState<Tool>("select");
  const [selectionOperation, setSelectionOperation] = useState<SelectionOperation>("replace");
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("properties");
  const [pathEditing,setPathEditing]=useState<{layerId?:string;mask:boolean;initial?:import("../domain/document").AnnotationPathElement}|null>(null);
  useEffect(()=>{setPathEditing(null);},[document.id]);
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [textFocusRequest, setTextFocusRequest] = useState(0);
  const [textEditing, setTextEditing] = useState<{layerId:string;elementId:string} | null>(null);
  const [textTemplate, setTextTemplate] = useState(() => createTextElement({ x: 0, y: 0 }) as AnnotationTextElement);
  const [shapeTemplate, setShapeTemplate] = useState(() => createRectElement({ x: 0, y: 0 }, { x: 100, y: 100 }) as AnnotationRectElement);
  const [smudgeStrength, setSmudgeStrength] = useState(0.35);
  const [pixelOpacity, setPixelOpacity] = useState(1);
  const [gradientEndColor, setGradientEndColor] = useState("#ffffff");
  const [gradientTransparent, setGradientTransparent] = useState(true);
  const [shapeTool, setShapeTool] = useState<ShapeTool>("rect");
  const [brushSize, setBrushSize] = useState(24);
  const [magicTolerance, setMagicTolerance] = useState(32);
  const [paintColor, setPaintColor] = useState(() => hsvToHex(0, 0.8, 0.8));
  const [colorScheme, setColorScheme] = useState<ColorSchemeKind>("complementary");
  const [maskValue, setMaskValue] = useState(255);
  const [error, setError] = useState<MessageKey | null>(null);
  const [editorInput, setEditorInput] = useState<ConventionalEditorInput | null>(null);
  const [editorTab, setEditorTab] = useState<"Adjust" | "Filters" | "Perspective">("Adjust");
  const [aiOpen, setAiOpen] = useState(false);
  const [deliveryOpen, setDeliveryOpen] = useState(false);
  const [deliveryFormat, setDeliveryFormat] = useState<DeliveryFormat>("png");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [apiKeyOpen, setApiKeyOpen] = useState(false);
  const [saveToast, setSaveToast] = useState<{ kind: "success" | "error"; message: string } | null>(null);
  const [navigatorCollapsed, setNavigatorCollapsed] = useState(false);
  const [shortcutBindings, setShortcutBindings] = useState(loadShortcuts);
  const [adjustmentDraft, setAdjustmentDraft] = useState<{ layer: AdjustmentLayer; sourceLayerId: string | null; selection: PixelSelectionMask | null } | null>(null);
  const [cropOpen, setCropOpen] = useState(false);
  const [gridEnabled, setGridEnabled] = useState(false);
  const [rulersEnabled, setRulersEnabled] = useState(false);
  const [gridSpacing, setGridSpacing] = useState(32);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [historyBusy, setHistoryBusy] = useState(false);
  const historyBusyRef = useRef(false);
  const [, refreshHistory] = useState(0);
  const stageRef = useRef<Konva.Stage>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const historyRef = useRef(new DocumentHistory());
  const documentRef = useRef(document);
  documentRef.current = document;
  useEffect(() => {
    let active = true;
    void PixelTileArchive.open().then((archive) => { if (active) historyRef.current.setPixelArchive(archive); });
    return () => { active = false; historyRef.current.clear(); historyRef.current.setPixelArchive(null); };
  }, []);
  const {
    projects, projectId, projectRevision, projectRevisionRef, persistence, persistenceError,
    online, draftError, draftCandidate, recoverableOperation, setRecoverableOperation,
    fileBusy, fileError, lastSavedUpdatedAtRef,
    saveProject, openProject, importStudioFile, renameProject,
    applyDraft, discardDraft, discardAndOpenRemote,
  } = useStudioProject({ document, documentRef, setDocument, historyRef, refreshHistory, fitView, setError, locale });
  const selected = document.layers.find((layer) => layer.id === document.selection.layerId) ?? null;
  const selectedElement = selected?.type === "annotation"
    ? selected.elements.find((element) => element.id === selectedElementId) ?? selected.elements[0] : undefined;
  const selectedObjectColor = selectedElement?.kind === "text" ? selectedElement.fill : selectedElement?.stroke;
  useEffect(() => {
    if (selectedObjectColor && tool !== "text" && tool !== "shape") setPaintColor(selectedObjectColor);
  }, [selected?.id, selectedElement?.id, selectedObjectColor, tool]);
  const propertyLabels = PROPERTY_LABELS[locale];
  const brushSettings = document.brushSettings;
  const requiresComposite = document.layers.some((layer) => layer.vectorMask || layer.filters?.length || layer.effects || layer.rasterMaskId || layer.type === "group" || layer.type === "adjustment" || layer.type === "paint" || layer.type === "mask");
  const selectedEditable = selected ? layerIsEditable(document.layers, selected.id) : false;
  const selectedRasterTooLarge = selected?.type === "raster" && selected.width * selected.height > MAX_DIRECT_PIXEL_COUNT;

  const commit = useCallback((recipe: (current: ImageStudioDocument) => ImageStudioDocument, label: string, mergeKey?: string) => {
    if (historyBusyRef.current) return;
    setDocument((current) => historyRef.current.execute(current, recipe(current), label, mergeKey));
    refreshHistory((value) => value + 1);
  }, []);
  const commitPixel = useCallback((recipe: (current: ImageStudioDocument) => ImageStudioDocument, label: string, layerId: string, diffs: Parameters<DocumentHistory["executePixel"]>[4], addedLayer?: RasterLayer) => {
    if (historyBusyRef.current) return;
    setDocument((current) => historyRef.current.executePixel(current, recipe(current), label, layerId, diffs, addedLayer));
    refreshHistory((value) => value + 1);
  }, []);
  const canRecordPixel = useCallback((diffs: Parameters<DocumentHistory["canRecordPixel"]>[0]) => historyRef.current.canRecordPixel(diffs), []);
  const canRecordPixelBytes = useCallback((bytes: number) => historyRef.current.canRecordPixelBytes(bytes), []);
  const canRecordPixelLift = useCallback((diffs: Parameters<DocumentHistory["canRecordPixelLift"]>[0], layer: RasterLayer) =>
    historyRef.current.canRecordPixelLift(diffs, layer), []);

  const editSelectedElement = (element: AnnotationElement, field: string) => {
    if (!selected || selected.type !== "annotation" || !selectedEditable || pixelSelection?.layerId === selected.id) return;
    commit((current) => replaceAnnotationElement(current, selected.id, element), "Edit annotation", `annotation:${selected.id}:${element.id}:${field}`);
    if (element.kind === "text" && field === "fill") setPaintColor(element.fill);
    else if (element.kind !== "text" && field === "stroke") setPaintColor(element.stroke);
  };
  const changePaintColor = (next: string) => {
    setPaintColor(next);
    if (tool === "text") setTextTemplate((current) => ({ ...current, fill: next }));
    else if (tool === "shape") setShapeTemplate((current) => ({ ...current, stroke: next }));
    else if (selectedElement) editSelectedElement(selectedElement.kind === "text" ? { ...selectedElement, fill: next } : { ...selectedElement, stroke: next }, "color");
  };

  const {
    cursorPreview, setCursorPreview, pixelSelection, setPixelSelection, marqueeDraft, lassoDraft, draftAnnotation, pixelPreviewVersion,
    directPixelCanvasRef, directPixelLayerIdRef, activePointerIdRef,
    beginPointer, movePointer, endPointer, clearPixelSelection, copyPixelSelection, liftPixelSelection, invertPixelSelection, restorePixelHistory,
  } = useRasterToolSession({
    tool, document, selected, selectedEditable, selectedRasterTooLarge, viewport, setViewport, stageRef, commit, commitPixel, canRecordPixel, canRecordPixelLift, canRecordPixelBytes,
    brushSettings, brushSize, paintColor, changePaintColor, maskValue, magicTolerance, selectionOperation, smudgeStrength, pixelOpacity,
    gradientTransparent, gradientEndColor, shapeTool, textTemplate, shapeTemplate, locale, setError,
    setTool, setInspectorTab, setSelectedElementId, setTextFocusRequest,
  });

  const compositePreview = useCompositePreview(document, requiresComposite, pixelPreviewVersion,
    directPixelCanvasRef.current && directPixelLayerIdRef.current ? new Map([[directPixelLayerIdRef.current, directPixelCanvasRef.current]]) : undefined,
    activePointerIdRef.current !== null, () => setError("editFailed"));
  const liftVectorSelection = () => {
    const snapshot = documentRef.current;
    const sourceId = snapshot.selection.layerId;
    if (!sourceId || pixelSelection?.layerId !== sourceId) return;
    try {
      const next = liftSelectedVectorLayer(snapshot, sourceId, pixelSelection);
      if (next === snapshot || !historyRef.current.canRecord(snapshot, next)) throw new Error("Vector selection cannot be lifted");
      commit((current) => current === snapshot ? next : current, "Lift selected vector content");
      setPixelSelection(null);
      setSelectedElementId(null);
      setTool("select");
    } catch { setError("editFailed"); }
  };
  const canLiftVectorSelection = Boolean(selected && selectedEditable
    && (selected.type === "paint" && selected.strokes.length > 0
      || selected.type === "annotation" && selected.elements.length > 0));

  const commitLayerTransform = (layerId: string, transform: ImageStudioLayer["transform"], mergeKey?: string) => {
    // A temporary pixel selection cannot authorize moving the whole source layer.
    if (pixelSelection?.layerId === layerId) return;
    commit((current) => setLayerTransform(current, layerId, snapEnabled && mergeKey?.startsWith("drag:") ? snapLayer(current, layerId, transform, 6 / viewport.scale, gridEnabled ? gridSpacing : undefined) : transform), "Transform layer", mergeKey);
  };

  useEffect(() => {
    const transformer = transformerRef.current;
    const stage = stageRef.current;
    if (!transformer || !stage) return;
    const node = selected && tool === "select" && !selected.locked && pixelSelection?.layerId !== selected.id ? stage.findOne(`#node-${selected.id}`) : null;
    transformer.nodes(node ? [node] : []);
    transformer.getLayer()?.batchDraw();
  }, [selected, tool, document.layers, compositePreview, pixelSelection?.layerId]);

  const restoreHistory = useCallback(async (index: number) => {
    if (historyBusyRef.current || activePointerIdRef.current !== null) return;
    historyBusyRef.current = true; setHistoryBusy(true);
    const current = documentRef.current;
    try {
      const next = await historyRef.current.seek(current, index, restorePixelHistory);
      documentRef.current = next; setDocument(next); setPixelSelection(null);
      refreshHistory(value => value + 1);
    } catch { setError("editFailed"); }
    finally { directPixelCanvasRef.current = null; directPixelLayerIdRef.current = null; historyBusyRef.current = false; setHistoryBusy(false); }
  }, [restorePixelHistory, setPixelSelection]);
  const runHistory = useCallback((direction: "undo" | "redo") => {
    const timeline = historyRef.current.timeline;
    if (direction === "undo" ? !timeline.undo.length : !timeline.redo.length) return;
    void restoreHistory(timeline.undo.length + (direction === "undo" ? -1 : 1));
  }, [restoreHistory]);
  const undoDocument = useCallback(() => runHistory("undo"), [runHistory]);
  const redoDocument = useCallback(() => runHistory("redo"), [runHistory]);

  const removeSelectedLayer = useCallback(() => {
    if (pixelSelection && pixelSelection.layerId === selected?.id) {
      if (selected.type === "raster") clearPixelSelection();
      else if (selected.type === "paint" || selected.type === "annotation") {
        try {
          commit((current) => clearSelectedVectorPixels(current, selected.id, pixelSelection), "Clear selected pixels");
          setPixelSelection(null);
        } catch { setError("editFailed"); }
      }
      return;
    }
    if (selected && selectedEditable) commit((current) => deleteLayer(current, selected.id), "Delete layer");
  }, [commit, selected, selectedEditable, pixelSelection, clearPixelSelection]);

  const duplicateSelectedLayer = useCallback(() => {
    if (selected) commit((current) => duplicateLayer(current, selected.id), "Duplicate layer");
  }, [commit, selected]);

  const copySelectedLayer = useCallback(() => {
    if (pixelSelection && pixelSelection.layerId === selected?.id) {
      const layer = copyPixelSelection();
      if (!layer) return false;
      setClipboard({ ...documentRef.current, layers: [layer], selection: { layerId: layer.id } });
      return true;
    }
    const copied = copyLayer(documentRef.current);
    if (!copied) return false;
    setClipboard(copied);
    return true;
  }, [pixelSelection, selected?.id, copyPixelSelection]);
  const cutSelectedLayer = useCallback(() => {
    if (!selected || !selectedEditable) return;
    if (copySelectedLayer()) removeSelectedLayer();
  }, [selected, selectedEditable, copySelectedLayer, removeSelectedLayer]);
  const pasteCopiedLayer = useCallback(() => {
    if (clipboard) commit((current) => pasteLayer(current, clipboard), "Paste layer");
  }, [clipboard, commit]);

  // Opens the adjustment layer in a popup (like RasterEditorDialog) before it ever touches the
  // real document — nothing is committed until the dialog resolves to keep or bake.
  const createAdjustmentForSelection = useCallback((kind: AdjustmentKind) => {
    const snapshot = documentRef.current;
    const sourceLayerId = snapshot.selection.layerId;
    const source = snapshot.layers.find((layer) => layer.id === sourceLayerId);
    const selection = pixelSelection?.layerId === sourceLayerId ? pixelSelection : null;
    const label = ADJUSTMENT_KIND_LABELS[locale][kind];
    const layer = createAdjustmentLayer(snapshot, kind, label, source?.parentId ?? null);
    if (selection) {
      try {
        if (!sourceLayerId || addSelectionMaskedAdjustmentLayer(snapshot, sourceLayerId, selection, layer) === snapshot) {
          setError("editFailed"); return;
        }
      } catch { setError("editFailed"); return; }
    }
    setAdjustmentDraft({ layer, sourceLayerId, selection });
  }, [locale, pixelSelection]);

  const addMaskToSelectedLayer = useCallback(() => {
    if (!selected || !selectedEditable || selected.type === "mask" || selected.rasterMaskId) return;
    commit((current) => {
      if (!layerIsEditable(current.layers, selected.id)) return current;
      const mask = selected.type === "adjustment"
        ? { ...createDrawingLayer(current, "mask", `${selected.name} — ${t("maskLayer")}`), parentId: selected.parentId }
        : createAttachedRasterMask(current, selected, `${selected.name} — ${t("maskLayer")}`);
      if (selected.type === "adjustment") return selectLayer(insertLayerAfter(current, selected.id, mask), mask.id);
      const linked = patchLayer(current, selected.id, { rasterMaskId: mask.id });
      return selectLayer(insertLayerAfter(linked, selected.id, { ...mask, width: selected.width, height: selected.height }), mask.id);
    }, selected.type === "adjustment" ? "Add adjustment mask" : "Add raster mask");
    setInspectorTab("properties");
  }, [commit, selected, selectedEditable, t]);

  const mergeLayer = async (layerId: string, direction: -1 | 1) => {
    const snapshot = documentRef.current;
    const plan = planLayerMerge(snapshot, layerId, direction);
    if (!plan) return;
    const { source, target, includedIds: pairIds } = plan;
    try {
      const pairDocument = {
        ...snapshot,
        layers: snapshot.layers.filter((layer) => pairIds.has(layer.id)).map((layer) => ({ ...layer, parentId: null })),
        selection: { layerId: null },
      };
      const blob = await exportImage(pairDocument, {
        format: "png", width: snapshot.canvas.width, height: snapshot.canvas.height, quality: 1, jpegBackground: "#ffffff",
      });
      const dataUrl = await blobDataUrl(blob);
      const merged = rasterLayerFromImage({
        dataUrl, mimeType: "image/png", width: snapshot.canvas.width, height: snapshot.canvas.height,
        name: `${target.name} + ${source.name}`,
      });
      commit((current) => replaceAdjacentLayers(current, layerId, direction, merged, snapshot), "Merge layers");
    } catch { setError("editFailed"); }
  };

  const bakeSelectedAdjustmentDraft = (layer: AdjustmentLayer, sourceLayerId: string, selection: PixelSelectionMask) => {
    const snapshot = documentRef.current;
    const sourceLayer = snapshot.layers.find((candidate) => candidate.id === sourceLayerId);
    const canvas = directPixelCanvasRef.current;
    if (!sourceLayer || sourceLayer.type !== "raster" || !canBakeSelectedAdjustment(snapshot, sourceLayerId, selection, layer)
      || !canvas || directPixelLayerIdRef.current !== sourceLayerId) { setError("editFailed"); return; }
    let diffs: PixelTileDiff[] = [];
    try {
      const coverage = resolveRasterEditCoverage(snapshot, sourceLayer, selection);
      if (!coverage) throw new Error("Selection coverage is unavailable");
      diffs = bakeSelectedAdjustmentTiles(canvas, selection, coverage, layer.adjustment, layer.opacity, layer.blendMode,
        canRecordPixelBytes, canRecordPixel);
      if (!diffs.length) return;
      const value = canvas.toDataURL("image/png");
      if (documentRef.current.layers !== snapshot.layers) throw new Error("Adjustment source changed");
      commitPixel((current) => replaceRasterPixels(current, sourceLayerId,
        { kind: "data-url", value, mimeType: "image/png" }), "Bake selected adjustment", sourceLayerId, diffs);
    } catch {
      if (diffs.length) applyPixelTileDiffs(canvas, diffs, "before");
      setError("editFailed");
    }
  };

  // Bakes a still-uncommitted draft adjustment layer straight into the raster layer it was
  // created from, reusing the same isolated-pair render mergeLayer uses above. The draft never
  // touched the real document, so — unlike a kept adjustment layer — it can't have a mask yet.
  const bakeAdjustmentDraft = async (layer: AdjustmentLayer, sourceLayerId: string) => {
    const snapshot = documentRef.current;
    const sourceLayer = snapshot.layers.find((candidate) => candidate.id === sourceLayerId);
    if (!sourceLayer || sourceLayer.type !== "raster" || sourceLayer.locked) return;
    if (sourceLayer.rasterMaskId || sourceLayer.vectorMask || sourceLayer.filters?.length || sourceLayer.effects) { setError("editFailed"); return; }
    try {
      const pairDocument = {
        ...snapshot,
        layers: [{ ...sourceLayer, parentId: null }, { ...layer, parentId: null }],
        selection: { layerId: null },
      };
      const blob = await exportImage(pairDocument, {
        format: "png", width: snapshot.canvas.width, height: snapshot.canvas.height, quality: 1, jpegBackground: "#ffffff",
      });
      const dataUrl = await blobDataUrl(blob);
      // The source layer may have changed while the export above was in flight (locked or
      // deleted) — bail rather than commit against a stale plan, same guard mergeLayer applies.
      if (documentRef.current.layers !== snapshot.layers) return;
      commit((current) => replaceRasterLayer(current, sourceLayerId, {
        width: snapshot.canvas.width, height: snapshot.canvas.height,
        source: { kind: "data-url", value: dataUrl, mimeType: "image/png" },
        resetPosition: true,
      }), "Apply adjustment to layer");
    } catch { setError("editFailed"); }
  };

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface || pathEditing || cropOpen || historyBusy || paletteOpen || aiOpen || deliveryOpen || editorInput || settingsOpen || apiKeyOpen || fileBusy || adjustmentDraft) return;
    return bindConfiguredShortcuts(surface, shortcutBindings, (action) => {
      if (historyBusyRef.current) return;
      if (action === "undo") undoDocument();
      else if (action === "redo") redoDocument();
      else if (action === "copy") copySelectedLayer();
      else if (action === "cut") cutSelectedLayer();
      else if (action === "paste") pasteCopiedLayer();
      else if (action === "delete") removeSelectedLayer();
      else if (action === "fit") fitView();
      else if (action === "eyedropper") void pickScreenColor();
      else {
        if (SECONDARY_TOOLS.includes(action) && (selected?.type !== "raster" || !selectedEditable || selectedRasterTooLarge)) return;
        if (SELECTION_TOOLS.includes(action) && (!selected || !["raster", "paint", "annotation"].includes(selected.type)
          || !selectedEditable || (action === "magicWand" && (selected.type !== "raster" || selectedRasterTooLarge)))) return;
        if ((action === "brush" || action === "eraser") && selectedRasterTooLarge) return;
        setTool(action); setInspectorTab("properties");
      }
    });
  }, [copySelectedLayer, cutSelectedLayer, pasteCopiedLayer, removeSelectedLayer, pathEditing, cropOpen, historyBusy, paletteOpen, aiOpen, deliveryOpen, editorInput, settingsOpen, apiKeyOpen, fileBusy, adjustmentDraft, shortcutBindings, fitView, redoDocument, selected, selectedEditable, selectedRasterTooLarge, undoDocument]);

  useEffect(() => {
    const closeMenusOutside = (event: MouseEvent) => {
      window.document.querySelectorAll<HTMLDetailsElement>(".layer-row-menu[open]").forEach((menu) => {
        if (!menu.contains(event.target as Node)) menu.removeAttribute("open");
      });
    };
    window.document.addEventListener("mousedown", closeMenusOutside);
    return () => window.document.removeEventListener("mousedown", closeMenusOutside);
  }, []);

  const selectObject = (layerId: string, elementId?: string, edit = false) => {
    setDocument((current) => selectLayer(current, layerId));
    setSelectedElementId(elementId ?? null);
    if (edit) {
      setTool("select");
      setInspectorTab("properties");
      const layer = documentRef.current.layers.find(candidate=>candidate.id===layerId);
      const element = layer?.type === "annotation" ? layer.elements.find(candidate=>candidate.id===elementId) : undefined;
      if (element?.kind === "text") setTextEditing({layerId,elementId:element.id});
      else if(element?.kind==="path")setPathEditing({layerId,mask:false,initial:element});
      else setTextFocusRequest((value) => value + 1);
    }
  };
  const pickScreenColor = async () => {
    setTool("eyedropper");
    setInspectorTab("properties");
    const EyeDropper = (window as Window & { EyeDropper?: EyeDropperConstructor }).EyeDropper;
    const result = await requestNativeColor(EyeDropper);
    if (result.status === "picked") changePaintColor(result.color);
  };
  const history = historyRef.current.state;
  const selectionPreview = useMemo(() => pixelSelection ? createSelectionPreview(pixelSelection) : null, [pixelSelection]);
  const paintHsv = useMemo(() => hexToHsv(paintColor), [paintColor]);
  const harmonySwatches = useMemo(() => colorSchemeSwatches(paintColor, colorScheme), [paintColor, colorScheme]);
  const previewHistogram = useMemo(() => compositePreview ? previewLuminosityHistogram(compositePreview) : undefined, [compositePreview]);
  const toolLabels = TOOL_LABELS[locale];
  const activateTool = (next: Tool) => { setTool(next); setInspectorTab("properties"); };
  const toolLabel = (name: Tool) => name === "select" || name === "hand" || name === "brush" || name === "eraser" || name === "eyedropper"
    ? t(name) : toolLabels[name];
  const cursorToolSize = brushSize;
  const cursorLayerScale = !selected ? 1
    : Math.sqrt(Math.abs(selected.transform.scaleX * selected.transform.scaleY));
  const cursorRadius = cursorToolSize * viewport.scale * cursorLayerScale / 2;
  const updateBrushSettings = (next: BrushSettings, mergeKey = "brush-settings") => {
    commit((current) => touchDocument({ ...current, brushSettings: next }), "Change brush settings", mergeKey);
  };
  const manuallySaveProject = async () => {
    const saved = await saveProject();
    setSaveToast({ kind: saved ? "success" : "error", message: t(saved ? "saveSucceeded" : "saveFailed") });
  };

  const toolEnabled = (next: Tool) => {
    if (SECONDARY_TOOLS.includes(next)) return selected?.type === "raster" && selectedEditable && !selectedRasterTooLarge;
    if (SELECTION_TOOLS.includes(next)) return Boolean(selected && ["raster", "paint", "annotation"].includes(selected.type)
      && selectedEditable && (next !== "magicWand" || (selected.type === "raster" && !selectedRasterTooLarge)));
    return (next !== "brush" && next !== "eraser") || !selectedRasterTooLarge;
  };
  const openRasterEditor = (mode: "Adjust" | "Filters" | "Perspective") => {
    if (selected?.type !== "raster" || !selectedEditable) return;
    try {
      const coverage = resolveRasterEditCoverage(document, selected, pixelSelection?.layerId === selected.id ? pixelSelection : null);
      if (mode === "Perspective" && coverage) { setError("editFailed"); return; }
      setEditorTab(mode); setEditorInput({ sourceUrl: rasterSourceUrl(selected.source), mimeType: selected.source.mimeType, width: selected.width, height: selected.height, name: selected.name, coverage });
    } catch { setError("editFailed"); }
  };
  const reasonCopy = disabledReasonCopy[locale];
  const reason = (key: DisabledReason | null): string | null => key ? reasonCopy[key] : null;
  const selectedBlocker: DisabledReason | null = selected ? layerEditBlocker(document.layers, selected) : "noLayer";
  const rasterBlocker = !selected ? "noLayer" : selected.type !== "raster" ? "rasterOnly" : selectedBlocker;
  const projectBlocker: DisabledReason | null = !projectId ? "projectUnsaved" : persistence === "saving" ? "saving"
    : persistence === "conflict" ? "saveConflict" : persistence === "error" ? "saveFailed"
    : persistence !== "saved" || document.metadata.updatedAt !== lastSavedUpdatedAtRef.current ? "unsavedChanges" : null;
  const pixelTooLargeReason = selectedRasterTooLarge ? t("pixelTooLarge") : null;
  const rasterToolBlocker = reason(rasterBlocker) ?? pixelTooLargeReason;
  const aiBlocker = reason(rasterBlocker ?? projectBlocker);
  const canUseAi = !aiBlocker;
  const saveBlocker = !document.layers.length ? reasonCopy.noDocument : fileBusy ? reasonCopy.fileBusy : persistence === "saving" ? reasonCopy.saving : null;
  const commands = studioCommands({ locale, t, toolLabel, toolEnabled,
    toolShortcut: (next) => shortcutBindings[next as ShortcutAction],
    activateTool: (next) => next === "eyedropper" ? void pickScreenColor() : activateTool(next),
    selectPanel: setInspectorTab, adjustmentLabels: ADJUSTMENT_KIND_LABELS[locale], createAdjustment: createAdjustmentForSelection,
    actions: {
      "file.save": { label: t("save"), enabled: Boolean(document.layers.length) && !fileBusy && persistence !== "saving", run: () => void manuallySaveProject() },
      "file.export": { label: t("export"), enabled: Boolean(document.layers.length) && !fileBusy, run: () => setDeliveryOpen(true) },
      "edit.undo": { label: t("undo"), enabled: history.canUndo, run: undoDocument, shortcut: shortcutBindings.undo },
      "edit.redo": { label: t("redo"), enabled: history.canRedo, run: redoDocument, shortcut: shortcutBindings.redo },
      "layer.duplicate": { label: fileCopy[locale].duplicateLayer, enabled: Boolean(selected), run: duplicateSelectedLayer, shortcut: "Mod+j" },
      "layer.delete": { label: fileCopy[locale].deleteLayer, enabled: selectedEditable, run: removeSelectedLayer, shortcut: "Del" },
      "layer.newPaint": { label: t("newPaintLayer"), enabled: true, run: () => commit((current) => addLayer(current, createDrawingLayer(current, "paint", t("newLayer"))), "Add layer") },
      "layer.mask": { label: t("addLayerMask"), enabled: Boolean(selected && selectedEditable && selected.type !== "mask" && !selected.rasterMaskId), run: addMaskToSelectedLayer },
      "layer.mergeDown": { label: LAYER_UI[locale].mergeDown, enabled: Boolean(selected && !pixelSelection && planLayerMerge(document, selected.id, -1)), run: () => { if (selected) void mergeLayer(selected.id, -1); } },
      ...Object.fromEntries((Object.keys(quickTransformCopy.en) as QuickTransform[]).map((operation) => [`layer.${operation}`, {
        label: quickTransformCopy[locale][operation], enabled: Boolean(selected && selectedEditable && !["mask", "adjustment"].includes(selected.type) && pixelSelection?.layerId !== selected.id),
        run: () => { if (selected) commit((current) => quickTransformLayer(current, selected.id, operation), `Transform layer: ${operation}`); },
      }])),
      "edit.newAdjustment": { label: t("adjustLayer"), enabled: !selected || selectedEditable, run: () => createAdjustmentForSelection("exposure") },
      "selection.all": { label: selectionCommandCopy[locale].all, enabled: Boolean(selected && selectedEditable && ["raster", "paint", "annotation"].includes(selected.type) && selected.width * selected.height <= MAX_DIRECT_PIXEL_COUNT), run: () => {
        if (selected) setPixelSelection({ ...rectangularSelectionMask(selected.width, selected.height, { x: 0, y: 0 }, { x: selected.width, y: selected.height }), layerId: selected.id });
      }, shortcut: "Mod+a" },
      "selection.deselect": { label: t("clearSelection"), enabled: Boolean(pixelSelection), run: () => setPixelSelection(null), shortcut: "Mod+d" },
      "selection.invert": { label: t("invertSelection"), enabled: Boolean(pixelSelection && selectedEditable && selected?.id === pixelSelection.layerId), run: invertPixelSelection, shortcut: "Mod+Shift+i" },
      "filter.adjust": { label: t("adjust"), enabled: selected?.type === "raster" && selectedEditable, run: () => openRasterEditor("Adjust") },
      "filter.filters": { label: t("filters"), enabled: selected?.type === "raster" && selectedEditable, run: () => openRasterEditor("Filters") },
      "filter.perspective": { label: perspectiveCopy[locale].title, enabled: Boolean(selected?.type === "raster" && selectedEditable && !pixelSelection && !selected.rasterMaskId), run: () => openRasterEditor("Perspective") },
      "filter.ai": { label: t("aiEdit"), enabled: canUseAi, run: () => setAiOpen(true) },
      "view.grid": {label:layoutCopy[locale].grid,enabled:true,run:()=>setGridEnabled(value=>!value)},
      "view.rulers": {label:layoutCopy[locale].rulers,enabled:true,run:()=>setRulersEnabled(value=>!value)},
      "edit.path": {label:pathCopy[locale].pen,enabled:true,run:()=>{setTextEditing(null);setCropOpen(false);setPathEditing({mask:false});}},
      "view.fit": { label: t("fit"), enabled: true, run: () => fitView(), shortcut: shortcutBindings.fit },
      "view.actualSize": { label: fileCopy[locale].actualSize, enabled: true, run: actualSize },
      "view.navigator": { label: t("navigator"), enabled: true, run: () => setNavigatorCollapsed((value) => !value) },
    },
  });
  const modalOpen = aiOpen || deliveryOpen || Boolean(editorInput) || settingsOpen || apiKeyOpen || Boolean(adjustmentDraft);
  useEffect(() => {
    if (modalOpen || fileBusy || pathEditing || cropOpen || historyBusy) return;
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.isComposing || event.altKey || event.ctrlKey === event.metaKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]')) return;
      if (event.key.toLowerCase() === "k" && !event.shiftKey) { event.preventDefault(); setPaletteOpen((value) => !value); return; }
      if (paletteOpen || event.target !== surfaceRef.current) return;
      const configured = SHORTCUT_ACTIONS.some((action) => shortcutBindings[action].toLowerCase() === `mod+${event.shiftKey ? "shift+" : ""}${event.key.toLowerCase()}`);
      if (configured) return;
      const id = event.key.toLowerCase() === "a" && !event.shiftKey ? "selection.all"
        : event.key.toLowerCase() === "j" && !event.shiftKey ? "layer.duplicate"
        : event.key.toLowerCase() === "d" && !event.shiftKey ? "selection.deselect"
        : event.key.toLowerCase() === "i" && event.shiftKey ? "selection.invert" : null;
      if (id) { event.preventDefault(); invokeEditorCommand(commands, id); }
    };
    window.document.addEventListener("keydown", keydown);
    return () => window.document.removeEventListener("keydown", keydown);
  }, [commands, modalOpen, fileBusy, paletteOpen, shortcutBindings, pathEditing, cropOpen, historyBusy]);

  useEffect(() => {
    if (!saveToast) return;
    const timer = window.setTimeout(() => setSaveToast(null), 5000);
    return () => window.clearTimeout(timer);
  }, [saveToast]);

  // Standalone installs have no skillsmaster dashboard, account or support-ticket pages.
  const standalone = isStandaloneMode();
  return (
    <div className="studio-shell">
      <header className="studio-header">
        <a className="studio-brand" href={standalone ? APP_BASE_PATH : "/dashboard"}>
          <ProductIcon name="image" className="brand-mark" />
          <span className="brand-label">{t("title")}</span>
        </a>
        <span className="header-divider" aria-hidden="true" />
        <FileMenu title={document.title} copy={fileCopy[locale]} projects={projects} busy={fileBusy || persistence === "saving"}
          commandGroups={{
            layer: { label: t("layers"), commands: commands.filter((command) => command.id.startsWith("layer.")) },
            selection: { label: toolLabels.selection, commands: commands.filter((command) => command.id.startsWith("selection.")) },
            adjustments: { label: t("adjust"), commands: commands.filter((command) => command.id.startsWith("adjustment.")) },
            filters: { label: t("filters"), commands: commands.filter((command) => command.id.startsWith("filter.")) },
          }}
          canExport={Boolean(document.layers.length)} canSave={Boolean(document.layers.length)}
          canUndo={history.canUndo} canRedo={history.canRedo} canDuplicate={Boolean(selected)} canDelete={Boolean(selected && selectedEditable)} canPaste={Boolean(clipboard)}
          canZoomIn={viewport.scale < MAX_ZOOM} canZoomOut={viewport.scale > MIN_ZOOM} navigatorVisible={!navigatorCollapsed}
          shortcuts={{ undo: shortcutBindings.undo, redo: shortcutBindings.redo, fit: shortcutBindings.fit }}
          onRename={renameProject} onNew={() => void openProject("")} onOpen={(id) => void openProject(id)} onImport={(file) => void importStudioFile(file)}
          onSave={() => void manuallySaveProject()} onExport={(format) => {setDeliveryFormat(format);setDeliveryOpen(true);}} onSettings={() => setSettingsOpen(true)} onApiKey={standalone ? () => setApiKeyOpen(true) : undefined}
          onClearLocalCache={() => { void clearPreviewTileCache().finally(refreshCacheStatus);}} cacheStatus={cacheStatus}
          onUndo={undoDocument} onRedo={redoDocument} onDuplicate={duplicateSelectedLayer} onDelete={removeSelectedLayer}
          onCopy={copySelectedLayer} onCut={cutSelectedLayer} onPaste={pasteCopiedLayer}
          onZoomIn={() => zoomAt(1.2)} onZoomOut={() => zoomAt(1 / 1.2)} onActualSize={actualSize} onFit={() => fitView()}
          onToggleNavigator={() => setNavigatorCollapsed((value) => !value)} />
        <div className="header-actions">
          <button className="primary save-button" onClick={() => void manuallySaveProject()} disabled={Boolean(saveBlocker)} title={hintTitle(t("save"), saveBlocker)}>
            <ProductIcon name="save" />
            <span>{persistence === "saving" ? t("saving") : t("save")}</span>
          </button>
          {!standalone && <>
            <span className="header-divider" aria-hidden="true" />
            <button className="ticket-button" aria-label={t("submitTicket")} title={t("submitTicket")} onClick={() => { window.location.href = "/account?view=issues&issueView=new"; }}>
              <ProductIcon name="ticket" />
              <span>{t("submitTicket")}</span>
            </button>
          </>}
          <span className="header-divider" aria-hidden="true" />
          <span className="lang-picker">
            <ProductIcon name="globe" />
            <select aria-label={t("language")} value={locale} onChange={(event) => setLocale(event.target.value as Locale)}>
              <option value="ja">日本語</option><option value="en">English</option><option value="zh-CN">简体中文</option><option value="zh-TW">繁體中文</option>
            </select>
          </span>
          {!standalone && <a className="button account-link" href="/account">
            <ProductIcon name="user" />
            <span className="account-label">{t("account")}</span>
          </a>}
        </div>
      </header>
      <ToolOptions tool={tool} label={toolLabel(tool)} locale={locale} t={t} color={paintColor} onColor={changePaintColor}
        size={brushSize} onSize={setBrushSize} brush={brushSettings} onBrush={updateBrushSettings}
        tolerance={magicTolerance} onTolerance={setMagicTolerance} selectionOperation={selectionOperation} onSelectionOperation={setSelectionOperation}
        shape={shapeTool} onShape={setShapeTool} />
      {fileBusy && <div className="studio-warning" role="status">{fileCopy[locale].busy}</div>}
      {fileError && <div className="studio-error" role="alert">{fileError}</div>}
      {(error || persistenceError) && <div className="studio-error" role="alert">{error ? t(error) : `${t("saveFailed")}: ${persistenceError}`}</div>}
      {saveToast && <div className={`studio-toast studio-toast-${saveToast.kind}`} role={saveToast.kind === "error" ? "alert" : "status"} aria-live="polite">
        {saveToast.message}
      </div>}
      {!online && <div className="studio-warning" role="status">{t("offline")}</div>}
      {draftError && <div className="studio-warning" role="alert">{t("draftFailed")}</div>}
      {draftCandidate && <div className="draft-recovery" role="alert"><span>{t(draftCandidate.recovery === "restore-as-copy" ? "conflictDraft" : "draftAvailable")}</span>
        {draftCandidate.recovery === "restore" && <button onClick={() => applyDraft(false)}>{t("restoreDraft")}</button>}
        {draftCandidate.recovery === "restore-as-copy" && <button onClick={() => applyDraft(true)}>{t("restoreCopy")}</button>}
        {draftCandidate.remoteId && <button onClick={() => void discardAndOpenRemote()}>{t("openRemote")}</button>}
        <button onClick={discardDraft}>{t("discardDraft")}</button></div>}
      {projectId && <div className={`persistence-status status-${persistence}`}>{t("projectRevision")}: {projectRevision} · {t(persistence === "conflict" ? "saveConflict" : persistence === "saved" ? "saved" : persistence === "saving" ? "saving" : "save")}</div>}
      {recoverableOperation && <div className="persistence-status status-saving">{t("operationResume")}
        <button onClick={() => {
          setDocument((current) => ({ ...current, selection: { layerId: recoverableOperation.inputLayerId } }));
          setAiOpen(true);
        }}>{t("resume")}</button></div>}
      {historyBusy && <p role="status">{editingCopy[locale].busy}</p>}
      <main className="studio-workspace" ref={node => node?.toggleAttribute("inert", historyBusy)}>
        <ToolRail tool={tool} shapeTool={shapeTool} labels={toolLabels} toolLabel={toolLabel} t={t}
          perspectiveLabel={perspectiveCopy[locale].title} brushBlocker={pixelTooLargeReason}
          rasterToolBlocker={rasterToolBlocker} magicWandBlocker={rasterToolBlocker}
          selectionToolBlocker={reason(!selected ? "noLayer" : !["raster", "paint", "annotation"].includes(selected.type) ? "selectionUnsupported" : selectedBlocker)}
          rasterEditBlocker={reason(rasterBlocker)} aiBlocker={aiBlocker}
          onActivate={(next) => { invokeEditorCommand(commands, `tool.${next}`); }} onShapeChange={setShapeTool} onPickColor={() => { invokeEditorCommand(commands, "tool.eyedropper"); }}
          onOpenRasterEditor={openRasterEditor} onOpenAi={() => { invokeEditorCommand(commands, "filter.ai"); }} />
        <section className="canvas-column">
          <WorkbenchBar title={document.title} width={document.canvas.width} height={document.canvas.height} locale={locale}
            onCommands={() => setPaletteOpen(true)} onCrop={() => setCropOpen(true)} snap={snapEnabled} onSnap={() => setSnapEnabled(value => !value)} layoutControls={<>
              <button onClick={()=>{setTextEditing(null);setCropOpen(false);setPathEditing({mask:false});}}>{pathCopy[locale].pen}</button>
              <button aria-pressed={gridEnabled} onClick={()=>setGridEnabled(value=>!value)}>{layoutCopy[locale].grid}</button>
              <button aria-pressed={rulersEnabled} onClick={()=>setRulersEnabled(value=>!value)}>{layoutCopy[locale].rulers}</button>
              {gridEnabled&&<input className="grid-spacing" aria-label={layoutCopy[locale].spacing} type="number" min="4" max="512" value={gridSpacing} onChange={event=>{const n=event.target.valueAsNumber;if(Number.isFinite(n))setGridSpacing(Math.max(4,Math.min(512,Math.round(n))));}} />}
              {!!document.guides?.length&&<button onClick={()=>commit(current=>touchDocument({...current,guides:[]}),"Clear guides")}>{layoutCopy[locale].clear}</button>}
            </>} />
          <div className={`canvas-surface tool-${tool}`} ref={surfaceRef} aria-label={t("canvasLabel")} tabIndex={0} onPointerLeave={() => setCursorPreview(null)}
            onPointerDown={(event) => {
              if (event.target instanceof HTMLCanvasElement) surfaceRef.current?.focus({ preventScroll: true });
            }}>
          {pathEditing && <CanvasPathEditor key={`${pathEditing.layerId??"new"}:${pathEditing.mask}:${pathEditing.initial?.id??"new"}`} document={document} layer={document.layers.find(layer=>layer.id===pathEditing.layerId)} initial={pathEditing.initial} mask={pathEditing.mask} color={paintColor} viewport={viewport} locale={locale} onClose={()=>setPathEditing(null)} onSave={path=>{
            if(pathEditing.mask&&pathEditing.layerId)commit(current=>patchLayer(current,pathEditing.layerId!,{vectorMask:{path,inverted:current.layers.find(layer=>layer.id===pathEditing.layerId)?.vectorMask?.inverted}}),"Edit vector mask");
            else if(pathEditing.layerId)commit(current=>replaceAnnotationElement(current,pathEditing.layerId!,path),"Edit vector path");
            else commit(current=>addLayer(current,{...createAnnotationLayer(current,"Path"),elements:[path]}),"Add vector path");
          }} />}
          {!cropOpen && <CanvasGuides viewport={viewport} width={document.canvas.width} height={document.canvas.height} grid={gridEnabled} spacing={gridSpacing} rulers={rulersEnabled} guides={document.guides??[]} locale={locale}
            onAdd={(axis,position)=>commit(current=>(current.guides?.length??0)>=100?current:touchDocument({...current,guides:[...(current.guides??[]),{id:createId("guide"),axis,position}]}),"Add guide")}
            onMove={(id,position)=>commit(current=>touchDocument({...current,guides:current.guides?.map(guide=>guide.id===id?{...guide,position}:guide)}),"Move guide",`guide:${id}`)}
            onRemove={id=>commit(current=>touchDocument({...current,guides:current.guides?.filter(guide=>guide.id!==id)}),"Delete guide")} />}
          {textEditing && selected?.type === "annotation" && selected.id === textEditing.layerId && selectedElement?.kind === "text" && selectedElement.id === textEditing.elementId && <CanvasTextEditor
            key={`${selected.id}:${selectedElement.id}`} document={document} layer={selected} element={selectedElement} viewport={viewport} locale={locale}
            onSave={element=>commit(current=>replaceAnnotationElement(current,selected.id,element),"Edit text")} onClose={()=>setTextEditing(null)} />}
          {cropOpen && <CanvasCrop key={document.id} width={document.canvas.width} height={document.canvas.height} offsetX={viewport.offsetX} offsetY={viewport.offsetY} scale={viewport.scale} locale={locale}
            onCancel={() => setCropOpen(false)} onApply={rect => { commit(current => cropCanvas(current, rect), "Crop canvas"); setPixelSelection(null); setCropOpen(false); fitView({width:rect.width,height:rect.height}); }} />}
          {document.layers.length === 0 && <label className="empty-state"><strong>{t("emptyTitle")}</strong><span>{t("emptyHint")}</span>
            <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importStudioFile(file); }} /></label>}
          <Stage ref={stageRef} width={surfaceSize.width} height={surfaceSize.height}
            onPointerDown={cropOpen || pathEditing ? undefined : beginPointer} onPointerMove={cropOpen || pathEditing ? undefined : movePointer} onPointerUp={cropOpen || pathEditing ? undefined : endPointer}
            onPointerCancel={endPointer}
            onPointerEnter={movePointer} onPointerLeave={() => setCursorPreview(null)}>
            <Layer listening={false}>
              <Group x={viewport.offsetX} y={viewport.offsetY} scaleX={viewport.scale} scaleY={viewport.scale}
                clip={{ x: 0, y: 0, width: document.canvas.width, height: document.canvas.height }}>
                <Rect width={document.canvas.width} height={document.canvas.height} fill="#fff" shadowColor="#000" shadowBlur={16 / viewport.scale} shadowOpacity={0.2} />
              </Group>
            </Layer>
            <Layer>
              {requiresComposite && compositePreview && <Group x={viewport.offsetX} y={viewport.offsetY}
                scaleX={viewport.scale} scaleY={viewport.scale}
                clip={{ x: 0, y: 0, width: document.canvas.width, height: document.canvas.height }}>
                <KonvaImage image={compositePreview} width={document.canvas.width} height={document.canvas.height} listening={false} />
              </Group>}
              {!requiresComposite && document.layers.map((layer) => <Group key={layer.id} x={viewport.offsetX} y={viewport.offsetY}
                scaleX={viewport.scale} scaleY={viewport.scale}
                clip={{ x: 0, y: 0, width: document.canvas.width, height: document.canvas.height }}>
                  {layer.type === "group" || layer.type === "adjustment" ? null : layer.type === "raster" ?
                    directPixelCanvasRef.current && directPixelLayerIdRef.current === layer.id && DIRECT_PIXEL_TOOLS.includes(tool)
                      ? <Group x={layer.transform.x} y={layer.transform.y} scaleX={layer.transform.scaleX} scaleY={layer.transform.scaleY}
                        rotation={layer.transform.rotation} visible={layer.visible} opacity={layer.opacity}
                        globalCompositeOperation={canvasBlendMode(layer.blendMode)}>
                        <KonvaImage image={directPixelCanvasRef.current} width={layer.width} height={layer.height} listening={false} />
                      </Group>
                      : <RasterNode layer={layer} selectable={tool === "select"} transformable={pixelSelection?.layerId !== layer.id} onSelect={() => setDocument((current) => selectLayer(current, layer.id))}
                        onTransform={(transform, mergeKey) => commitLayerTransform(layer.id, transform, mergeKey)} /> :
                    layer.type === "annotation" ?
                    <AnnotationNode layer={layer} selectable={tool === "select"} transformable={pixelSelection?.layerId !== layer.id} onSelect={(elementId) => selectObject(layer.id, elementId)}
                      onEdit={(elementId) => selectObject(layer.id, elementId, true)}
                      onTransform={(transform, mergeKey) => commitLayerTransform(layer.id, transform, mergeKey)} /> :
                    <DrawingNode layer={layer} selectable={tool === "select"} transformable={pixelSelection?.layerId !== layer.id} onSelect={() => setDocument((current) => selectLayer(current, layer.id))}
                      onTransform={(transform, mergeKey) => commitLayerTransform(layer.id, transform, mergeKey)} />}
                  {layer.type !== "group" && layer.type !== "adjustment" && selected?.id === layer.id && tool === "select" && !layer.locked && pixelSelection?.layerId !== layer.id &&
                    <Transformer ref={transformerRef} rotateEnabled enabledAnchors={["top-left", "top-right", "bottom-left", "bottom-right"]} />}
                </Group>)}
              {requiresComposite && <Group x={viewport.offsetX} y={viewport.offsetY} scaleX={viewport.scale} scaleY={viewport.scale}>
                <Group clip={{ x: 0, y: 0, width: document.canvas.width, height: document.canvas.height }}><LayerInteractions layers={document.layers} selectable={tool === "select"} blockedTransformLayerId={pixelSelection?.layerId}
                  onSelect={(id, elementId) => selectObject(id, elementId)} onEdit={(id, elementId) => selectObject(id, elementId, true)}
                  onTransform={commitLayerTransform} /></Group>
                {selected && selected.type !== "adjustment" && selectedEditable && tool === "select" && pixelSelection?.layerId !== selected.id && <Transformer ref={transformerRef}
                  rotateEnabled enabledAnchors={["top-left", "top-right", "bottom-left", "bottom-right"]} />}
              </Group>}
              {draftAnnotation && <Group x={viewport.offsetX} y={viewport.offsetY} scaleX={viewport.scale} scaleY={viewport.scale}
                clip={{ x: 0, y: 0, width: document.canvas.width, height: document.canvas.height }}>
                {wrapLayerAncestors(document.layers, pixelSelection?.layerId === selected?.id ? selected?.id : null,
                  <AnnotationNode layer={draftLayer(document, draftAnnotation, pixelSelection?.layerId === selected?.id ? selected : null)}
                    selectable={false} onSelect={() => undefined} onTransform={() => undefined} />)}
              </Group>}
            </Layer>
            <Layer listening={false}>
              <Group x={viewport.offsetX} y={viewport.offsetY} scaleX={viewport.scale} scaleY={viewport.scale}
                clip={{ x: 0, y: 0, width: document.canvas.width, height: document.canvas.height }}>
                {selected && (selected.type === "raster" || selected.type === "paint" || selected.type === "annotation") && wrapLayerAncestors(document.layers, selected.id, <Group x={selected.transform.x} y={selected.transform.y}
                  scaleX={selected.transform.scaleX} scaleY={selected.transform.scaleY} rotation={selected.transform.rotation}>
                  {selectionPreview && pixelSelection?.layerId === selected.id && <KonvaImage image={selectionPreview} width={selected.width} height={selected.height} opacity={0.72} />}
                  {marqueeDraft && tool === "marquee" && <Rect x={Math.min(marqueeDraft.start.x, marqueeDraft.end.x)} y={Math.min(marqueeDraft.start.y, marqueeDraft.end.y)}
                    width={Math.abs(marqueeDraft.end.x - marqueeDraft.start.x)} height={Math.abs(marqueeDraft.end.y - marqueeDraft.start.y)}
                    fill="rgba(95,111,237,.12)" stroke="#1f2937" strokeWidth={1} dash={[5, 4]} strokeScaleEnabled={false} />}
                  {marqueeDraft && tool === "ellipseMarquee" && <Ellipse x={(marqueeDraft.start.x + marqueeDraft.end.x) / 2} y={(marqueeDraft.start.y + marqueeDraft.end.y) / 2}
                    radiusX={Math.abs(marqueeDraft.end.x - marqueeDraft.start.x) / 2} radiusY={Math.abs(marqueeDraft.end.y - marqueeDraft.start.y) / 2}
                    fill="rgba(95,111,237,.12)" stroke="#1f2937" strokeWidth={1} dash={[5, 4]} strokeScaleEnabled={false} />}
                  {lassoDraft && (tool === "lasso" || tool === "polygonLasso") && <Line points={lassoDraft.flatMap((point) => [point.x, point.y])}
                    closed={tool === "lasso"} stroke="#1f2937" strokeWidth={1} dash={[5, 4]} listening={false} />}
                </Group>)}
              </Group>
              {cursorPreview && <Circle name="current-color-preview" x={cursorPreview.x} y={cursorPreview.y}
                radius={SIZED_CURSOR_TOOLS.includes(tool) ? Math.max(2, cursorRadius) : 7}
                stroke="#111827" strokeWidth={1} fill={paintColor} opacity={0.25} listening={false} />}
            </Layer>
          </Stage>
          <Navigator document={document} viewport={viewport} surfaceSize={surfaceSize} collapsed={navigatorCollapsed} onCollapsedChange={setNavigatorCollapsed}
            onPan={(offsetX, offsetY) => setViewport((current) => ({ ...current, offsetX, offsetY }))} t={t} />
          </div>
          <div className="canvas-toolbar">
            <span className="canvas-dimensions">{document.canvas.width} × {document.canvas.height} px</span>
            <span className="toolbar-divider" />
            <button aria-label={`${t("reset")} -`} onClick={() => zoomAt(1 / 1.2)}><ProductIcon name="minus" /></button><output>{Math.round(viewport.scale * 100)}%</output><button aria-label={`${t("reset")} +`} onClick={() => zoomAt(1.2)}><ProductIcon name="plus" /></button>
            <button onClick={() => fitView()}>{t("fit")}</button>
            <button onClick={actualSize}>{t("reset")}</button>
            <span className="toolbar-spacer" />
            <button disabled={!history.canUndo} title={hintTitle(t("undo"), history.canUndo ? null : reasonCopy.nothingToUndo)} onClick={undoDocument}>{t("undo")}</button>
            <button disabled={!history.canRedo} title={hintTitle(t("redo"), history.canRedo ? null : reasonCopy.nothingToRedo)} onClick={redoDocument}>{t("redo")}</button>
          </div>
        </section>
        <Inspector locale={locale} activeTab={inspectorTab} layerCount={document.layers.length} t={t} onTabChange={setInspectorTab}
          history={<HistoryPanel timeline={historyRef.current.timeline} locale={locale} onUndo={undoDocument} onRedo={redoDocument} onSeek={index => void restoreHistory(index)} disabled={historyBusy} t={t} />}
          properties={<>
            {selectedRasterTooLarge && <p className="panel-empty">{t("pixelTooLarge")}</p>}
            {selected && <LayerFiltersPanel layer={selected} locale={locale} disabled={!selectedEditable}
              selectionRuns={pixelSelection?.layerId===selected.id?()=>encodeSelectionRuns(pixelSelection):undefined}
              onChange={filters=>commit(current=>patchLayer(current,selected.id,{filters}),"Edit live filters",`filters:${selected.id}`)} />}
            {selected && <LayerEffectsPanel layer={selected} locale={locale} disabled={!selectedEditable || pixelSelection?.layerId === selected.id}
              onChange={effects => commit(current => patchLayer(current, selected.id, {effects}), "Change layer effects", `effects:${selected.id}`)} />}
            {selected && !["mask", "adjustment"].includes(selected.type) && <LayerTransformProperties layer={selected} locale={locale}
              disabled={!selectedEditable || pixelSelection?.layerId === selected.id}
              onChange={(transform, mergeKey) => commitLayerTransform(selected.id, transform, mergeKey)} />}
            {selected && selected.type !== "mask" && !selected.rasterMaskId && <div className="tool-parameters">
              <button disabled={!selectedEditable} title={hintTitle(t("addLayerMask"), reason(selectedBlocker))} onClick={addMaskToSelectedLayer}>{t("addLayerMask")}</button>
            </div>}
            {tool !== "select" && tool !== "hand" && <div className="color-parameters">
              <ColorWheel value={paintColor} label={t("colorWheel")} onChange={changePaintColor} />
              <label className="color-slider-row"><span>{t("saturation")}</span><input type="range" min="0" max="100" value={Math.round(paintHsv.saturation * 100)} aria-label={t("saturation")}
                onChange={(e) => changePaintColor(hsvToHex(paintHsv.hue, Number(e.target.value) / 100, paintHsv.value))} /></label>
              <label className="color-slider-row"><span>{t("lightness")}</span><input type="range" min="10" max="100" value={Math.round(paintHsv.value * 100)} aria-label={t("lightness")}
                onChange={(e) => changePaintColor(hsvToHex(paintHsv.hue, paintHsv.saturation, Number(e.target.value) / 100))} /></label>
              <label className="color-scheme-row"><span>{t("colorScheme")}</span><select value={colorScheme} onChange={(e) => setColorScheme(e.target.value as ColorSchemeKind)}>
                {COLOR_SCHEME_KINDS.map((kind) => <option key={kind} value={kind}>{t(SCHEME_LABEL_KEY[kind])}</option>)}</select></label>
              {harmonySwatches.length > 0 && <div className="color-harmony-swatches">{harmonySwatches.map((swatch) => <div className="harmony-swatch-row" key={swatch.labelKey}>
                <button className="color-swatch small" style={{ background: swatch.hex }} title={`${t(swatch.labelKey)} ${swatch.hex.toUpperCase()}`}
                  aria-label={`${t(swatch.labelKey)} ${swatch.hex.toUpperCase()}`} onClick={() => changePaintColor(swatch.hex)} /><span className="harmony-label">{t(swatch.labelKey)}</span><code>{swatch.hex.toUpperCase()}</code>
              </div>)}</div>}
            </div>}
            {(["brush", "eraser", "airbrush", "smudge", "clone"] as Tool[]).includes(tool) && <div className="tool-parameters">
              {(tool === "brush" || tool === "airbrush" || tool === "eraser") && <>
                <label>{BRUSH_UI[locale].preset}<select value={brushSettings.presetId} onChange={(event) => updateBrushSettings(settingsForPreset(brushSettings, event.target.value as BrushPresetId), "brush-preset")}>
                  {BRUSH_PRESET_IDS.map((id) => <option key={id} value={id}>{BRUSH_PRESET_LABELS[locale][id]}</option>)}
                </select></label>
                <label>{BRUSH_UI[locale].hardness}<output>{Math.round(brushSettings.hardness * 100)}%</output><input type="range" min="0" max="1" step=".01" value={brushSettings.hardness} onChange={(event) => updateBrushSettings({ ...brushSettings, hardness: Number(event.target.value) })} /></label>
                <label>{BRUSH_UI[locale].spacing}<output>{Math.round(brushSettings.spacing * 100)}%</output><input type="range" min=".02" max="2" step=".01" value={brushSettings.spacing} onChange={(event) => updateBrushSettings({ ...brushSettings, spacing: Number(event.target.value) })} /></label>
                <label>{BRUSH_UI[locale].opacity}<output>{Math.round(brushSettings.opacity * 100)}%</output><input type="range" min="0" max="1" step=".01" value={brushSettings.opacity} onChange={(event) => updateBrushSettings({ ...brushSettings, opacity: Number(event.target.value) })} /></label>
                <label>{BRUSH_UI[locale].flow}<output>{Math.round(brushSettings.flow * 100)}%</output><input type="range" min="0" max="1" step=".01" value={brushSettings.flow} onChange={(event) => updateBrushSettings({ ...brushSettings, flow: Number(event.target.value) })} /></label>
                <label>{BRUSH_UI[locale].smoothing}<output>{Math.round(brushSettings.dynamics.smoothing * 100)}%</output><input type="range" min="0" max=".95" step=".01" value={brushSettings.dynamics.smoothing} onChange={(event) => updateBrushSettings({ ...brushSettings, dynamics: { ...brushSettings.dynamics, smoothing: Number(event.target.value) } })} /></label>
                {(["pressureSize", "pressureOpacity", "pressureFlow", "tiltAngle", "speedTaper"] as const).map((key) =>
                  <label className="brush-check" key={key}><input type="checkbox" checked={brushSettings.dynamics[key]} onChange={(event) => updateBrushSettings({ ...brushSettings, dynamics: { ...brushSettings.dynamics, [key]: event.target.checked } }, `brush-dynamic:${key}`)} />{BRUSH_UI[locale][key]}</label>)}
              </>}
              <label>{t("brushSize")}<output>{brushSize}px</output><input type="range" min="1" max="200" value={brushSize} onChange={(e) => setBrushSize(Number(e.target.value))} /></label>
              {selected?.type === "mask" && <label>{t("maskValue")}<output>{maskValue}</output><input type="range" min="0" max="255" value={maskValue} onChange={(e) => setMaskValue(Number(e.target.value))} /></label>}
            </div>}
            {(["smudge", "clone", "gradient"] as Tool[]).includes(tool) && <div className="tool-parameters">
              <label>{tool === "smudge" ? propertyLabels.strength : propertyLabels.opacity}<output>{Math.round((tool === "smudge" ? smudgeStrength : pixelOpacity) * 100)}%</output>
                <input type="range" min="0" max="1" step="0.01" value={tool === "smudge" ? smudgeStrength : pixelOpacity}
                  onChange={(event) => tool === "smudge" ? setSmudgeStrength(Number(event.target.value)) : setPixelOpacity(Number(event.target.value))} /></label>
              {tool === "clone" && <p>{propertyLabels.cloneHelp}</p>}
              {tool === "gradient" && <>
                <label className="brush-check"><input type="checkbox" checked={gradientTransparent} onChange={(event) => setGradientTransparent(event.target.checked)} />{propertyLabels.transparent}</label>
                {!gradientTransparent && <label>{propertyLabels.endColor}<input type="color" value={gradientEndColor} onChange={(event) => setGradientEndColor(event.target.value)} /></label>}
              </>}
            </div>}
            {tool === "magicWand" && <div className="tool-parameters"><label>{t("tolerance")}<output>{magicTolerance}</output>
              <input type="range" min="0" max="255" value={magicTolerance} onChange={(event) => setMagicTolerance(Number(event.target.value))} /></label></div>}
            {SELECTION_TOOLS.includes(tool) && <div className="tool-parameters"><label>{t("selectionOperation")}<select value={selectionOperation} onChange={(event) => setSelectionOperation(event.target.value as SelectionOperation)}>
              {(["replace", "add", "subtract", "intersect"] as SelectionOperation[]).map((operation) => <option key={operation} value={operation}>{t(`selection${operation[0].toUpperCase()}${operation.slice(1)}` as MessageKey)}</option>)}
            </select></label></div>}
            {selected && ["raster","paint","annotation"].includes(selected.type) && <SelectionRefinementPanel selection={pixelSelection} locale={locale} onChange={setPixelSelection}
              archives={(document.selectionArchives??[]).filter(archive=>archive.width===selected.width&&archive.height===selected.height)}
              onStore={()=>{if(!pixelSelection||(document.selectionArchives?.length??0)>=32)return;try {const runs=encodeSelectionRuns(pixelSelection);commit(current=>touchDocument({...current,selectionArchives:[...(current.selectionArchives??[]),{id:createId("selection"),name:`${selected.name.slice(0,180)} ${(current.selectionArchives?.length??0)+1}`,width:pixelSelection.width,height:pixelSelection.height,runs}]}),"Store selection");}catch{setError("editFailed");}}}
              onRestore={archive=>setPixelSelection({layerId:selected.id,width:archive.width,height:archive.height,pixels:decodeSelectionRuns(archive.runs,archive.width,archive.height)})}
              onRemove={id=>commit(current=>touchDocument({...current,selectionArchives:current.selectionArchives?.filter(archive=>archive.id!==id)}),"Remove stored selection")} />}
            {pixelSelection && <div className="selection-controls">
              <span>{t("selectionReady")}</span>

              {(() => {
                const onOtherLayer = selected && selected.id !== pixelSelection.layerId ? reasonCopy.selectionOnOtherLayer : null;
                const clearBlocker = onOtherLayer ?? rasterToolBlocker;
                const liftBlocker = !selected ? reasonCopy.noLayer : onOtherLayer ?? (selected.type === "raster" ? rasterToolBlocker
                  : reason(selectedBlocker) ?? (canLiftVectorSelection ? null : reasonCopy.nothingToLift));
                return <>
                  <button disabled={Boolean(clearBlocker)} title={hintTitle(t("clearSelectedPixels"), clearBlocker)}
                    onClick={clearPixelSelection}>{t("clearSelectedPixels")}</button>
                  <button disabled={Boolean(liftBlocker)} title={hintTitle(t("liftSelectedPixels"), liftBlocker)}
                    onClick={selected?.type === "raster" ? liftPixelSelection : liftVectorSelection}>{t("liftSelectedPixels")}</button>
                </>;
              })()}
              <button onClick={invertPixelSelection}>{t("invertSelection")}</button>
              <button onClick={() => setPixelSelection(null)}>{t("clearSelection")}</button>
            </div>}
            {selected?.rasterMaskId && <div className="tool-parameters">
              <label className="brush-check"><input type="checkbox" checked={selected.rasterMaskInverted === true}
                onChange={(event) => commit((current) => patchLayer(current, selected.id, { rasterMaskInverted: event.target.checked || undefined }), "Invert raster mask", `mask-invert:${selected.id}`)} />{t("invertSelection")}</label>
              <label>{t("brushSize")}<output>{selected.rasterMaskFeatherPx ?? 0}px</output><input type="range" min="0" max="256" value={selected.rasterMaskFeatherPx ?? 0}
                onChange={(event) => { const value = Number(event.target.value); commit((current) => patchLayer(current, selected.id, { rasterMaskFeatherPx: value || undefined }), "Feather raster mask", `mask-feather:${selected.id}`); }} /></label>
            </div>}
            {selected?.type === "paint" && !selected.effects && !selected.filters?.length && !selected.vectorMask && <div className="tool-parameters"><label>{t("maskLayer")}<select defaultValue="" onChange={(event) => event.target.value && commit((current) => attachPaintAsRasterMask(current, selected.id, event.target.value), "Attach paint as raster mask")}><option value="">{t("noSelection")}</option>{document.layers.filter((layer) => layer.id !== selected.id && !layer.rasterMaskId && layer.parentId === selected.parentId && layer.width === selected.width && layer.height === selected.height && ["raster", "paint", "annotation", "group"].includes(layer.type)).map((layer) => <option key={layer.id} value={layer.id}>{layer.name}</option>)}</select></label></div>}
            {tool === "text" && <AnnotationProperties element={{ ...textTemplate, fill: paintColor }} locale={locale} template
              onChange={(element) => { if (element.kind === "text") { setTextTemplate(element); setPaintColor(element.fill); } }} />}
            {tool === "shape" && <AnnotationProperties element={{ ...shapeTemplate, stroke: paintColor }} locale={locale} template
              onChange={(element) => { if (element.kind === "rect") { setShapeTemplate(element); setPaintColor(element.stroke); } }} />}
            {selected&&["raster","paint","annotation"].includes(selected.type)&&<fieldset disabled={!selectedEditable}><button onClick={()=>setPathEditing({layerId:selected.id,mask:true,initial:selected.vectorMask?.path})}>{selected.vectorMask?pathCopy[locale].editMask:pathCopy[locale].mask}</button>
              {selected.vectorMask&&<><button onClick={()=>commit(current=>patchLayer(current,selected.id,{vectorMask:{...selected.vectorMask!,inverted:!selected.vectorMask!.inverted}}),"Invert vector mask")}>{pathCopy[locale].invert}</button><button onClick={()=>commit(current=>patchLayer(current,selected.id,{vectorMask:undefined}),"Remove vector mask")}>{pathCopy[locale].remove}</button></>}
              {selectedElement?.kind==="path"&&<button onClick={()=>setPathEditing({layerId:selected.id,mask:false,initial:selectedElement})}>{pathCopy[locale].edit}</button>}
            </fieldset>}
            {tool !== "text" && tool !== "shape" && selected?.type === "annotation" && selectedElement && <>
              {selected.elements.length > 1 && <label className="annotation-object-picker">{propertyLabels.element}<select value={selectedElement.id}
                onChange={(event) => setSelectedElementId(event.target.value)}>{selected.elements.map((element, index) =>
                  <option key={element.id} value={element.id}>{index + 1}: {element.kind === "text" ? element.text.slice(0, 30) : toolLabels.shape}</option>)}</select></label>}
              <AnnotationProperties key={`${selected.id}:${selectedElement.id}`} element={selectedElement} locale={locale} disabled={!selectedEditable || pixelSelection?.layerId === selected.id}
                focusRequest={textFocusRequest} onChange={editSelectedElement} />
            </>}
            {selected?.type === "adjustment" && <AdjustmentPanel layer={selected} locale={locale} histogram={previewHistogram}
              onChange={(adjustment, mergeKey) => commit((current) => patchLayer(current, selected.id, { adjustment }), "Edit adjustment", mergeKey)} />}
            {!selected && <p className="panel-empty">{t("noSelection")}</p>}
          </>} layers={<LayerPanel document={document} selected={selected} locale={locale} t={t} commit={commit}
            onSelectLayer={(layerId) => setDocument((current) => selectLayer(current, layerId))}
            onMergeLayer={(layerId, direction) => void mergeLayer(layerId, direction)}
            onAddPaint={() => commit((current) => addLayer(current, createDrawingLayer(current, "paint", t("newLayer"))), "Add layer")}
            onAddMask={() => commit((current) => addLayer(current, createDrawingLayer(current, "mask", t("newMaskLayer"))), "Add mask layer")}
            onCreateAdjustment={createAdjustmentForSelection}
            onDuplicate={duplicateSelectedLayer} onMove={(direction) => selected && commit((current) => moveLayer(current, selected.id, direction), direction > 0 ? "Raise layer" : "Lower layer")}
            onRemove={removeSelectedLayer} />} footer={<>{t("history")}: {history.entries}/50 · {Math.round(history.bytes / 1024 / 1024)} MiB</>} />
      </main>
      {paletteOpen && <CommandPalette commands={commands} locale={locale} onClose={closePalette} />}
      {editorInput && editorTab !== "Perspective" && selected?.type === "raster" && <RasterEditorDialog input={editorInput} language={locale} initialMode={editorTab === "Filters" ? "filters" : "adjust"}
        onComplete={(outcome) => {
          setEditorInput(null);
          if (outcome.kind === "saved") {
            commit((current) => applyConventionalEditorOutcome(current, selected.id, outcome), "Apply conventional edit");
            if (outcome.output.resizeCanvas) fitView({ width: outcome.output.width, height: outcome.output.height });
          }
        }} />}
      {editorInput && editorTab === "Perspective" && selected?.type === "raster" && <PerspectiveDialog input={editorInput} language={locale} onComplete={(outcome) => {
        if (outcome.kind === "saved") commit((current) => applyConventionalEditorOutcome(current, selected.id, outcome), "Correct perspective");
        setEditorInput(null);
      }} />}
      {adjustmentDraft && <AdjustmentEditorDialog document={document} draft={adjustmentDraft.layer} sourceLayerId={adjustmentDraft.sourceLayerId} selection={adjustmentDraft.selection} locale={locale}
        onComplete={(outcome) => {
          setAdjustmentDraft(null);
          if (outcome.kind === "keep") {
            try {
              commit((current) => adjustmentDraft.selection && adjustmentDraft.sourceLayerId
                ? addSelectionMaskedAdjustmentLayer(current, adjustmentDraft.sourceLayerId, adjustmentDraft.selection, outcome.layer)
                : addLayer(current, outcome.layer), "Add adjustment layer");
            } catch {
              setError("editFailed");
              return;
            }
            setInspectorTab("properties");
          } else if (outcome.kind === "bake" && adjustmentDraft.sourceLayerId) {
            if (adjustmentDraft.selection) bakeSelectedAdjustmentDraft(outcome.layer, adjustmentDraft.sourceLayerId, adjustmentDraft.selection);
            else void bakeAdjustmentDraft(outcome.layer, adjustmentDraft.sourceLayerId);
            setInspectorTab("properties");
          }
        }} />}
      {aiOpen && selected?.type === "raster" && projectId && projectRevision && <AiEditDialog layer={selected} language={locale} revision={projectRevisionRef.current}
        pixelSelection={pixelSelection?.layerId === selected.id ? pixelSelection : null}
        maskLayer={selected.rasterMaskId ? document.layers.find((layer) => layer.id === selected.rasterMaskId && layer.type === "mask") as import("../domain/document").DrawingLayer | undefined : null}
        maskInverted={selected.rasterMaskInverted} maskFeatherPx={selected.rasterMaskFeatherPx}
        projectId={projectId} projectRevision={projectRevision}
        initialOperation={recoverableOperation?.inputLayerId === selected.id ? recoverableOperation : null}
        currentRevision={() => projectRevisionRef.current} onClose={() => setAiOpen(false)} t={t}
        onApply={(image, baseRevision) => {
          if (projectRevisionRef.current !== baseRevision) throw new Error("Project revision changed before result application");
          setRecoverableOperation(null);
          const outcome = applyAiResult(documentRef.current, image, selected.id);
          setDocument((current) => historyRef.current.execute(current, outcome.document, "Apply AI result"));
          setPixelSelection(null);
          refreshHistory((value) => value + 1);
          return outcome.resultLayerId;
        }} />}
      {apiKeyOpen && <ApiKeySettingsDialog copy={fileCopy[locale]} onClose={() => setApiKeyOpen(false)} />}
      {settingsOpen && <ShortcutSettingsDialog bindings={shortcutBindings} copy={fileCopy[locale]}
        labels={Object.fromEntries(SHORTCUT_ACTIONS.map((action) => [action, action === "undo" || action === "redo" || action === "fit" ? t(action) : toolLabel(action)])) as Record<ShortcutAction,string>}
        onSave={(bindings) => {setShortcutBindings(bindings);setSettingsOpen(false);}} onClose={() => setSettingsOpen(false)} />}
      {deliveryOpen && <DeliveryDialog document={document} locale={locale} t={t} initialFormat={deliveryFormat} copy={fileCopy[locale]} onClose={() => setDeliveryOpen(false)} />}
    </div>
  );
}

function formatCacheStatus(copy: typeof fileCopy.en, status: Awaited<ReturnType<typeof previewStorageStatus>>): string {
  const template = status.persistentAvailable ? copy.localCachePersistent : copy.localCacheMemory;
  return template.replace("{size}", String(Math.round(status.memoryBytes / 1024)));
}

function blobDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("read failed"));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(blob);
  });
}

function createSelectionPreview(selection: PixelSelectionMask): HTMLCanvasElement {
  const canvas = window.document.createElement("canvas");
  canvas.width = selection.width;
  canvas.height = selection.height;
  const context = canvas.getContext("2d");
  if (!context) return canvas;
  const image = context.createImageData(selection.width, selection.height);
  const isSelected = (x: number, y: number) => x >= 0 && y >= 0 && x < selection.width && y < selection.height
    && selection.pixels[y * selection.width + x] === 1;
  for (let index = 0; index < selection.pixels.length; index += 1) {
    if (!selection.pixels[index]) continue;
    const x = index % selection.width;
    const y = Math.floor(index / selection.width);
    const edge = !isSelected(x - 1, y) || !isSelected(x + 1, y) || !isSelected(x, y - 1) || !isSelected(x, y + 1);
    const offset = index * 4;
    if (edge) {
      const light = (x + y) % 6 < 3;
      image.data[offset] = light ? 255 : 17;
      image.data[offset + 1] = light ? 255 : 24;
      image.data[offset + 2] = light ? 255 : 39;
      image.data[offset + 3] = 240;
    } else {
      image.data[offset] = 95;
      image.data[offset + 1] = 111;
      image.data[offset + 2] = 237;
      image.data[offset + 3] = 38;
    }
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

function draftLayer(document: ImageStudioDocument, element: AnnotationElement, source: ImageStudioLayer | null = null): AnnotationLayer {
  const base = createAnnotationLayer(document, "draft");
  return {
    ...base, id: "annotation-draft", elements: [element], locked: true,
    transform: source?.transform ?? base.transform,
  };
}

function wrapLayerAncestors(layers: ImageStudioLayer[], layerId: string | null | undefined, content: ReactNode): ReactNode {
  if (!layerId) return content;
  return layerAncestors(layers, layerId).reduce<ReactNode>((child, ancestor) =>
    <Group key={ancestor.id} x={ancestor.transform.x} y={ancestor.transform.y}
      scaleX={ancestor.transform.scaleX} scaleY={ancestor.transform.scaleY} rotation={ancestor.transform.rotation}>{child}</Group>, content);
}
