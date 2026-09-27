import React, { act, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import type Konva from "konva";
import { addLayer, createDrawingLayer } from "../domain/commands";
import { createTextElement, createRectElement } from "../domain/annotation";
import { createEmptyDocument, parseDocument, serializeDocument, type AnnotationRectElement, type AnnotationTextElement, type ImageStudioDocument } from "../domain/document";
import { useRasterToolSession, type UseRasterToolSessionResult } from "../studio/useRasterToolSession";
import type { Tool } from "../studio/tools";

describe("Image Studio selected Paint pointer session", () => {
  it("commits selected Paint and Annotation edits as independent masked layers", async () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    (globalThis as any).HTMLIFrameElement = document.defaultView!.HTMLIFrameElement;
    (globalThis as any).addEventListener = document.defaultView!.addEventListener.bind(document.defaultView);
    (globalThis as any).removeEventListener = document.defaultView!.removeEventListener.bind(document.defaultView);
    const host = document.createElement("div");
    document.body.append(host);
    const root: Root = createRoot(host);
    const initial = { ...createEmptyDocument(), canvas: { width: 4, height: 1 } };
    const source = { ...createDrawingLayer(initial, "paint", "Editable source"), width: 4, height: 1 };
    const startingDocument = addLayer(initial, source);
    let pointer = { x: 1, y: 0 };
    const fakeStage = { getPointerPosition: () => pointer, content: {} } as unknown as Konva.Stage;
    let session!: UseRasterToolSessionResult;
    let setActiveTool!: React.Dispatch<React.SetStateAction<Tool>>;
    let currentDocument!: ImageStudioDocument;

    function Harness() {
      const [studioDocument, setStudioDocument] = useState(startingDocument);
      const [tool, setTool] = useState<Tool>("marquee");
      const [viewport, setViewport] = useState({ offsetX: 0, offsetY: 0, scale: 1, devicePixelRatio: 1 });
      const stageRef = useRef(fakeStage);
      const selected = studioDocument.layers.find((layer) => layer.id === studioDocument.selection.layerId) ?? null;
      currentDocument = studioDocument;
      setActiveTool = setTool;
      session = useRasterToolSession({
        tool, document: studioDocument, selected, selectedEditable: true, selectedRasterTooLarge: false,
        viewport, setViewport, stageRef,
        commit: (recipe) => setStudioDocument((current) => recipe(current)),
        commitPixel: () => undefined, canRecordPixel: () => true, canRecordPixelLift: () => true, canRecordPixelBytes: () => true,
        brushSettings: studioDocument.brushSettings, brushSize: 1, paintColor: "#ff0000", changePaintColor: () => undefined,
        maskValue: 255, magicTolerance: 0, selectionOperation: "replace", smudgeStrength: 1, pixelOpacity: 1,
        gradientTransparent: false, gradientEndColor: "#000000", shapeTool: "rect",
        textTemplate: createTextElement({ x: 0, y: 0 }) as AnnotationTextElement,
        shapeTemplate: createRectElement({ x: 0, y: 0 }, { x: 1, y: 1 }) as AnnotationRectElement, locale: "en",
        setError: () => undefined, setTool, setInspectorTab: () => undefined,
        setSelectedElementId: () => undefined, setTextFocusRequest: () => undefined,
      });
      return null;
    }

    try {
      act(() => root.render(<Harness />));
      act(() => session.beginPointer());
      pointer = { x: 2, y: 0 };
      act(() => { session.movePointer(); session.endPointer(); });
      expect([...session.pixelSelection!.pixels]).toEqual([0, 1, 1, 0]);

      act(() => setActiveTool("brush"));
      pointer = { x: 1, y: 0 };
      act(() => session.beginPointer());
      act(() => session.endPointer());
      expect(currentDocument.layers).toHaveLength(3);
      expect(currentDocument.layers[0]).toEqual(source);
      const local = currentDocument.layers.find((layer) => layer.id === currentDocument.selection.layerId)!;
      const mask = currentDocument.layers.find((layer) => layer.id === local.rasterMaskId)!;
      expect(local).toMatchObject({ type: "paint", strokes: [expect.objectContaining({ color: "#ff0000" })] });
      expect(mask).toMatchObject({ type: "mask", selectionRuns: [1, 2, 1] });
      expect(session.pixelSelection).toBeNull();

      act(() => setActiveTool("marquee"));
      act(() => session.beginPointer());
      pointer = { x: 2, y: 0 };
      act(() => { session.movePointer(); session.endPointer(); });
      act(() => setActiveTool("text"));
      pointer = { x: 1, y: 0 };
      act(() => { session.beginPointer(); session.endPointer(); });
      const annotation = currentDocument.layers.find((layer) => layer.type === "annotation")!;
      const annotationMask = currentDocument.layers.find((layer) => layer.id === annotation.rasterMaskId)!;
      expect(annotationMask).toMatchObject({ type: "mask", selectionRuns: [1, 2, 1] });
      expect(parseDocument(serializeDocument(currentDocument)).layers).toHaveLength(5);
    } finally {
      act(() => root.unmount());
      host.remove();
    }
  });
});
