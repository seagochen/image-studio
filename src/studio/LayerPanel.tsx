import { useEffect, useMemo, useState } from "react";
import type { Locale, MessageKey } from "../i18n";
import {
  canGroupLayers, canUngroupLayer, deleteLayer, groupLayers, patchLayer, reorderLayer, ungroupLayer, type LayerDropPosition,
} from "../domain/commands";
import { LAYER_BLEND_MODES, type AdjustmentKind, type ImageStudioDocument, type ImageStudioLayer, type LayerBlendMode } from "../domain/document";
import { planLayerMerge } from "../domain/layerMerge";
import { LAYER_UI } from "./brushLayerLabels";
import { ProductIcon } from "./ProductIcon";
import { LayerStateToggles } from "./LayerStateToggles";
import { AdjustmentMenu } from "./AdjustmentMenu";
import { ADJUSTMENT_KIND_LABELS } from "./AdjustmentPanel";
import { NewLayerMenu } from "./NewLayerMenu";

type Commit = (recipe: (current: ImageStudioDocument) => ImageStudioDocument, label: string, mergeKey?: string) => void;

interface Props {
  document: ImageStudioDocument;
  selected: ImageStudioLayer | null;
  locale: Locale;
  t: (key: MessageKey) => string;
  commit: Commit;
  onSelectLayer: (layerId: string) => void;
  onMergeLayer: (layerId: string, direction: -1 | 1) => void;
  onAddPaint: () => void;
  onAddMask: () => void;
  onCreateAdjustment: (kind: AdjustmentKind) => void;
  onDuplicate: () => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
}

export function LayerPanel(props: Props): JSX.Element {
  const { document, selected, locale, t, commit } = props;
  const [draggedLayerId, setDraggedLayerId] = useState<string | null>(null);
  const [layerDrop, setLayerDrop] = useState<{ targetId: string; position: LayerDropPosition } | null>(null);
  const [multiSelectedIds, setMultiSelectedIds] = useState<string[]>([]);
  const displayLayers = useMemo(() => layerRows(document.layers), [document.layers]);
  const canGroupMultiSelection = multiSelectedIds.length >= 2 && canGroupLayers(document, multiSelectedIds);

  useEffect(() => {
    setMultiSelectedIds((ids) => {
      const next = ids.filter((id) => document.layers.some((layer) => layer.id === id));
      return next.length === ids.length ? ids : next;
    });
  }, [document.layers]);

  return <>
    {selected ? <div className="layer-controls">
      <label className="layer-name-field">{t("name")}<input value={selected.name} onChange={(event) => commit((current) => patchLayer(current, selected.id, { name: event.target.value }), "Rename layer", `name:${selected.id}`)} /></label>
      <label>{t("blendMode")}<select value={selected.blendMode} onChange={(event) => commit((current) => patchLayer(current, selected.id, { blendMode: event.target.value as LayerBlendMode }), "Change blend mode")}>
        {LAYER_BLEND_MODES.map((mode) => <option key={mode} value={mode}>{t(`blend${mode[0].toUpperCase()}${mode.slice(1)}` as MessageKey)}</option>)}</select></label>
      <label>{t("opacity")}<output>{Math.round(selected.opacity * 100)}%</output><input type="range" min="0" max="1" step="0.01" value={selected.opacity} onChange={(event) => commit((current) => patchLayer(current, selected.id, { opacity: Number(event.target.value) }), "Change opacity", `opacity:${selected.id}`)} /></label>
      <div className="layer-toggle-row"><LayerStateToggles visible={selected.visible} locked={selected.locked} t={t}
        onVisibilityChange={() => commit((current) => patchLayer(current, selected.id, { visible: !selected.visible }), "Toggle visibility")}
        onLockChange={() => commit((current) => patchLayer(current, selected.id, { locked: !selected.locked }), "Toggle lock")} /></div>
    </div> : <p className="panel-empty">{t("noSelection")}</p>}
    <div className="layer-list">{displayLayers.map(({ layer, depth }) => {
      const groupedWithSelection = multiSelectedIds.length >= 2 && multiSelectedIds.includes(layer.id);
      const neighbor = groupableNeighbor(document.layers, layer);
      const groupDisabled = layer.locked || (groupedWithSelection ? !canGroupMultiSelection : !neighbor || !canGroupLayers(document, [neighbor.id, layer.id]));
      return <div key={layer.id} className={`layer-row ${selected?.id === layer.id ? "selected" : ""} ${multiSelectedIds.includes(layer.id) ? "multi-selected" : ""} ${layerDrop?.targetId === layer.id ? `drop-${visualLayerDropPosition(layerDrop.position)}` : ""}`} draggable={!layer.locked}
        onDragStart={() => { setDraggedLayerId(layer.id); setLayerDrop(null); }} onDragEnd={() => { setDraggedLayerId(null); setLayerDrop(null); }}
        onDragOver={(event) => { event.preventDefault(); if (draggedLayerId && draggedLayerId !== layer.id) setLayerDrop({ targetId: layer.id, position: layerDropPosition(event.clientY, event.currentTarget.getBoundingClientRect(), layer.type === "group") }); }}
        onDrop={(event) => { event.preventDefault(); if (!draggedLayerId || draggedLayerId === layer.id) return; const position = layerDrop?.targetId === layer.id ? layerDrop.position : layerDropPosition(event.clientY, event.currentTarget.getBoundingClientRect(), layer.type === "group"); commit((current) => reorderLayer(current, draggedLayerId, layer.id, position), "Reorder layer"); setDraggedLayerId(null); setLayerDrop(null); }}>
        <LayerStateToggles visible={layer.visible} locked={layer.locked} t={t} variant="row"
          onVisibilityChange={() => commit((current) => patchLayer(current, layer.id, { visible: !layer.visible }), "Toggle visibility")}
          onLockChange={() => commit((current) => patchLayer(current, layer.id, { locked: !layer.locked }), "Toggle lock")} />
        <button className="layer-select" onClick={(event) => {
          if (event.shiftKey && selected && displayLayers.some(({ layer: candidate }) => candidate.id === selected.id)) {
            const ids = displayLayers.map(({ layer: candidate }) => candidate.id); const anchor = ids.indexOf(selected.id); const target = ids.indexOf(layer.id); const [from, to] = anchor < target ? [anchor, target] : [target, anchor]; setMultiSelectedIds(ids.slice(from, to + 1)); props.onSelectLayer(layer.id); return;
          }
          if (event.ctrlKey || event.metaKey) { setMultiSelectedIds((current) => { const base = current.length ? current : selected ? [selected.id] : []; return base.includes(layer.id) ? base.filter((id) => id !== layer.id) : [...base, layer.id]; }); props.onSelectLayer(layer.id); return; }
          setMultiSelectedIds([]); props.onSelectLayer(layer.id);
        }} onDoubleClick={() => layer.type === "group" && commit((current) => patchLayer(current, layer.id, { collapsed: !layer.collapsed }), "Toggle group")} style={{ paddingInlineStart: 8 + depth * 16 }}>
          <span>{layer.type === "group" && <ProductIcon name={layer.collapsed ? "chevron-right" : "chevron-down"} />}</span><span className="layer-name">{layer.name}</span><small>{layer.type}</small>
        </button>
        <details className="layer-row-menu"><summary aria-label={LAYER_UI[locale].menu}><ProductIcon name="more" /></summary><div>
          <button onClick={() => { const name = window.prompt(LAYER_UI[locale].rename, layer.name); if (name?.trim()) commit((current) => patchLayer(current, layer.id, { name: name.trim() }), "Rename layer"); }}>{LAYER_UI[locale].rename}</button>
          <button disabled={!planLayerMerge(document, layer.id, 1)} title={LAYER_UI[locale].mergeHelp} onClick={() => props.onMergeLayer(layer.id, 1)}>{LAYER_UI[locale].mergeUp}</button>
          <button disabled={!planLayerMerge(document, layer.id, -1)} title={LAYER_UI[locale].mergeHelp} onClick={() => props.onMergeLayer(layer.id, -1)}>{LAYER_UI[locale].mergeDown}</button>
          <button disabled={groupDisabled} title={LAYER_UI[locale].groupHelp} onClick={() => commit((current) => { if (groupedWithSelection) { const grouped = groupLayers(current, multiSelectedIds, LAYER_UI[locale].groupName); if (grouped !== current) setMultiSelectedIds([]); return grouped; } const siblings = current.layers.filter((candidate) => (candidate.parentId ?? null) === (layer.parentId ?? null)); const index = siblings.findIndex((candidate) => candidate.id === layer.id); const neighbor = siblings[index - 1] ?? siblings[index + 1]; return neighbor ? groupLayers(current, [neighbor.id, layer.id], LAYER_UI[locale].groupName) : current; }, "Group layers")}>{LAYER_UI[locale].group}</button>
          <button disabled={!canUngroupLayer(document, layer.id)} onClick={() => commit((current) => ungroupLayer(current, layer.id), "Ungroup layers")}>{LAYER_UI[locale].ungroup}</button>
          <button className="danger" disabled={layer.locked} onClick={() => commit((current) => deleteLayer(current, layer.id), "Delete layer")}>{t("remove")}</button>
        </div></details>
      </div>;
    })}</div>
    <div className="layer-actions" role="toolbar" aria-label={t("layerActions")}>
      <NewLayerMenu disabled={!document.layers.length} label={t("newLayer")} paintLabel={t("newPaintLayer")} maskLabel={t("newMaskLayer")}
        onCreatePaint={props.onAddPaint} onCreateMask={props.onAddMask} />
      <AdjustmentMenu disabled={!document.layers.length} label={t("adjustLayer")} labels={ADJUSTMENT_KIND_LABELS[locale]} onSelect={props.onCreateAdjustment} />
      <button disabled={!selected} title={t("duplicate")} aria-label={t("duplicate")} onClick={props.onDuplicate}><ProductIcon name="duplicate" /></button>
      <button disabled={!selected} title={t("up")} aria-label={t("up")} onClick={() => props.onMove(1)}><ProductIcon name="layer-up" /></button>
      <button disabled={!selected} title={t("down")} aria-label={t("down")} onClick={() => props.onMove(-1)}><ProductIcon name="layer-down" /></button>
      <button className="danger" disabled={!selected || selected.locked} title={t("remove")} aria-label={t("remove")} onClick={props.onRemove}><ProductIcon name="trash" /></button>
    </div>
  </>;
}

function layerRows(layers: ImageStudioLayer[], parentId: string | null = null, depth = 0): Array<{ layer: ImageStudioLayer; depth: number }> {
  const siblings = layers.filter((layer) => (layer.parentId ?? null) === parentId).reverse();
  return siblings.flatMap((layer) => layer.type === "group" && !layer.collapsed ? [{ layer, depth }, ...layerRows(layers, layer.id, depth + 1)] : [{ layer, depth }]);
}

function layerDropPosition(pointerY: number, bounds: DOMRect, group: boolean): LayerDropPosition {
  const progress = bounds.height > 0 ? (pointerY - bounds.top) / bounds.height : .5;
  if (group && progress >= .25 && progress <= .75) return "inside";
  return progress < .5 ? "after" : "before";
}

function visualLayerDropPosition(position: LayerDropPosition): LayerDropPosition {
  return position === "before" ? "after" : position === "after" ? "before" : "inside";
}

function groupableNeighbor(layers: ImageStudioLayer[], layer: ImageStudioLayer): ImageStudioLayer | undefined {
  const siblings = layers.filter((candidate) => (candidate.parentId ?? null) === (layer.parentId ?? null));
  const index = siblings.findIndex((candidate) => candidate.id === layer.id);
  return siblings[index - 1] ?? siblings[index + 1];
}
