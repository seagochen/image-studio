import { tracePath } from "./vectorPath";
import { arrowHeadPoints } from "./arrowGeometry";
import { renderText } from "./textLayout";
import type { AnnotationLayer, DrawingLayer } from "./document";
import { paintSelectionRuns } from "./selectionMaskRuns";
import { createBrushDabs, renderBrushDabs } from "./brushEngine";
import { releaseRenderCanvas } from "./renderMemory";

export function renderDrawingLayer(layer: DrawingLayer, createCanvas: (width: number, height: number) => HTMLCanvasElement, scale = 1): HTMLCanvasElement {
  const canvas = createCanvas(layer.width, layer.height);
  try {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas export is unavailable");
    context.scale(scale, scale);
    if (layer.type === "mask" && layer.selectionRuns) paintSelectionRuns(context, layer.selectionRuns, layer.width, layer.height);
    for (const stroke of layer.strokes) {
      if (!stroke.points.length) continue;
      const color = layer.type === "mask" ? `rgb(${stroke.value},${stroke.value},${stroke.value})` : stroke.color ?? "#111827";
      if (stroke.brush && stroke.samples) {
        renderBrushDabs(context, createBrushDabs(stroke.samples, stroke.size, stroke.brush), color, stroke.mode === "erase");
        continue;
      }
      context.save();
      context.globalCompositeOperation = stroke.mode === "erase" ? "destination-out" : "source-over";
      context.strokeStyle = color;
      context.lineWidth = stroke.size;
      context.lineCap = "round";
      context.lineJoin = "round";
      context.beginPath();
      context.moveTo(stroke.points[0].x, stroke.points[0].y);
      for (const point of stroke.points.slice(1)) context.lineTo(point.x, point.y);
      if (stroke.points.length === 1) context.lineTo(stroke.points[0].x + 0.01, stroke.points[0].y);
      context.stroke();
      context.restore();
    }
    return canvas;
  } catch (error) { releaseRenderCanvas(canvas); throw error; }
}

export function renderAnnotationLayer(layer: AnnotationLayer, createCanvas: (width: number, height: number) => HTMLCanvasElement, scale = 1): HTMLCanvasElement {
  const canvas = createCanvas(layer.width, layer.height);
  try {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas export is unavailable");
    context.scale(scale, scale);
    for (const element of layer.elements) {
      context.save();
      if ("stroke" in element) { context.strokeStyle = element.stroke; context.lineWidth = element.strokeWidth; context.lineCap = "round"; context.lineJoin = "round"; }
      if ("fill" in element) context.fillStyle = element.fill;
      switch (element.kind) {
        case "path": {
          tracePath(context,element);
          if(element.closed&&element.fill!=="transparent")context.fill();
          if(element.strokeWidth>0)context.stroke();
          break;
        }
        case "text": {
          context.translate(element.x, element.y);
          context.rotate(element.rotation * Math.PI / 180);
          renderText(context, element);
          break;
        }
        case "rect": {
          context.translate(element.x, element.y);
          context.rotate(element.rotation * Math.PI / 180);
          context.beginPath();
          context.roundRect ? context.roundRect(0, 0, element.width, element.height, element.cornerRadius) : context.rect(0, 0, element.width, element.height);
          if (element.fill !== "transparent") context.fill();
          if (element.strokeWidth > 0) context.stroke();
          break;
        }
        case "ellipse": {
          context.translate(element.x, element.y);
          context.rotate(element.rotation * Math.PI / 180);
          context.beginPath();
          context.ellipse(0, 0, element.radiusX, element.radiusY, 0, 0, Math.PI * 2);
          if (element.fill !== "transparent") context.fill();
          if (element.strokeWidth > 0) context.stroke();
          break;
        }
        case "polygon": {
          context.translate(element.x, element.y);
          context.rotate(element.rotation * Math.PI / 180);
          context.beginPath();
          for (let index = 0; index < element.sides; index += 1) {
            const angle = (index / element.sides) * Math.PI * 2 - Math.PI / 2;
            const point = { x: Math.cos(angle) * element.radius, y: Math.sin(angle) * element.radius };
            if (index === 0) context.moveTo(point.x, point.y); else context.lineTo(point.x, point.y);
          }
          context.closePath();
          if (element.fill !== "transparent") context.fill();
          if (element.strokeWidth > 0) context.stroke();
          break;
        }
        case "freehand":
        case "line": {
          if (element.points.length) {
            context.beginPath();
            context.moveTo(element.points[0].x, element.points[0].y);
            for (const point of element.points.slice(1)) context.lineTo(point.x, point.y);
            context.stroke();
          }
          break;
        }
        case "arrow": {
          const [start, end] = element.points;
          const [tip, left, right] = arrowHeadPoints(element);
          context.beginPath();
          context.moveTo(start.x, start.y);
          context.lineTo(end.x, end.y);
          context.stroke();
          context.beginPath();
          context.fillStyle = element.stroke;
          context.moveTo(tip.x, tip.y);
          context.lineTo(left.x, left.y);
          context.lineTo(right.x, right.y);
          context.closePath();
          context.fill();
          break;
        }
      }
      context.restore();
    }
    return canvas;
  } catch (error) { releaseRenderCanvas(canvas); throw error; }
}
