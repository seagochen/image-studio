import { Arrow, Ellipse, Group, Line, Rect, RegularPolygon, Text } from "react-konva";
import type Konva from "konva";
import { canvasBlendMode, type AnnotationLayer } from "../domain/document";

interface Props {
  layer: AnnotationLayer;
  selectable: boolean;
  onSelect: (elementId?: string) => void;
  onEdit?: (elementId: string) => void;
  hitOnly?: boolean;
  onTransform: (transform: AnnotationLayer["transform"], mergeKey?: string) => void;
}

export function AnnotationNode({ layer, selectable, onSelect, onEdit, hitOnly, onTransform }: Props): JSX.Element {
  const commit = (node: Konva.Group, mergeKey?: string) => onTransform({
    x: node.x(), y: node.y(), scaleX: node.scaleX(), scaleY: node.scaleY(), rotation: node.rotation(),
  }, mergeKey);
  return (
    <Group id={`node-${layer.id}`} x={layer.transform.x} y={layer.transform.y}
      scaleX={layer.transform.scaleX} scaleY={layer.transform.scaleY} rotation={layer.transform.rotation}
      visible={layer.visible} opacity={hitOnly ? 0 : layer.opacity} globalCompositeOperation={canvasBlendMode(layer.blendMode)} draggable={selectable && !layer.locked}

      onDragEnd={(event) => commit(event.target as Konva.Group, `drag:${layer.id}`)}
      onTransformEnd={(event) => commit(event.target as Konva.Group, `transform:${layer.id}`)}>
      {layer.elements.map((element) => {
        const events = {
          onClick: (event: Konva.KonvaEventObject<MouseEvent>) => { event.cancelBubble = true; onSelect(element.id); },
          onTap: (event: Konva.KonvaEventObject<TouchEvent>) => { event.cancelBubble = true; onSelect(element.id); },
          onDblClick: (event: Konva.KonvaEventObject<MouseEvent>) => { event.cancelBubble = true; if (!layer.locked) onEdit?.(element.id); },
          onDblTap: (event: Konva.KonvaEventObject<TouchEvent>) => { event.cancelBubble = true; if (!layer.locked) onEdit?.(element.id); },
        };
        switch (element.kind) {
          case "text":
            return <Text key={element.id} {...events} x={element.x} y={element.y} width={element.width} rotation={element.rotation}
              text={element.text} name="annotation-text" fontFamily={element.fontFamily} fontSize={element.fontSize} fill={element.fill} align={element.align} listening={selectable} />;
          case "rect":
            return <Rect key={element.id} {...events} x={element.x} y={element.y} width={element.width} height={element.height} rotation={element.rotation}
              fill={element.fill === "transparent" ? undefined : element.fill} stroke={element.stroke} strokeWidth={element.strokeWidth}
              cornerRadius={element.cornerRadius} listening={selectable} />;
          case "ellipse":
            return <Ellipse key={element.id} {...events} x={element.x} y={element.y} radiusX={element.radiusX} radiusY={element.radiusY} rotation={element.rotation}
              fill={element.fill === "transparent" ? undefined : element.fill} stroke={element.stroke} strokeWidth={element.strokeWidth} listening={selectable} />;
          case "polygon":
            return <RegularPolygon key={element.id} {...events} x={element.x} y={element.y} sides={element.sides} radius={element.radius} rotation={element.rotation}
              fill={element.fill === "transparent" ? undefined : element.fill} stroke={element.stroke} strokeWidth={element.strokeWidth} listening={selectable} />;
          case "freehand":
            return <Line key={element.id} {...events} points={element.points.flatMap((point) => [point.x, point.y])}
              stroke={element.stroke} strokeWidth={element.strokeWidth} lineCap="round" lineJoin="round" listening={selectable} />;
          case "line":
            return <Line key={element.id} {...events} points={element.points.flatMap((point) => [point.x, point.y])}
              stroke={element.stroke} strokeWidth={element.strokeWidth} lineCap="round" listening={selectable} />;
          case "arrow":
            return <Arrow key={element.id} {...events} points={element.points.flatMap((point) => [point.x, point.y])}
              stroke={element.stroke} fill={element.stroke} strokeWidth={element.strokeWidth} listening={selectable} />;
          default:
            return null;
        }
      })}
    </Group>
  );
}
