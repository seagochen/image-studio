import { MAX_SELECTION_MASK_RUNS } from "./document";
import type { PixelSelectionMask } from "./pixelTools";

/** Alternating off/on run lengths, starting with off; no pixel data URL enters project JSON. */
export function encodeSelectionRuns(selection: PixelSelectionMask): number[] {
  const length = selection.width * selection.height;
  if (selection.pixels.length !== length || !Number.isSafeInteger(length) || length < 1) {
    throw new Error("Selection dimensions are invalid");
  }
  const runs = [0];
  let selected = false;
  for (const pixel of selection.pixels) {
    const next = pixel !== 0;
    if (next !== selected) { runs.push(0); selected = next; }
    runs[runs.length - 1] += 1;
    if (runs.length > MAX_SELECTION_MASK_RUNS) throw new Error("Selection mask is too complex to save");
  }
  if (runs.length < 2) throw new Error("Selection is empty");
  return runs;
}

export function paintSelectionRuns(context: CanvasRenderingContext2D, runs: readonly number[], width: number, height: number): void {
  if (runs.length < 2 || runs.length > MAX_SELECTION_MASK_RUNS || !Number.isSafeInteger(width * height)) {
    throw new Error("Invalid selection mask runs");
  }
  let offset = 0;
  context.fillStyle = "#fff";
  for (let index = 0; index < runs.length; index += 1) {
    const count = runs[index];
    if (!Number.isInteger(count) || (index === 0 ? count < 0 : count <= 0) || offset + count > width * height) {
      throw new Error("Invalid selection mask runs");
    }
    if (index % 2 === 1) {
      let cursor = offset;
      const end = offset + count;
      while (cursor < end) {
        const x = cursor % width, y = Math.floor(cursor / width);
        const span = Math.min(end - cursor, width - x);
        context.fillRect(x, y, span, 1);
        cursor += span;
      }
    }
    offset += count;
  }
  if (offset !== width * height) throw new Error("Invalid selection mask runs");
}
