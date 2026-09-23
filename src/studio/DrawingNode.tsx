import { Group, Line, Rect, Shape } from "react-konva";
import type Konva from "konva";
import { createBrushDabs, renderBrushDabs } from "../domain/brushEngine";
import { canvasBlendMode, type DrawingLayer } from "../domain/document";

interface Props {
  layer: DrawingLayer;
  selectable: boolean;
  onSelect: () => void;
  onTransform: (transform: DrawingLayer["transform"], mergeKey?: string) => void;
}

export function DrawingNode({ layer, selectable, onSelect, onTransform }: Props): JSX.Element {
  const commit = (node: Konva.Group, mergeKey?: string) => onTransform({
    x: node.x(), y: node.y(), scaleX: node.scaleX(), scaleY: node.scaleY(), rotation: node.rotation(),
  }, mergeKey);
  return (
    <Group id={`node-${layer.id}`} x={layer.transform.x} y={layer.transform.y}
      scaleX={layer.transform.scaleX} scaleY={layer.transform.scaleY} rotation={layer.transform.rotation}
      visible={layer.visible} opacity={layer.opacity} globalCompositeOperation={canvasBlendMode(layer.blendMode)} draggable={selectable && !layer.locked}
      onClick={onSelect} onTap={onSelect}
      onDragEnd={(event) => commit(event.target as Konva.Group, `drag:${layer.id}`)}
      onTransformEnd={(event) => commit(event.target as Konva.Group, `transform:${layer.id}`)}>
      <Rect width={layer.width} height={layer.height} fill="rgba(0,0,0,0.001)" />
      {layer.strokes.map((stroke) => stroke.brush && stroke.samples ? (
        <Shape key={stroke.id} listening={false} sceneFunc={(context) => {
          renderBrushDabs(context._context, createBrushDabs(stroke.samples ?? [], stroke.size, stroke.brush!),
            layer.type === "mask" ? `rgb(${stroke.value},${stroke.value},${stroke.value})` : stroke.color ?? "#111827", stroke.mode === "erase");
        }} />
      ) : (
        <Line key={stroke.id} points={stroke.points.flatMap((point) => [point.x, point.y])}
          stroke={layer.type === "mask" ? `rgb(${stroke.value},${stroke.value},${stroke.value})` : stroke.color ?? "#111827"}
          strokeWidth={stroke.size} lineCap="round" lineJoin="round"
          globalCompositeOperation={stroke.mode === "erase" ? "destination-out" : "source-over"} listening={false} />
      ))}
    </Group>
  );
}
