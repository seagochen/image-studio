import { setLayerTransform } from "./commands";
import { touchDocument, type ImageStudioDocument, type ImageStudioLayer, type LayerTransform } from "./document";
import { layerIsEditable } from "./layerHierarchy";
export type Alignment = "left" | "center" | "right" | "top" | "middle" | "bottom" | "horizontal" | "vertical";
export function layerBounds(layer: ImageStudioLayer, transform = layer.transform) {
    const angle = transform.rotation * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
    const points = [[0, 0], [layer.width, 0], [0, layer.height], [layer.width, layer.height]].map(([x, y]) => ({ x: transform.x + x * transform.scaleX * c - y * transform.scaleY * s, y: transform.y + x * transform.scaleX * s + y * transform.scaleY * c }));
    const left = Math.min(...points.map(p => p.x)), top = Math.min(...points.map(p => p.y));
    const right = Math.max(...points.map(p => p.x)), bottom = Math.max(...points.map(p => p.y));
    return { left, top, right, bottom, width: right - left, height: bottom - top };
}
export function alignLayers(document: ImageStudioDocument, ids: readonly string[], mode: Alignment): ImageStudioDocument {
    const layers = document.layers.filter(l => ids.includes(l.id) && l.type !== "mask" && l.type !== "adjustment");
    if (!layers.length || layers.some(l => !layerIsEditable(document.layers, l.id) || (l.parentId ?? null) !== (layers[0].parentId ?? null)))
        return document;
    const boxes = layers.map(l => ({ layer: l, box: layerBounds(l) }));
    const horizontal = ["left", "center", "right", "horizontal"].includes(mode);
    const start = horizontal ? "left" : "top", end = horizontal ? "right" : "bottom", dimension = horizontal ? "width" : "height";
    const min = layers.length === 1 && !layers[0].parentId ? 0 : Math.min(...boxes.map(b => b.box[start]));
    const max = layers.length === 1 && !layers[0].parentId ? (horizontal ? document.canvas.width : document.canvas.height) : Math.max(...boxes.map(b => b.box[end]));
    const distributed = mode === "horizontal" || mode === "vertical";
    if (distributed && layers.length < 3)
        return document;
    const sorted = [...boxes].sort((a, b) => a.box[start] - b.box[start]);
    const gap = (max - min - sorted.reduce((sum, b) => sum + b.box[dimension], 0)) / (sorted.length - 1);
    let cursor = min, result = document;
    for (const { layer, box } of sorted) {
        const target = distributed ? cursor : ["left", "top"].includes(mode) ? min : ["right", "bottom"].includes(mode) ? max - box[dimension] : (min + max - box[dimension]) / 2;
        const delta = target - box[start];
        if (Math.abs(delta) > 1e-8)
            result = setLayerTransform(result, layer.id, { ...layer.transform, [horizontal ? "x" : "y"]: layer.transform[horizontal ? "x" : "y"] + delta });
        cursor += box[dimension] + gap;
    }
    return result;
}
export function snapLayer(document: ImageStudioDocument, layerId: string, transform: LayerTransform, tolerance: number, gridSpacing?: number): LayerTransform {
    const layer = document.layers.find(l => l.id === layerId);
    if (!layer || layer.parentId)
        return transform;
    const b = layerBounds(layer, transform);
    const nearest = (values: number[]) => values.reduce((best, n) => Math.abs(n) < Math.abs(best) ? n : best, Infinity);
    const targetsX = [0, document.canvas.width/2, document.canvas.width], targetsY = [0, document.canvas.height/2, document.canvas.height];
    for(const guide of document.guides??[]) (guide.axis==="x"?targetsX:targetsY).push(guide.position);
    for(const other of document.layers) {
      if(other.id===layerId||other.parentId||!other.visible||other.type==="mask"||other.type==="adjustment")continue;
      const bounds=layerBounds(other);targetsX.push(bounds.left,bounds.right,(bounds.left+bounds.right)/2);targetsY.push(bounds.top,bounds.bottom,(bounds.top+bounds.bottom)/2);
    }
    const anchorsX=[b.left,b.right,(b.left+b.right)/2],anchorsY=[b.top,b.bottom,(b.top+b.bottom)/2];
    const gridTargets=(anchors:number[])=>gridSpacing&&gridSpacing>=1?anchors.map(value=>Math.round(value/gridSpacing)*gridSpacing):[];
    const dx=nearest([...targetsX,...gridTargets(anchorsX)].flatMap(target=>anchorsX.map(anchor=>target-anchor)));
    const dy=nearest([...targetsY,...gridTargets(anchorsY)].flatMap(target=>anchorsY.map(anchor=>target-anchor)));
    return { ...transform, x: transform.x + (Math.abs(dx) <= tolerance ? dx : 0), y: transform.y + (Math.abs(dy) <= tolerance ? dy : 0) };
}
export function cropCanvas(document: ImageStudioDocument, rect: {
    x: number;
    y: number;
    width: number;
    height: number;
}): ImageStudioDocument {
    if (!Object.values(rect).every(Number.isInteger) || rect.x < 0 || rect.y < 0 || rect.width < 1 || rect.height < 1 || rect.x + rect.width > document.canvas.width || rect.y + rect.height > document.canvas.height)
        return document;
    if (!rect.x && !rect.y && rect.width === document.canvas.width && rect.height === document.canvas.height)
        return document;
    return touchDocument({ ...document, ...(document.guides?{guides:document.guides.map(guide=>({...guide,position:guide.position-(guide.axis==="x"?rect.x:rect.y)}))}:{}), canvas: { width: rect.width, height: rect.height }, selection: { layerId: document.selection.layerId }, layers: document.layers.map(l => l.parentId ? l : { ...l, transform: { ...l.transform, x: l.transform.x - rect.x, y: l.transform.y - rect.y } }) });
}
