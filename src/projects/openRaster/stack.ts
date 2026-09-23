import { createEmptyDocument, createId, defaultTransform, parseDocument, type ImageStudioDocument, type ImageStudioLayer, type LayerBlendMode } from "../../domain/document";
import { validateImageDimensions } from "../../domain/importImage";
const validOutputSize = (width: number, height: number) => Number.isInteger(width) && Number.isInteger(height) && !validateImageDimensions(width,height);
import { bytesText, safeArchivePath } from "./archive";

export const ORA_MAX_PIXELS = 64_000_000;
export const ORA_NAMESPACE = "https://skillsmaster.jp/openraster/1";
const operations: Record<string, LayerBlendMode> = { "svg:src-over":"normal", "svg:multiply":"multiply", "svg:screen":"screen", "svg:overlay":"overlay", "svg:darken":"darken", "svg:lighten":"lighten" };
export const blendOperation = (mode: LayerBlendMode): string => Object.keys(operations).find((key) => operations[key] === mode)!;
export const escapeXml = (value: string): string => value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g,"\ufffd").replace(/[&<>"']/g, (char) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&apos;"})[char]!);
export function pngDimensions(bytes: Uint8Array): {width: number; height: number} {
  if (bytes.length < 33 || ![137,80,78,71,13,10,26,10].every((v,i) => bytes[i] === v)
    || bytesText(bytes.subarray(12,16)) !== "IHDR") throw new Error("Invalid OpenRaster PNG");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16), height = view.getUint32(20);
  if (!validOutputSize(width,height)) throw new Error("OpenRaster PNG dimensions exceed limits");
  return {width,height};
}
export function pngDataUrl(bytes: Uint8Array): string {
  let binary = ""; for (let offset=0;offset<bytes.length;offset+=32768) binary += String.fromCharCode(...bytes.subarray(offset,offset+32768));
  return `data:image/png;base64,${btoa(binary)}`;
}

export function parseStack(files: Map<string, Uint8Array>): ImageStudioDocument {
  const xmlBytes = files.get("stack.xml");
  if (!xmlBytes || xmlBytes.length > 2 * 1024 * 1024) throw new Error("Missing or oversized OpenRaster stack");
  const text = bytesText(xmlBytes);
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error("Unsafe OpenRaster XML");
  const xml = new DOMParser().parseFromString(text,"application/xml"), image = xml.documentElement;
  if (xml.querySelector("parsererror") || image.tagName !== "image" || image.children.length !== 1 || image.children[0].tagName !== "stack") throw new Error("Invalid OpenRaster stack XML");
  const width = numberAttribute(image,"w",0), height = numberAttribute(image,"h",0);
  if (!validOutputSize(width,height)) throw new Error("OpenRaster canvas exceeds limits");
  const document = createEmptyDocument(); document.canvas = {width,height}; document.title = (image.getAttribute("name") || "OpenRaster").slice(0,160);
  let pixels = 0;
  const visit = (stack: Element, parentId: string | null, depth: number): void => {
    if (depth > 16) throw new Error("OpenRaster group nesting exceeds limits");
    for (const node of [...stack.children].reverse()) {
      if (!["stack","layer"].includes(node.tagName) || document.layers.length >= 500) throw new Error("Unsupported OpenRaster layer or layer limit");
      const opacity = numberAttribute(node,"opacity",1), visibility = node.getAttribute("visibility") ?? "visible";
      const blendMode = operations[node.getAttribute("composite-op") ?? "svg:src-over"];
      if (opacity < 0 || opacity > 1 || !["visible","hidden"].includes(visibility) || !blendMode) throw new Error("Unsupported OpenRaster composition");
      const base = {id:createId("ora"),name:(node.getAttribute("name") ?? "Layer").slice(0,500),parentId,opacity,visible:visibility === "visible",
        locked:node.getAttributeNS(ORA_NAMESPACE,"locked") === "true",blendMode,transform:defaultTransform(),width,height};
      if (node.tagName === "stack") {
        if ((node.getAttribute("isolation") ?? "isolate") !== "isolate") throw new Error("Non-isolated OpenRaster groups are not supported");
        document.layers.push({...base,type:"group",collapsed:false}); visit(node,base.id,depth+1);
      } else {
        if (node.children.length) throw new Error("Unsupported OpenRaster layer children");
        const path = node.getAttribute("src") ?? "";
        if (!safeArchivePath(path) || !path.endsWith(".png")) throw new Error("Unsafe OpenRaster layer reference");
        const bytes = files.get(path); if (!bytes) throw new Error("Missing OpenRaster layer image");
        const size = pngDimensions(bytes); pixels += size.width * size.height;
        if (pixels > ORA_MAX_PIXELS) throw new Error("OpenRaster decoded pixels exceed limits");
        const x = numberAttribute(node,"x",0), y = numberAttribute(node,"y",0);
        if (!Number.isInteger(x) || !Number.isInteger(y) || Math.abs(x) > 1_000_000 || Math.abs(y) > 1_000_000) throw new Error("Invalid OpenRaster layer offset");
        document.layers.push({...base,...size,type:"raster",transform:{...base.transform,x,y},source:{kind:"data-url",value:pngDataUrl(bytes),mimeType:"image/png"}});
      }
    }
  };
  visit(image.children[0],null,0); document.selection = {layerId:document.layers.at(-1)?.id ?? null};
  return parseDocument(JSON.stringify(document));
}
function numberAttribute(node: Element, name: string, fallback: number): number {
  const raw = node.getAttribute(name); if (raw === null) return fallback;
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(raw)) throw new Error("Invalid OpenRaster numeric attribute");
  const value = Number(raw); if (!Number.isFinite(value)) throw new Error("Invalid OpenRaster number"); return value;
}
export function layerAttributes(layer: ImageStudioLayer): string {
  return `name="${escapeXml(layer.name)}" opacity="${layer.opacity}" visibility="${layer.visible ? "visible" : "hidden"}" composite-op="${blendOperation(layer.blendMode)}" sm:locked="${layer.locked}"`;
}
