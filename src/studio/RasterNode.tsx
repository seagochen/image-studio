import { useEffect, useState } from "react";
import { Group, Image as KonvaImage } from "react-konva";
import type Konva from "konva";
import { canvasBlendMode, rasterSourceUrl, type RasterLayer } from "../domain/document";

interface Props {
  layer: RasterLayer;
  selectable: boolean;
  onSelect: () => void;
  onTransform: (transform: RasterLayer["transform"], mergeKey?: string) => void;
}

export function RasterNode({ layer, selectable, onSelect, onTransform }: Props): JSX.Element {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    const element = new window.Image();
    element.onload = () => setImage(element);
    element.src = rasterSourceUrl(layer.source);
    return () => { element.onload = null; };
  }, [layer.source]);

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
      <KonvaImage image={image ?? undefined} width={layer.width} height={layer.height} listening={selectable} />
    </Group>
  );
}
