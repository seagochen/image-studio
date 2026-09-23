import { cloneDocument, defaultTransform, type ImageStudioDocument, type ImageStudioLayer } from "../../domain/document";
import { planExport, renderImageStudioDocument, type RenderDependencies } from "../../domain/exportImage";
import { parseProjectPackage, serializeProjectPackage } from "../projectPackage";
import { bytesText, readArchive, textBytes, writeArchive, ORA_MAX_EXPANDED_BYTES } from "./archive";
import { escapeXml, layerAttributes, ORA_MAX_PIXELS, ORA_NAMESPACE, parseStack, pngDataUrl, pngDimensions } from "./stack";

const EXTENSION_PATH = "extensions/skillsmaster.json";
export interface OraDependencies extends RenderDependencies { }

export async function exportOpenRaster(document: ImageStudioDocument, dependencies: OraDependencies = {}): Promise<Blob> {
  const {signal} = dependencies;
  planExport({format:"png",width:document.canvas.width,height:document.canvas.height,quality:1,jpegBackground:"#ffffff"},document);
  const files = new Map<string,Uint8Array>([["mimetype",textBytes("image/openraster")]]);
  const put = (path: string, bytes: Uint8Array) => {
    files.set(path,bytes);
    if ([...files.values()].reduce((total,value) => total + value.length,0) > ORA_MAX_EXPANDED_BYTES) throw new Error("OpenRaster export exceeds memory budget");
  };
  const merged = await renderImageStudioDocument(document,dependencies);
  put("mergedimage.png", await canvasPng(merged));
  const thumbnail = window.document.createElement("canvas");
  const scale = Math.min(1,256/Math.max(merged.width,merged.height));
  thumbnail.width = Math.max(1,Math.round(merged.width*scale)); thumbnail.height = Math.max(1,Math.round(merged.height*scale));
  thumbnail.getContext("2d")!.drawImage(merged,0,0,thumbnail.width,thumbnail.height);
  put("Thumbnails/thumbnail.png",await canvasPng(thumbnail)); merged.width = 1; merged.height = 1;
  let rasterPixels = 0;
  const writeStack = async (parentId: string | null): Promise<string> => {
    const children = document.layers.filter((layer) => (layer.parentId ?? null) === parentId);
    const elements: string[] = [];
    for (const layer of [...children].reverse()) {
      signal?.throwIfAborted();
      const untransformedGroup = layer.type === "group" && Object.entries(defaultTransform()).every(([key,value]) => layer.transform[key as keyof typeof layer.transform] === value);
      if (untransformedGroup) elements.push(`<stack ${layerAttributes(layer)} isolation="isolate">${await writeStack(layer.id)}</stack>`);
      else {
        const plainRaster = layer.type === "raster" && layer.transform.scaleX === 1 && layer.transform.scaleY === 1
          && layer.transform.rotation === 0 && Number.isInteger(layer.transform.x) && Number.isInteger(layer.transform.y);
        const size = plainRaster ? {width:layer.width,height:layer.height} : document.canvas;
        rasterPixels += size.width * size.height;
        if (rasterPixels > ORA_MAX_PIXELS) throw new Error("OpenRaster rendered layers exceed pixel budget");
        const subtree = descendants(document.layers,layer.id);
        const normalized = {...layer,parentId:null,visible:true,opacity:1,blendMode:"normal" as const,transform:plainRaster ? defaultTransform() : layer.transform};
        const canvas = await renderImageStudioDocument({...document,canvas:size,layers:[normalized,...subtree]},dependencies);
        const path = `data/layer-${files.size}.png`; put(path,await canvasPng(canvas)); canvas.width = 1; canvas.height = 1;
        elements.push(`<layer ${layerAttributes(layer)} src="${path}" x="${plainRaster ? layer.transform.x : 0}" y="${plainRaster ? layer.transform.y : 0}"/>`);
      }
    }
    return elements.join("");
  };
  // Adjustment nodes depend on their backdrop; baseline readers receive one exact composite.
  const stack = document.layers.some((layer) => layer.type === "adjustment")
    ? `<layer name="${escapeXml(document.title)}" src="mergedimage.png" opacity="1" visibility="visible" composite-op="svg:src-over"/>`
    : await writeStack(null);
  put("stack.xml",textBytes(`<?xml version="1.0" encoding="UTF-8"?><image version="0.0.6" w="${document.canvas.width}" h="${document.canvas.height}" name="${escapeXml(document.title)}" xmlns:sm="${ORA_NAMESPACE}"><stack>${stack}</stack></image>`));
  const embedded = cloneDocument(document); let embeddedPixels = 0;
  for (const layer of embedded.layers) {
    if (layer.type !== "raster") continue;
    signal?.throwIfAborted(); embeddedPixels += layer.width * layer.height;
    if (embeddedPixels > ORA_MAX_PIXELS) throw new Error("OpenRaster source pixels exceed budget");
    const canvas = await renderImageStudioDocument({...embedded,canvas:{width:layer.width,height:layer.height},layers:[{...layer,parentId:null,visible:true,opacity:1,blendMode:"normal",transform:defaultTransform()}]},dependencies);
    layer.source = {kind:"data-url",mimeType:"image/png",value:pngDataUrl(await canvasPng(canvas))}; canvas.width = 1; canvas.height = 1;
  }
  const hashes = await fileHashes(files);
  put(EXTENSION_PATH,textBytes(JSON.stringify({version:1,hashes,project:JSON.parse(await serializeProjectPackage(embedded))})));
  signal?.throwIfAborted();
  return new Blob([new Uint8Array(writeArchive(files))],{type:"image/openraster"});
}

export async function importOpenRaster(bytes: Uint8Array, signal?: AbortSignal): Promise<ImageStudioDocument> {
  const files = await readArchive(bytes,signal);
  const baseline = parseStack(files);
  const extensionBytes = files.get(EXTENSION_PATH);
  let result = baseline;
  if (extensionBytes) {
    const extension = JSON.parse(bytesText(extensionBytes));
    if (!extension || extension.version !== 1 || !extension.hashes || typeof extension.hashes !== "object" || Array.isArray(extension.hashes)) throw new Error("Unsupported OpenRaster editable extension");
    const actual = await fileHashes(files);
    // Third-party edits invalidate the snapshot, so stale editable data must never replace them.
    if (JSON.stringify(Object.entries(actual).sort()) === JSON.stringify(Object.entries(extension.hashes).sort())) {
      result = await parseProjectPackage(JSON.stringify(extension.project));
    }
  }
  let pixels = 0;
  for (const layer of result.layers) {
    if (layer.type !== "raster") continue;
    signal?.throwIfAborted();
    if (layer.source.kind !== "data-url" || !layer.source.value.startsWith("data:image/png;base64,")) throw new Error("OpenRaster extension requires embedded PNG assets");
    const imageBytes = Uint8Array.from(atob(layer.source.value.split(",")[1]),char => char.charCodeAt(0));
    const size = pngDimensions(imageBytes); pixels += size.width * size.height;
    if (size.width !== layer.width || size.height !== layer.height || pixels > ORA_MAX_PIXELS) throw new Error("OpenRaster asset dimensions or pixel budget mismatch");
    const bitmap = await createImageBitmap(new Blob([imageBytes],{type:"image/png"}));
    try { if (bitmap.width !== size.width || bitmap.height !== size.height) throw new Error("OpenRaster decoded dimensions mismatch"); }
    finally { bitmap.close(); }
  }
  signal?.throwIfAborted(); return result;
}

function descendants(layers: ImageStudioLayer[], parentId: string): ImageStudioLayer[] {
  return layers.filter((layer) => layer.parentId === parentId).flatMap((layer) => [layer,...descendants(layers,layer.id)]);
}
async function canvasPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob>((resolve,reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("OpenRaster PNG encoding failed")),"image/png"));
  return new Uint8Array(await blob.arrayBuffer());
}
async function fileHashes(files: Map<string,Uint8Array>): Promise<Record<string,string>> {
  const hashes: Record<string,string> = Object.create(null);
  for (const [path,bytes] of files) {
    if (path.startsWith("extensions/")) continue;
    const digest = await crypto.subtle.digest("SHA-256",new Uint8Array(bytes));
    hashes[path] = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2,"0")).join("");
  }
  return hashes;
}
