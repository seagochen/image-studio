import type { ReactElement } from "react";
import { createAnnotationLayer } from "../domain/commands";
import { createEmptyDocument, parseDocument, serializeDocument, type AnnotationArrowElement } from "../domain/document";
import { arrowHeadPoints } from "../domain/arrowGeometry";
import { renderAnnotationLayer } from "../domain/layerRasterization";
import { AnnotationNode } from "../studio/AnnotationNode";

jest.mock("react-konva", () => ({ Group: "Group", Line: "Line" }));

describe("shared arrow rendering", () => {
  it.each([1, 2, 8, 16])("keeps the same head geometry in interactive and raster rendering for width %i", (strokeWidth) => {
    for (const end of [{ x: 80, y: 0 }, { x: 0, y: -80 }, { x: -60, y: 60 }]) {
      const initial = createEmptyDocument();
      const arrow: AnnotationArrowElement = { id: "arrow", kind: "arrow", points: [{ x: 0, y: 0 }, end], stroke: "#111111", strokeWidth };
      const layer = { ...createAnnotationLayer(initial, "Arrow"), elements: [arrow] };
      const onSelect = jest.fn(), onTransform = jest.fn();
      const tree = AnnotationNode({ layer, selectable: true, onSelect, onTransform });
      const group = (tree.props.children as ReactElement[])[0];
      const [shaft, head] = group.props.children as ReactElement[];
      const headVertices = arrowHeadPoints(arrow);
      const expectedLength = Math.max(10, strokeWidth * 4);
      for (const corner of headVertices.slice(1)) expect(Math.hypot(corner.x - end.x, corner.y - end.y)).toBeCloseTo(expectedLength);
      expect(head.props.points).toEqual(headVertices.flatMap(({ x, y }) => [x, y]));
      expect(head.props.closed).toBe(true);
      expect(head.props.strokeEnabled).toBe(false);
      expect(shaft.props.lineCap).toBe("round");
      const drawn: number[][] = [];
      const context = { save() {}, restore() {}, scale() {}, beginPath() { drawn.push([]); },
        moveTo(x: number, y: number) { drawn.at(-1)!.push(x, y); },
        lineTo(x: number, y: number) { drawn.at(-1)!.push(x, y); }, closePath() {}, stroke() {}, fill() {} };
      renderAnnotationLayer(layer, (width, height) => ({ width, height, getContext: () => context }) as unknown as HTMLCanvasElement);
      expect(drawn[0]).toEqual(shaft.props.points);
      expect(drawn[1]).toEqual(head.props.points);
      const event = { cancelBubble: false };
      group.props.onClick(event);
      expect(event.cancelBubble).toBe(true);
      expect(onSelect).toHaveBeenCalledWith("arrow");
      tree.props.onTransformEnd({ target: { x: () => 2, y: () => 3, scaleX: () => 2, scaleY: () => 1, rotation: () => 45 } });
      expect(onTransform).toHaveBeenCalledWith({ x: 2, y: 3, scaleX: 2, scaleY: 1, rotation: 45 }, `transform:${layer.id}`);
      expect(parseDocument(serializeDocument({ ...initial, layers: [layer] })).layers[0]).toEqual(layer);
    }
  });
});
