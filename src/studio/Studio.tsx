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
  addLayer, addSelectionMaskedAdjustmentLayer, addStroke, attachPaintAsRasterMask, createAnnotationLayer, createAttachedRasterMask, createDrawingLayer, deleteLayer, duplicateLayer,
  insertLayerAfter, moveLayer, patchLayer, replaceAdjacentLayers, replaceLastStroke, replaceRasterLayer, replaceRasterPixels,
  selectLayer, setLayerTransform, replaceAnnotationElement,
} from "../domain/commands";
import { clampPoint, screenToStage, stageToImage } from "../../../shared/canvas";
import { colorSchemeSwatches, hexToHsv, hsvToHex, COLOR_SCHEME_KINDS, type ColorSchemeKind } from "../domain/color";
import {
  canvasBlendMode, createEmptyDocument, createId, LAYER_BLEND_MODES, rasterSourceUrl,
  touchDocument, type AdjustmentKind, type AdjustmentLayer, type AnnotationElement, type AnnotationTextElement, type AnnotationRectElement, type AnnotationLayer, type ImageStudioDocument, type ImageStudioLayer, type Stroke,
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
import { PixelTileArchive } from "../domain/pixelTileHistory";
import { rasterLayerFromImage } from "../domain/importImage";
import { resolveRasterEditCoverage } from "../domain/editCoverage";
import { bindConfiguredShortcuts, loadShortcuts, SHORTCUT_ACTIONS, type ShortcutAction } from "../domain/shortcutSettings";
import { encodeSelectionRuns } from "../domain/selectionMaskRuns";
import { FileMenu, type DeliveryFormat } from "./FileMenu";
import { clearPreviewTileCache, previewStorageStatus } from "./previewTiles";
import { ShortcutSettingsDialog } from "./ShortcutSettingsDialog";
import { fileCopy } from "./fileCopy";
import { BRUSH_UI, BRUSH_PRESET_LABELS } from "./brushLayerLabels";
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
  type PixelSelectionMask, type SelectionOperation,
} from "../domain/pixelTools";
import { ProductIcon, type ProductIconName } from "./ProductIcon";
import { ToolRail } from "./ToolRail";
import { Inspector, type InspectorTab } from "./Inspector";
import { LayerPanel } from "./LayerPanel";

const MAX_DIRECT_PIXEL_COUNT = 16_000_000;

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
  const [cacheStatus, setCacheStatus] = useState(fileCopy[locale].localCacheChecking);
  const refreshCacheStatus = useCallback(() => { void previewStorageStatus().then((value) => setCacheStatus(formatCacheStatus(fileCopy[locale], value))).catch(() => setCacheStatus(fileCopy[locale].localCacheUnavailable)); }, [locale]);
  useEffect(() => { refreshCacheStatus(); }, [refreshCacheStatus]);
  const [document, setDocument] = useState<ImageStudioDocument>(createEmptyDocument);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const { viewport, setViewport, surfaceSize, fitView, zoomAt, actualSize } = useCanvasViewport(surfaceRef, document.canvas);
  const [tool, setTool] = useState<Tool>("select");
  const [selectionOperation, setSelectionOperation] = useState<SelectionOperation>("replace");
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("properties");
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [textFocusRequest, setTextFocusRequest] = useState(0);
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
  const [saveToast, setSaveToast] = useState<{ kind: "success" | "error"; message: string } | null>(null);
  const [navigatorCollapsed, setNavigatorCollapsed] = useState(false);
  const [shortcutBindings, setShortcutBindings] = useState(loadShortcuts);
  const [adjustmentDraft, setAdjustmentDraft] = useState<{ layer: AdjustmentLayer; sourceLayerId: string | null; selection: PixelSelectionMask | null } | null>(null);
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
  const requiresComposite = document.layers.some((layer) => layer.type === "group" || layer.type === "adjustment" || layer.type === "paint" || layer.type === "mask");
  const selectedEditable = selected ? layerIsEditable(document.layers, selected.id) : false;
  const selectedRasterTooLarge = selected?.type === "raster" && selected.width * selected.height > MAX_DIRECT_PIXEL_COUNT;

  const commit = useCallback((recipe: (current: ImageStudioDocument) => ImageStudioDocument, label: string, mergeKey?: string) => {
    setDocument((current) => historyRef.current.execute(current, recipe(current), label, mergeKey));
    refreshHistory((value) => value + 1);
  }, []);
  const commitPixel = useCallback((recipe: (current: ImageStudioDocument) => ImageStudioDocument, label: string, layerId: string, diffs: Parameters<DocumentHistory["executePixel"]>[4]) => {
    setDocument((current) => historyRef.current.executePixel(current, recipe(current), label, layerId, diffs));
    refreshHistory((value) => value + 1);
  }, []);
  const canRecordPixel = useCallback((diffs: Parameters<DocumentHistory["canRecordPixel"]>[0]) => historyRef.current.canRecordPixel(diffs), []);
  const canRecordPixelBytes = useCallback((bytes: number) => historyRef.current.canRecordPixelBytes(bytes), []);

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
    beginPointer, movePointer, endPointer, clearPixelSelection, invertPixelSelection, restorePixelHistory,
  } = useRasterToolSession({
    tool, document, selected, selectedEditable, selectedRasterTooLarge, viewport, setViewport, stageRef, commit, commitPixel, canRecordPixel, canRecordPixelBytes,
    brushSettings, brushSize, paintColor, changePaintColor, maskValue, magicTolerance, selectionOperation, smudgeStrength, pixelOpacity,
    gradientTransparent, gradientEndColor, shapeTool, textTemplate, shapeTemplate, locale, setError,
    setTool, setInspectorTab, setSelectedElementId, setTextFocusRequest,
  });

  const compositePreview = useCompositePreview(document, requiresComposite, pixelPreviewVersion,
    directPixelCanvasRef.current && directPixelLayerIdRef.current ? new Map([[directPixelLayerIdRef.current, directPixelCanvasRef.current]]) : undefined,
    activePointerIdRef.current !== null, () => setError("editFailed"));
  const commitLayerTransform = (layerId: string, transform: ImageStudioLayer["transform"], mergeKey?: string) => {
    // A temporary pixel selection cannot authorize moving the whole source layer.
    if (pixelSelection?.layerId === layerId) return;
    commit((current) => setLayerTransform(current, layerId, transform), "Transform layer", mergeKey);
  };

  useEffect(() => {
    const transformer = transformerRef.current;
    const stage = stageRef.current;
    if (!transformer || !stage) return;
    const node = selected && tool === "select" && !selected.locked && pixelSelection?.layerId !== selected.id ? stage.findOne(`#node-${selected.id}`) : null;
    transformer.nodes(node ? [node] : []);
    transformer.getLayer()?.batchDraw();
  }, [selected, tool, document.layers, compositePreview, pixelSelection?.layerId]);

  const runHistory = useCallback((direction: "undo" | "redo") => {
    const current = documentRef.current;
    void Promise.resolve(historyRef.current[direction](current, restorePixelHistory)).then((next) => {
      if (documentRef.current !== current) return;
      setDocument(next); refreshHistory((value) => value + 1);
    }).catch(() => setError("editFailed"));
  }, [restorePixelHistory]);
  const undoDocument = useCallback(() => runHistory("undo"), [runHistory]);
  const redoDocument = useCallback(() => runHistory("redo"), [runHistory]);

  const removeSelectedLayer = useCallback(() => {
    if (selected && !selected.locked) commit((current) => deleteLayer(current, selected.id), "Delete layer");
  }, [commit, selected]);

  const duplicateSelectedLayer = useCallback(() => {
    if (selected) commit((current) => duplicateLayer(current, selected.id), "Duplicate layer");
  }, [commit, selected]);

  // Opens the adjustment layer in a popup (like RasterEditorDialog) before it ever touches the
  // real document — nothing is committed until the dialog resolves to keep or bake.
  const createAdjustmentForSelection = useCallback((kind: AdjustmentKind) => {
    const snapshot = documentRef.current;
    const sourceLayerId = snapshot.selection.layerId;
    const source = snapshot.layers.find((layer) => layer.id === sourceLayerId);
    const selection = pixelSelection?.layerId === sourceLayerId ? pixelSelection : null;
    if (selection && (!source || source.rasterMaskId || !layerIsEditable(snapshot.layers, source.id))) {
      setError("editFailed"); return;
    }
    const label = ADJUSTMENT_KIND_LABELS[locale][kind];
    if (selection) {
      try { encodeSelectionRuns(selection); }
      catch { setError("editFailed"); return; }
    }
    const layer = createAdjustmentLayer(snapshot, kind, label, source?.parentId ?? null);
    setAdjustmentDraft({ layer, sourceLayerId, selection });
  }, [locale, pixelSelection]);

  const addMaskToSelectedLayer = useCallback(() => {
    if (!selected || selected.locked || selected.type === "mask" || selected.rasterMaskId) return;
    commit((current) => {
      const mask = selected.type === "adjustment"
        ? { ...createDrawingLayer(current, "mask", `${selected.name} — ${t("maskLayer")}`), parentId: selected.parentId }
        : createAttachedRasterMask(current, selected, `${selected.name} — ${t("maskLayer")}`);
      if (selected.type === "adjustment") return selectLayer(insertLayerAfter(current, selected.id, mask), mask.id);
      const linked = patchLayer(current, selected.id, { rasterMaskId: mask.id });
      return selectLayer(insertLayerAfter(linked, selected.id, { ...mask, width: selected.width, height: selected.height }), mask.id);
    }, selected.type === "adjustment" ? "Add adjustment mask" : "Add raster mask");
    setInspectorTab("properties");
  }, [commit, selected, t]);

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

  // Bakes a still-uncommitted draft adjustment layer straight into the raster layer it was
  // created from, reusing the same isolated-pair render mergeLayer uses above. The draft never
  // touched the real document, so — unlike a kept adjustment layer — it can't have a mask yet.
  const bakeAdjustmentDraft = async (layer: AdjustmentLayer, sourceLayerId: string) => {
    const snapshot = documentRef.current;
    const sourceLayer = snapshot.layers.find((candidate) => candidate.id === sourceLayerId);
    if (!sourceLayer || sourceLayer.type !== "raster" || sourceLayer.locked) return;
    if (sourceLayer.rasterMaskId) { setError("editFailed"); return; }
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
    if (!surface || aiOpen || deliveryOpen || editorInput || settingsOpen || fileBusy || adjustmentDraft) return;
    return bindConfiguredShortcuts(surface, shortcutBindings, (action) => {
      if (action === "undo") undoDocument();
      else if (action === "redo") redoDocument();
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
  }, [aiOpen, deliveryOpen, editorInput, settingsOpen, fileBusy, adjustmentDraft, shortcutBindings, fitView, redoDocument, selected, selectedEditable, selectedRasterTooLarge, undoDocument]);

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
      setTextFocusRequest((value) => value + 1);
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

  useEffect(() => {
    if (!saveToast) return;
    const timer = window.setTimeout(() => setSaveToast(null), 5000);
    return () => window.clearTimeout(timer);
  }, [saveToast]);

  return (
    <div className="studio-shell">
      <header className="studio-header">
        <a className="studio-brand" href="/dashboard">
          <ProductIcon name="image" className="brand-mark" />
          <span className="brand-label">{t("title")}</span>
        </a>
        <span className="header-divider" aria-hidden="true" />
        <FileMenu title={document.title} copy={fileCopy[locale]} projects={projects} busy={fileBusy || persistence === "saving"}
          canExport={Boolean(document.layers.length)} canSave={Boolean(document.layers.length)}
          canUndo={history.canUndo} canRedo={history.canRedo} canDuplicate={Boolean(selected)} canDelete={Boolean(selected && !selected.locked)}
          canZoomIn={viewport.scale < MAX_ZOOM} canZoomOut={viewport.scale > MIN_ZOOM} navigatorVisible={!navigatorCollapsed}
          shortcuts={{ undo: shortcutBindings.undo, redo: shortcutBindings.redo, fit: shortcutBindings.fit }}
          onRename={renameProject} onNew={() => void openProject("")} onOpen={(id) => void openProject(id)} onImport={(file) => void importStudioFile(file)}
          onSave={() => void manuallySaveProject()} onExport={(format) => {setDeliveryFormat(format);setDeliveryOpen(true);}} onSettings={() => setSettingsOpen(true)}
          onClearLocalCache={() => { void clearPreviewTileCache().finally(refreshCacheStatus);}} cacheStatus={cacheStatus}
          onUndo={undoDocument} onRedo={redoDocument} onDuplicate={duplicateSelectedLayer} onDelete={removeSelectedLayer}
          onZoomIn={() => zoomAt(1.2)} onZoomOut={() => zoomAt(1 / 1.2)} onActualSize={actualSize} onFit={() => fitView()}
          onToggleNavigator={() => setNavigatorCollapsed((value) => !value)} />
        <div className="header-actions">
          <button className="primary save-button" onClick={() => void manuallySaveProject()} disabled={fileBusy || persistence === "saving" || !document.layers.length}>
            <ProductIcon name="save" />
            <span>{persistence === "saving" ? t("saving") : t("save")}</span>
          </button>
          <span className="header-divider" aria-hidden="true" />
          <button className="ticket-button" aria-label={t("submitTicket")} title={t("submitTicket")} onClick={() => { window.location.href = "/account?view=issues&issueView=new"; }}>
            <ProductIcon name="ticket" />
            <span>{t("submitTicket")}</span>
          </button>
          <span className="header-divider" aria-hidden="true" />
          <span className="lang-picker">
            <ProductIcon name="globe" />
            <select aria-label={t("language")} value={locale} onChange={(event) => setLocale(event.target.value as Locale)}>
              <option value="ja">日本語</option><option value="en">English</option><option value="zh-CN">简体中文</option><option value="zh-TW">繁體中文</option>
            </select>
          </span>
          <a className="button account-link" href="/account">
            <ProductIcon name="user" />
            <span className="account-label">{t("account")}</span>
          </a>
        </div>
      </header>
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
      <main className="studio-workspace">
        <ToolRail tool={tool} shapeTool={shapeTool} labels={toolLabels} toolLabel={toolLabel} t={t}
          perspectiveLabel={perspectiveCopy[locale].title} oversizedRaster={Boolean(selectedRasterTooLarge)}
          rasterToolDisabled={!selected || selected.type !== "raster" || !selectedEditable || Boolean(selectedRasterTooLarge)}
          selectionToolDisabled={!selected || !["raster", "paint", "annotation"].includes(selected.type) || !selectedEditable}
          magicWandDisabled={selected?.type !== "raster" || !selectedEditable || Boolean(selectedRasterTooLarge)}
          canEditRaster={Boolean(selected?.type === "raster" && selectedEditable)}
          canUseAi={Boolean(selected?.type === "raster" && selectedEditable && projectId && persistence === "saved" && document.metadata.updatedAt === lastSavedUpdatedAtRef.current)}
          onActivate={activateTool} onShapeChange={setShapeTool} onPickColor={() => void pickScreenColor()}
          onOpenRasterEditor={(mode) => {
            if (selected?.type !== "raster") return;
            try {
              const coverage = resolveRasterEditCoverage(document, selected, pixelSelection?.layerId === selected.id ? pixelSelection : null);
              if (mode === "Perspective" && coverage) { setError("editFailed"); return; }
              setEditorTab(mode); setEditorInput({ sourceUrl: rasterSourceUrl(selected.source), mimeType: selected.source.mimeType, width: selected.width, height: selected.height, name: selected.name, coverage });
            } catch { setError("editFailed"); }
          }} onOpenAi={() => setAiOpen(true)} />
        <section className="canvas-column">
          <div className={`canvas-surface tool-${tool}`} ref={surfaceRef} aria-label={t("canvasLabel")} tabIndex={0} onPointerLeave={() => setCursorPreview(null)}
            onPointerDown={(event) => {
              if (event.target instanceof HTMLCanvasElement) surfaceRef.current?.focus({ preventScroll: true });
            }}>
          {document.layers.length === 0 && <label className="empty-state"><strong>{t("emptyTitle")}</strong><span>{t("emptyHint")}</span>
            <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importStudioFile(file); }} /></label>}
          <Stage ref={stageRef} width={surfaceSize.width} height={surfaceSize.height}
            onPointerDown={beginPointer} onPointerMove={movePointer} onPointerUp={endPointer}
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
            <button disabled={!history.canUndo} onClick={undoDocument}>{t("undo")}</button>
            <button disabled={!history.canRedo} onClick={redoDocument}>{t("redo")}</button>
          </div>
        </section>
        <Inspector activeTab={inspectorTab} layerCount={document.layers.length} t={t} onTabChange={setInspectorTab}
          properties={<>
            {selectedRasterTooLarge && <p className="panel-empty">{t("pixelTooLarge")}</p>}
            <div className="color-parameters">
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
            </div>
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
            {pixelSelection && <div className="selection-controls">
              <span>{t("selectionReady")}</span>
              <button disabled={!selected || selected.locked || selected.type !== "raster" || selected.id !== pixelSelection.layerId}
                onClick={clearPixelSelection}>{t("clearSelectedPixels")}</button>
              <button onClick={invertPixelSelection}>{t("invertSelection")}</button>
              <button onClick={() => setPixelSelection(null)}>{t("clearSelection")}</button>
            </div>}
            {selected?.rasterMaskId && <div className="tool-parameters">
              <label className="brush-check"><input type="checkbox" checked={selected.rasterMaskInverted === true}
                onChange={(event) => commit((current) => patchLayer(current, selected.id, { rasterMaskInverted: event.target.checked || undefined }), "Invert raster mask", `mask-invert:${selected.id}`)} />{t("invertSelection")}</label>
              <label>{t("brushSize")}<output>{selected.rasterMaskFeatherPx ?? 0}px</output><input type="range" min="0" max="256" value={selected.rasterMaskFeatherPx ?? 0}
                onChange={(event) => { const value = Number(event.target.value); commit((current) => patchLayer(current, selected.id, { rasterMaskFeatherPx: value || undefined }), "Feather raster mask", `mask-feather:${selected.id}`); }} /></label>
            </div>}
            {selected?.type === "paint" && <div className="tool-parameters"><label>{t("maskLayer")}<select defaultValue="" onChange={(event) => event.target.value && commit((current) => attachPaintAsRasterMask(current, selected.id, event.target.value), "Attach paint as raster mask")}><option value="">{t("noSelection")}</option>{document.layers.filter((layer) => layer.id !== selected.id && !layer.rasterMaskId && layer.parentId === selected.parentId && layer.width === selected.width && layer.height === selected.height && ["raster", "paint", "annotation", "group"].includes(layer.type)).map((layer) => <option key={layer.id} value={layer.id}>{layer.name}</option>)}</select></label></div>}
            {tool === "text" && <AnnotationProperties element={{ ...textTemplate, fill: paintColor }} locale={locale} template
              onChange={(element) => { if (element.kind === "text") { setTextTemplate(element); setPaintColor(element.fill); } }} />}
            {tool === "shape" && <AnnotationProperties element={{ ...shapeTemplate, stroke: paintColor }} locale={locale} template
              onChange={(element) => { if (element.kind === "rect") { setShapeTemplate(element); setPaintColor(element.stroke); } }} />}
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
          } else if (outcome.kind === "bake" && adjustmentDraft.sourceLayerId && !adjustmentDraft.selection) {
            void bakeAdjustmentDraft(outcome.layer, adjustmentDraft.sourceLayerId);
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
          setAiOpen(false);
          setRecoverableOperation(null);
          const resultLayer = rasterLayerFromImage(image);
          setDocument((current) => historyRef.current.execute(current, addLayer(current, resultLayer), "Apply AI result"));
          refreshHistory((value) => value + 1);
          return resultLayer.id;
        }} />}
      {settingsOpen && <ShortcutSettingsDialog bindings={shortcutBindings} copy={fileCopy[locale]}
        labels={Object.fromEntries(SHORTCUT_ACTIONS.map((action) => [action, action === "undo" || action === "redo" || action === "fit" ? t(action) : toolLabel(action)])) as Record<ShortcutAction,string>}
        onSave={(bindings) => {setShortcutBindings(bindings);setSettingsOpen(false);}} onClose={() => setSettingsOpen(false)} />}
      {deliveryOpen && <DeliveryDialog document={document} t={t} initialFormat={deliveryFormat} copy={fileCopy[locale]} onClose={() => setDeliveryOpen(false)} />}
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
