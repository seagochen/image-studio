import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ReactElement } from "react";
import { createAnnotationLayer, createDrawingLayer, createGroupLayer } from "../domain/commands";
import { createEmptyDocument } from "../domain/document";
import { LayerInteractions } from "../studio/LayerInteractions";

jest.mock("react-konva", () => ({ Group: "Group", Rect: "Rect" }));

const onSelect = jest.fn();
const onTransform = jest.fn();

function firstHitLayer(layers: Parameters<typeof LayerInteractions>[0]["layers"], blockedTransformLayerId?: string): ReactElement {
  const tree = LayerInteractions({ layers, selectable: true, blockedTransformLayerId, onSelect, onTransform });
  return (tree.props.children as ReactElement[])[0];
}

describe("Image Studio temporary selection transform guard", () => {
  it("keeps a selected Paint layer clickable while disabling full-layer dragging", () => {
    const document = createEmptyDocument();
    const paint = createDrawingLayer(document, "paint", "Paint");
    const blocked = firstHitLayer([paint], paint.id);
    expect(blocked.props.draggable).toBe(false);
    expect(blocked.props.listening).toBe(true);
    expect(typeof blocked.props.onClick).toBe("function");
    expect(firstHitLayer([paint]).props.draggable).toBe(true);
  });

  it("blocks annotation transforms without disabling element selection", () => {
    const annotation = createAnnotationLayer(createEmptyDocument(), "Annotation");
    const blocked = firstHitLayer([annotation], annotation.id);
    expect(blocked.props.selectable).toBe(true);
    expect(blocked.props.transformable).toBe(false);
    expect(firstHitLayer([annotation]).props.transformable).toBe(true);
  });

  it("passes the blocked source through nested groups", () => {
    const document = createEmptyDocument();
    const group = createGroupLayer(document, "Group");
    const paint = { ...createDrawingLayer(document, "paint", "Nested"), parentId: group.id };
    const root = firstHitLayer([group, paint], paint.id);
    const nested = root.props.children as ReactElement;
    expect(nested.props.blockedTransformLayerId).toBe(paint.id);
    const childTree = LayerInteractions(nested.props as Parameters<typeof LayerInteractions>[0]);
    expect((childTree.props.children as ReactElement[])[0].props.draggable).toBe(false);
  });

  it("guards direct and composite commits and disables original Annotation property edits", () => {
    const studio = readFileSync(resolve(__dirname, "../studio/Studio.tsx"), "utf8");
    expect(studio).toContain("if (pixelSelection?.layerId === layerId) return;");
    expect(studio).toContain("onTransform={commitLayerTransform}");
    expect(studio).toContain("disabled={!selectedEditable || pixelSelection?.layerId === selected.id}");
    expect(studio).toContain('!selectedEditable || pixelSelection?.layerId === selected.id) return;');
  });
});
