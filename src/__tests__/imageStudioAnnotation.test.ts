import {
  createArrowElement, createEllipseElement, createFreehandElement, createLineElement,
  createPolygonElement, createRectElement, createStarElement, createTextElement, duplicateAnnotationElement,
} from "../domain/annotation";
import { createAnnotationLayer, setAnnotationElements } from "../domain/commands";
import {
  createEmptyDocument, parseDocument, serializeDocument, type AnnotationElement, type AnnotationLayer,
} from "../domain/document";

function oneOfEachElement(): AnnotationElement[] {
  return [
    { id: "e-text", kind: "text", x: 10, y: 10, width: 200, rotation: 0, text: "Hello", fontFamily: "Arial", fontSize: 32, fill: "#172033", align: "left" },
    { id: "e-rect", kind: "rect", x: 0, y: 0, width: 40, height: 30, rotation: 15, fill: "#5f6fed", stroke: "#5f6fed", strokeWidth: 3, cornerRadius: 4 },
    { id: "e-ellipse", kind: "ellipse", x: 60, y: 60, radiusX: 20, radiusY: 10, rotation: 0, fill: "transparent", stroke: "#111827", strokeWidth: 2 },
    { id: "e-polygon", kind: "polygon", x: 100, y: 100, sides: 6, radius: 25, rotation: 0, fill: "transparent", stroke: "#111827", strokeWidth: 2 },
    { id: "e-freehand", kind: "freehand", points: [{ x: 0, y: 0 }, { x: 5, y: 5 }], stroke: "#5f6fed", strokeWidth: 4 },
    { id: "e-line", kind: "line", points: [{ x: 0, y: 0 }, { x: 10, y: 0 }], stroke: "#5f6fed", strokeWidth: 2 },
    { id: "e-arrow", kind: "arrow", points: [{ x: 0, y: 0 }, { x: 10, y: 10 }], stroke: "#5f6fed", strokeWidth: 2 },
  ];
}

describe("annotation element factories", () => {
  it("normalizes a rect drag regardless of drag direction and rejects sub-minimum drags", () => {
    const element = createRectElement({ x: 40, y: 30 }, { x: 10, y: 5 });
    expect(element).toMatchObject({ kind: "rect", x: 10, y: 5, width: 30, height: 25 });
    expect(createRectElement({ x: 0, y: 0 }, { x: 1, y: 1 })).toBeNull();
  });

  it("computes an ellipse from the drag bounding box center and half-extents", () => {
    const element = createEllipseElement({ x: 0, y: 0 }, { x: 40, y: 20 });
    expect(element).toMatchObject({ kind: "ellipse", x: 20, y: 10, radiusX: 20, radiusY: 10 });
  });

  it("computes a polygon radius from the center-to-edge distance and keeps the requested side count", () => {
    const element = createPolygonElement({ x: 0, y: 0 }, { x: 30, y: 40 }, 6);
    expect(element).toMatchObject({ kind: "polygon", x: 0, y: 0, radius: 50, sides: 6 });
    expect(createPolygonElement({ x: 0, y: 0 }, { x: 1, y: 1 }, 5)).toBeNull();
  });

  it("builds line and arrow elements from two points and rejects near-zero-length drags", () => {
    expect(createLineElement({ x: 0, y: 0 }, { x: 10, y: 0 })).toMatchObject({ kind: "line", points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] });
    expect(createArrowElement({ x: 0, y: 0 }, { x: 10, y: 0 })).toMatchObject({ kind: "arrow", points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] });
    expect(createLineElement({ x: 0, y: 0 }, { x: 1, y: 0 })).toBeNull();
  });

  it("keeps a freehand path only when it has at least two points", () => {
    expect(createFreehandElement([{ x: 0, y: 0 }])).toBeNull();
    expect(createFreehandElement([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toMatchObject({ kind: "freehand" });
  });

  it("creates a closed ten-segment star path and rejects a click without a drag", () => {
    const star = createStarElement({ x: 50, y: 50 }, { x: 50, y: 10 });
    expect(star).toMatchObject({ kind: "freehand" });
    if (star?.kind === "freehand") {
      expect(star.points).toHaveLength(11);
      expect(star.points[0]).toEqual(star.points.at(-1));
    }
    expect(createStarElement({ x: 0, y: 0 }, { x: 1, y: 1 })).toBeNull();
  });

  it("creates an empty, sensibly defaulted text box at the click point", () => {
    const element = createTextElement({ x: 5, y: 6 });
    expect(element).toMatchObject({ kind: "text", x: 5, y: 6, text: "", align: "left" });
  });

  it("duplicates an element with a new id, offsetting both point-based and x/y-based geometry", () => {
    const rect = createRectElement({ x: 0, y: 0 }, { x: 40, y: 40 })!;
    const rectCopy = duplicateAnnotationElement(rect);
    expect(rectCopy.id).not.toBe(rect.id);
    expect(rectCopy).toMatchObject({ x: 16, y: 16, width: 40, height: 40 });

    const arrow = createArrowElement({ x: 0, y: 0 }, { x: 10, y: 10 })!;
    const arrowCopy = duplicateAnnotationElement(arrow);
    expect(arrowCopy.id).not.toBe(arrow.id);
    expect(arrowCopy).toMatchObject({ points: [{ x: 16, y: 16 }, { x: 26, y: 26 }] });
  });
});

describe("annotation layer commands", () => {
  it("creates an annotation layer sized to the document canvas with no elements", () => {
    const document = createEmptyDocument();
    const layer = createAnnotationLayer(document, "Text & shapes");
    expect(layer).toMatchObject({ type: "annotation", width: document.canvas.width, height: document.canvas.height, elements: [] });
  });

  it("replaces an annotation layer's elements and refuses missing, non-annotation or locked layers", () => {
    const initial = createEmptyDocument();
    const layer = createAnnotationLayer(initial, "Layer");
    const withLayer = { ...initial, layers: [layer] };
    const elements = oneOfEachElement();
    const updated = setAnnotationElements(withLayer, layer.id, elements);
    expect((updated.layers[0] as AnnotationLayer).elements).toEqual(elements);
    expect(setAnnotationElements(withLayer, "missing", elements)).toBe(withLayer);
    const locked = { ...withLayer, layers: [{ ...layer, locked: true }] };
    expect(setAnnotationElements(locked, layer.id, elements)).toBe(locked);
  });
});

describe("annotation layer schema", () => {
  it("round-trips a document containing one of every annotation element kind", () => {
    const initial = createEmptyDocument();
    const layer = { ...createAnnotationLayer(initial, "Layer"), elements: oneOfEachElement() };
    const document = { ...initial, layers: [layer] };
    const parsed = parseDocument(serializeDocument(document));
    expect(parsed).toEqual(document);
  });

  it("rejects malformed annotation elements", () => {
    const initial = createEmptyDocument();
    const base = createAnnotationLayer(initial, "Layer");
    const withElements = (elements: AnnotationElement[]) => serializeDocument({ ...initial, layers: [{ ...base, elements }] });
    expect(() => parseDocument(withElements([{ id: "t", kind: "text", x: 0, y: 0, width: 10, rotation: 0, text: "hi", fontFamily: "Arial", fontSize: 12, fill: "not-a-color", align: "left" } as AnnotationElement])))
      .toThrow("text");
    expect(() => parseDocument(withElements([{ id: "p", kind: "polygon", x: 0, y: 0, sides: 2, radius: 10, rotation: 0, fill: "transparent", stroke: "#000000", strokeWidth: 1 } as AnnotationElement])))
      .toThrow("polygon");
    expect(() => parseDocument(withElements([{ id: "l", kind: "line", points: [{ x: 0, y: 0 }], stroke: "#000000", strokeWidth: 1 } as unknown as AnnotationElement])))
      .toThrow("line");
  });
});
