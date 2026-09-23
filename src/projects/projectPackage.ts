import {
  cloneDocument, createId, parseDocument, rasterSourceUrl, type ImageStudioDocument,
} from "../domain/document";

export const PROJECT_PACKAGE_KIND = "skillsmaster-image-studio-project" as const;
export const PROJECT_PACKAGE_VERSION = 1 as const;
export const PROJECT_PACKAGE_MAX_BYTES = 100 * 1024 * 1024;

interface PackageAsset {
  id: string;
  mimeType: string;
  dataUrl: string;
  sha256: string;
}

interface ProjectPackage {
  kind: typeof PROJECT_PACKAGE_KIND;
  packageVersion: typeof PROJECT_PACKAGE_VERSION;
  exportedAt: string;
  document: ImageStudioDocument;
  assets: PackageAsset[];
}

export async function createProjectPackage(document: ImageStudioDocument): Promise<Blob> {
  return new Blob([await serializeProjectPackage(document)], { type: "application/vnd.skillsmaster.image-studio+json" });
}

export async function serializeProjectPackage(document: ImageStudioDocument): Promise<string> {
  const packaged = cloneDocument(document);
  const assets = new Map<string, PackageAsset>();
  for (const layer of packaged.layers) {
    if (layer.type !== "raster") continue;
    const assetId = layer.source.kind === "asset" ? layer.source.assetId : `embedded-${layer.id}`;
    if (!assets.has(assetId)) {
      const dataUrl = layer.source.kind === "data-url" ? layer.source.value : await urlToDataUrl(rasterSourceUrl(layer.source));
      assertImageDataUrl(dataUrl, layer.source.mimeType);
      assets.set(assetId, { id: assetId, mimeType: layer.source.mimeType, dataUrl, sha256: await sha256(dataUrl) });
    }
    layer.source = { kind: "asset", assetId, mimeType: layer.source.mimeType };
  }
  const value: ProjectPackage = {
    kind: PROJECT_PACKAGE_KIND,
    packageVersion: PROJECT_PACKAGE_VERSION,
    exportedAt: new Date().toISOString(),
    document: packaged,
    assets: [...assets.values()],
  };
  return JSON.stringify(value);
}

export async function parseProjectPackage(text: string): Promise<ImageStudioDocument> {
  if (new Blob([text]).size > PROJECT_PACKAGE_MAX_BYTES) throw new Error("Project package is too large");
  let candidate: unknown;
  try { candidate = JSON.parse(text); } catch { throw new Error("Project package is not valid JSON"); }
  if (!isRecord(candidate) || candidate.kind !== PROJECT_PACKAGE_KIND || candidate.packageVersion !== PROJECT_PACKAGE_VERSION) {
    throw new Error("Unknown Image Studio project package format");
  }
  if (!Array.isArray(candidate.assets) || candidate.assets.length > 500 || !isRecord(candidate.document)) {
    throw new Error("Invalid Image Studio project package");
  }
  const assets = new Map<string, PackageAsset>();
  for (const raw of candidate.assets) {
    if (!isPackageAsset(raw) || assets.has(raw.id)) throw new Error("Invalid Image Studio project asset");
    assertImageDataUrl(raw.dataUrl, raw.mimeType);
    if (await sha256(raw.dataUrl) !== raw.sha256) throw new Error("Project asset checksum mismatch");
    assets.set(raw.id, raw);
  }
  const document = parseDocument(JSON.stringify(candidate.document));
  const hydrated = cloneDocument(document);
  const referencedAssets = new Set<string>();
  for (const layer of hydrated.layers) {
    if (layer.type !== "raster") continue;
    if (layer.source.kind !== "asset") throw new Error("Packaged raster layers must reference checksummed assets");
    referencedAssets.add(layer.source.assetId);
    const asset = assets.get(layer.source.assetId);
    if (!asset || asset.mimeType !== layer.source.mimeType) throw new Error("Project references an invalid asset");
    layer.source = { kind: "data-url", value: asset.dataUrl, mimeType: asset.mimeType };
  }
  if ([...assets.keys()].some((id) => !referencedAssets.has(id))) {
    throw new Error("Project package contains an unreferenced asset");
  }
  hydrated.id = createId("document");
  hydrated.metadata = { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  return hydrated;
}

export function projectPackageFilename(title: string): string {
  const safe = title.trim().replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-").slice(0, 80) || "image-studio";
  return `${safe}.image-studio.json`;
}

function isPackageAsset(value: unknown): value is PackageAsset {
  return isRecord(value) && typeof value.id === "string" && /^[a-zA-Z0-9_-]{1,160}$/.test(value.id)
    && typeof value.mimeType === "string" && typeof value.dataUrl === "string"
    && typeof value.sha256 === "string" && /^[a-f0-9]{64}$/.test(value.sha256);
}

function assertImageDataUrl(value: string, mimeType: string): void {
  const encoded = value.split(",", 2)[1] ?? "";
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(mimeType)
    || !value.startsWith(`data:${mimeType};base64,`) || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
    throw new Error("Project asset is not a supported image");
  }
  let bytes: Uint8Array;
  try { bytes = Uint8Array.from(atob(encoded.slice(0, 24)), (character) => character.charCodeAt(0)); }
  catch { throw new Error("Project asset is not valid base64"); }
  const png = bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => bytes[index] === byte);
  const jpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const webp = bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  if ((mimeType === "image/png" && !png) || (mimeType === "image/jpeg" && !jpeg) || (mimeType === "image/webp" && !webp)) {
    throw new Error("Project asset signature does not match its image type");
  }
}

async function urlToDataUrl(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Project asset download failed: ${response.status}`);
  const blob = await response.blob();
  return blobToDataUrl(blob);
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Project asset could not be read"));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(blob);
  });
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
