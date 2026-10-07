import { AnnotationNode } from "./AnnotationNode";
import { adjacentMaskLayerIds } from "../domain/adjustmentMasking";
import { Group, Rect } from "react-konva";
import type Konva from "konva";
import type { ImageStudioLayer, LayerTransform } from "../domain/document";

interface Props {
  layers: ImageStudioLayer[];
  parentId?: string | null;
  selectable: boolean;
  onSelect: (id: string, elementId?: string) => void;
  blockedTransformLayerId?: string | null;
  onEdit?: (id: string, elementId: string) => void;
  onTransform: (id: string, transform: LayerTransform, mergeKey: string) => void;
}

/** Invisible hit shapes preserve editing while the compositor owns every visible pixel. */
export function LayerInteractions({ layers, parentId = null, selectable, blockedTransformLayerId, onSelect, onEdit, onTransform }: Props): JSX.Element {
  const consumedMasks = new Set(layers.flatMap((layer) => layer.rasterMaskId ? [layer.rasterMaskId]
    : layer.type === "adjustment" ? adjacentMaskLayerIds(layers, layer) : []));
  return <>{layers.filter((layer) => (layer.parentId ?? null) === parentId && layer.visible
    && !(layer.type === "mask" && consumedMasks.has(layer.id))).map((layer) => {
    if (layer.type === "adjustment") return null;
    const enabled = selectable && !layer.locked;
    const transformable = layer.id !== blockedTransformLayerId;
    const transform = (event: Konva.KonvaEventObject<Event>) => {
      if (event.target !== event.currentTarget) return;
      event.cancelBubble = true;
      const node = event.currentTarget;
      onTransform(layer.id, { x: node.x(), y: node.y(), scaleX: node.scaleX(), scaleY: node.scaleY(), rotation: node.rotation() }, `${event.type.startsWith("drag") ? "drag" : "transform"}:${layer.id}`);
    };
    if (layer.type === "annotation") return <AnnotationNode key={layer.id} layer={layer} hitOnly selectable={enabled} transformable={transformable}
      onSelect={(elementId) => onSelect(layer.id, elementId)} onEdit={(elementId) => onEdit?.(layer.id, elementId)}
      onTransform={(value, mergeKey) => onTransform(layer.id, value, mergeKey ?? `transform:${layer.id}`)} />;
    return <Group key={layer.id} id={`node-${layer.id}`} x={layer.transform.x} y={layer.transform.y}
      scaleX={layer.transform.scaleX} scaleY={layer.transform.scaleY} rotation={layer.transform.rotation}
      draggable={enabled && transformable && layer.type !== "group"} listening={enabled}
      onClick={(event) => { event.cancelBubble = true; onSelect(layer.id); }}
      onTap={(event) => { event.cancelBubble = true; onSelect(layer.id); }}
      onDragMove={transform} onDragEnd={transform} onTransform={transform} onTransformEnd={transform}>
      {layer.type === "group" ? <LayerInteractions layers={layers} parentId={layer.id} selectable={enabled} blockedTransformLayerId={blockedTransformLayerId} onSelect={onSelect} onEdit={onEdit} onTransform={onTransform} />
        : <Rect width={layer.width} height={layer.height} fill="rgba(0,0,0,0)" />}
    </Group>;
  })}</>;
}
