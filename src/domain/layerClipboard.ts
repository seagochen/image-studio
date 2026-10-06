import { duplicateLayer } from "./commands";
import { touchDocument, type ImageStudioDocument } from "./document";

// Reuse layer duplication so group descendants and companion masks stay together.
export function copyLayer(document: ImageStudioDocument): ImageStudioDocument | null {
  const id = document.selection.layerId;
  if (!id) return null;
  const duplicate = duplicateLayer(document, id);
  if (duplicate === document) return null;
  const originalIds = new Set(document.layers.map((layer) => layer.id));
  const layers = duplicate.layers.filter((layer) => !originalIds.has(layer.id));
  const copiedIds = new Set(layers.map((layer) => layer.id));
  const original = document.layers.find((layer) => layer.id === id)!;
  return { ...duplicate, layers: layers.map((layer) => ({ ...layer,
    parentId: layer.parentId && copiedIds.has(layer.parentId) ? layer.parentId : null,
    ...(layer.id === duplicate.selection.layerId ? { name: original.name, transform: { ...original.transform } } : {}),
  })) };
}

export function pasteLayer(document: ImageStudioDocument, clipboard: ImageStudioDocument): ImageStudioDocument {
  const duplicate = duplicateLayer(clipboard, clipboard.selection.layerId!);
  if (duplicate === clipboard) return document;
  const originalIds = new Set(clipboard.layers.map((layer) => layer.id));
  const layers = duplicate.layers.filter((layer) => !originalIds.has(layer.id)).map((layer) => {
    if (layer.id !== duplicate.selection.layerId) return layer;
    const original = clipboard.layers.find((candidate) => candidate.id === clipboard.selection.layerId)!;
    return { ...layer, name: original.name, transform: { ...original.transform } };
  });
  const pastedIds = new Set(layers.map((layer) => layer.id));
  const detached = layers.map((layer) => ({ ...layer,
    parentId: layer.parentId && (pastedIds.has(layer.parentId)
      || document.layers.some((parent) => parent.id === layer.parentId && parent.type === "group")) ? layer.parentId : null,
  }));
  return touchDocument({ ...document, layers: [...document.layers, ...detached], selection: duplicate.selection });
}
