import { rasterSourceUrl, type RasterLayer } from "../domain/document";
import { validateImageDimensions, type DecodedImage } from "../domain/importImage";

function dataUrlToBlob(dataUrl: string): Blob {
  const [header, encoded] = dataUrl.split(",", 2);
  const mimeType = /^data:([^;,]+)/.exec(header)?.[1] || "image/png";
  const bytes = atob(encoded);
  const value = new Uint8Array(bytes.length);
  for (let index = 0; index < bytes.length; index += 1) value[index] = bytes.charCodeAt(index);
  return new Blob([value], { type: mimeType });
}

export async function rasterSourceToBlob(layer: RasterLayer): Promise<Blob> {
  if (layer.source.kind === "data-url") return dataUrlToBlob(layer.source.value);
  const response = await fetch(rasterSourceUrl(layer.source));
  if (!response.ok) throw new Error(`Project asset download failed: ${response.status}`);
  return response.blob();
}

export function decodeBlob(blob: Blob, name: string): Promise<DecodedImage> {
  return new Promise((resolve, reject) => {
    const dataUrl = URL.createObjectURL(blob);
    const image = new Image();
    image.onerror = () => { URL.revokeObjectURL(dataUrl); reject(new Error("AI result is not a valid image")); };
    image.onload = () => {
      if (validateImageDimensions(image.naturalWidth, image.naturalHeight)) { URL.revokeObjectURL(dataUrl); reject(new Error("AI result exceeds image size limits")); return; }
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("AI result could not be read"));
      reader.onload = () => resolve({ dataUrl: String(reader.result), mimeType: blob.type || "image/png", width: image.naturalWidth, height: image.naturalHeight, name });
      reader.readAsDataURL(blob);
      URL.revokeObjectURL(dataUrl);
    };
    image.src = dataUrl;
  });
}

