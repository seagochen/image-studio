import { applyAiResult } from "../domain/applyAiResult";
import { createEmptyDocument } from "../domain/document";
import { rasterLayerFromImage } from "../domain/importImage";
import { DocumentHistory } from "../domain/history";
import { layerMatrix, matrixPoint } from "../domain/layerGeometry";
import { fitCanvasViewport } from "../studio/useCanvasViewport";
const image = { dataUrl: "data:image/png;base64,AA==", mimeType: "image/png", width: 160, height: 100, name: "Source" };
const source = rasterLayerFromImage(image);
const original = { ...createEmptyDocument(), canvas: { width: 160, height: 100 }, layers: [source] };

it("grows the canvas with a super-resolution result in one reversible command", () => {
  const outcome = applyAiResult(original, { ...image, width: 640, height: 400 }, source.id);
  const history = new DocumentHistory(); const next = history.execute(original, outcome.document, "AI result");
  expect(next.canvas).toEqual({ width: 640, height: 400 });
  expect(next.layers[0]).toEqual(source); expect(next.layers[1]).toMatchObject({ id: outcome.resultLayerId, width: 640, height: 400 });
  expect(history.undo(next)).toEqual(original); expect(history.redo(original)).toEqual(next);
});

it("preserves deliberately cropped canvas bounds for same-size AI edits", () => {
  const cropped = { ...original, canvas: { width: 80, height: 50 } };
  expect(applyAiResult(cropped, image, source.id).document.canvas).toEqual(cropped.canvas);
});

it("includes negative result bounds without changing relative artwork or guide positions", () => {
  const translated = { ...source, transform: { ...source.transform, x: -30, y: -20 } };
  const initial = { ...original, layers: [translated], guides: [{ id: "g", axis: "x" as const, position: 10 }] };
  const next = applyAiResult(initial, { ...image, width: 640, height: 400 }, source.id).document;
  expect(next.canvas).toEqual({ width: 640, height: 400 });
  expect(next.layers.map((layer) => layer.transform)).toEqual([{ ...source.transform }, { ...source.transform }]);
  expect(next.guides?.[0].position).toBe(40); expect(initial.layers[0].transform.x).toBe(-30);
});

it("covers rotated and scaled result corners inside the expanded canvas", () => {
  const rotated = { ...source, transform: { ...source.transform, x: 80, y: 40, rotation: 90, scaleX: 2 } };
  const next = applyAiResult({ ...original, layers: [rotated] }, { ...image, width: 640, height: 400 }, source.id).document;
  const result = next.layers[1]; const matrix = layerMatrix(next, result);
  for (const [x, y] of [[0, 0], [640, 0], [0, 400], [640, 400]]) {
    const point = matrixPoint(matrix, { x, y });
    expect(point.x).toBeGreaterThanOrEqual(-1e-8); expect(point.y).toBeGreaterThanOrEqual(-1e-8);
    expect(point.x).toBeLessThanOrEqual(next.canvas.width); expect(point.y).toBeLessThanOrEqual(next.canvas.height);
  }
});

it("rejects an oversized expansion before mutating the project", () => {
  expect(() => applyAiResult(original, { ...image, width: 16000, height: 16000 }, source.id)).toThrow("canvas size limits");
  expect(original.layers).toHaveLength(1); expect(original.canvas.width).toBe(160);
});

it("fits large canvases below the former 5% limit", () => {
  const view = fitCanvasViewport({ offsetX: -400, offsetY: 70, scale: 2, devicePixelRatio: 2 }, { width: 700, height: 400 }, { width: 16000, height: 1000 });
  expect(view.scale).toBeLessThan(.05); expect(view.offsetX).toBeGreaterThanOrEqual(0);
  expect(view.offsetX + 16000 * view.scale).toBeLessThanOrEqual(700); expect(view.devicePixelRatio).toBe(2);
});
