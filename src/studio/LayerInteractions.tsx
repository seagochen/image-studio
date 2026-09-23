import { AnnotationNode } from "./AnnotationNode";
import { Group, Rect } from "react-konva";
import type Konva from "konva";
import type { ImageStudioLayer, LayerTransform } from "../domain/document";

interface Props {
  layers: ImageStudioLayer[];
  parentId?: string | null;
  selectable: boolean;
  onSelect: (id: string, elementId?: string) => void;
  onEdit?: (id: string, elementId: string) => void;
  onTransform: (id: string, transform: LayerTransform, mergeKey: string) => void;
}

/** Invisible hit shapes preserve editing while the compositor owns every visible pixel. */
export function LayerInteractions({ layers, parentId = null, selectable, onSelect, onEdit, onTransform }: Props): JSX.Element {
  return <>{layers.filter((layer) => (layer.parentId ?? null) === parentId && layer.visible).map((layer) => {
    if (layer.type === "adjustment") return null;
    const enabled = selectable && !layer.locked;
    const transform = (event: Konva.KonvaEventObject<Event>) => {
      if (event.target !== event.currentTarget) return;
      event.cancelBubble = true;
      const node = event.currentTarget;
      onTransform(layer.id, { x: node.x(), y: node.y(), scaleX: node.scaleX(), scaleY: node.scaleY(), rotation: node.rotation() }, `transform:${layer.id}`);
    };
    if (layer.type === "annotation") return <AnnotationNode key={layer.id} layer={layer} hitOnly selectable={enabled}
      onSelect={(elementId) => onSelect(layer.id, elementId)} onEdit={(elementId) => onEdit?.(layer.id, elementId)}
      onTransform={(value, mergeKey) => onTransform(layer.id, value, mergeKey ?? `transform:${layer.id}`)} />;
    return <Group key={layer.id} id={`node-${layer.id}`} x={layer.transform.x} y={layer.transform.y}
      scaleX={layer.transform.scaleX} scaleY={layer.transform.scaleY} rotation={layer.transform.rotation}
      draggable={enabled && layer.type !== "group"} listening={enabled}
      onClick={(event) => { event.cancelBubble = true; onSelect(layer.id); }}
      onTap={(event) => { event.cancelBubble = true; onSelect(layer.id); }}
      onDragMove={transform} onDragEnd={transform} onTransform={transform} onTransformEnd={transform}>
      {layer.type === "group" ? <LayerInteractions layers={layers} parentId={layer.id} selectable={enabled} onSelect={onSelect} onEdit={onEdit} onTransform={onTransform} />
        : <Rect width={layer.width} height={layer.height} fill="rgba(0,0,0,0)" />}
    </Group>;
  })}</>;
}
