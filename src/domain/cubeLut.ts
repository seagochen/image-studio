import { LUT_MAX_SIZE_1D, LUT_MAX_SIZE_3D, LUT_NAME_MAX_LENGTH } from "../shared/imageStudioDomain";

// Raw imported .cube file text size, distinct from the document contract's
// cap on the serialized adjustment.parameters JSON (different measurement
// point, same order of magnitude by design) — not unified with that limit.
export const CUBE_LUT_MAX_BYTES = 2 * 1024 * 1024;
export const CUBE_LUT_MAX_1D_SIZE = LUT_MAX_SIZE_1D;
export const CUBE_LUT_MAX_3D_SIZE = LUT_MAX_SIZE_3D;

export interface CubeLut {
  name: string;
  dimension: "1d" | "3d";
  size: number;
  domainMin: [number, number, number];
  domainMax: [number, number, number];
  values: number[];
}

export function parseCubeLut(source: string, fallbackName = "Imported LUT"): CubeLut {
  if (new TextEncoder().encode(source).byteLength > CUBE_LUT_MAX_BYTES) throw new Error("LUT file exceeds the size limit");
  let name = fallbackName.slice(0, LUT_NAME_MAX_LENGTH) || "Imported LUT";
  let dimension: CubeLut["dimension"] | null = null;
  let size = 0;
  let domainMin: CubeLut["domainMin"] = [0, 0, 0];
  let domainMax: CubeLut["domainMax"] = [1, 1, 1];
  const values: number[] = [];
  let dataStarted = false;

  for (const rawLine of source.split(/\r?\n/)) {
    const line = stripCubeComment(rawLine).trim();
    if (!line) continue;
    const title = /^TITLE\s+"([^"]*)"$/i.exec(line);
    if (title && !dataStarted) { name = title[1].trim().slice(0, LUT_NAME_MAX_LENGTH) || name; continue; }
    const tokens = line.split(/\s+/);
    const keyword = tokens[0].toUpperCase();
    if ((keyword === "LUT_1D_SIZE" || keyword === "LUT_3D_SIZE") && !dataStarted) {
      if (dimension) throw new Error("LUT dimension is declared more than once");
      if (tokens.length !== 2 || !/^\d+$/.test(tokens[1])) throw new Error("Invalid LUT grid size");
      dimension = keyword === "LUT_1D_SIZE" ? "1d" : "3d";
      size = Number(tokens[1]);
      const maximum = dimension === "1d" ? CUBE_LUT_MAX_1D_SIZE : CUBE_LUT_MAX_3D_SIZE;
      if (size < 2 || size > maximum) throw new Error("LUT grid size exceeds the supported range");
      continue;
    }
    if ((keyword === "DOMAIN_MIN" || keyword === "DOMAIN_MAX") && !dataStarted) {
      const domain = parseTriplet(tokens.slice(1), "Invalid LUT domain") as [number, number, number];
      if (domain.some((value) => Math.abs(value) > 10_000)) throw new Error("LUT domain is outside the supported range");
      if (keyword === "DOMAIN_MIN") domainMin = domain; else domainMax = domain;
      continue;
    }
    if (!dimension || !size) throw new Error("LUT data appears before its grid declaration");
    if (/^[A-Z_]+$/i.test(keyword)) throw new Error(`Unsupported LUT directive: ${keyword}`);
    dataStarted = true;
    const triplet = parseTriplet(tokens, "Invalid LUT sample");
    if (triplet.some((value) => Math.abs(value) > 16)) throw new Error("LUT sample is outside the supported range");
    values.push(...triplet);
    const expected = (dimension === "1d" ? size : size ** 3) * 3;
    if (values.length > expected) throw new Error("LUT contains too many samples");
  }

  if (!dimension || !size) throw new Error("LUT grid declaration is missing");
  if (domainMin.some((value, index) => value >= domainMax[index])) throw new Error("LUT domain minimum must be below its maximum");
  const expected = (dimension === "1d" ? size : size ** 3) * 3;
  if (values.length !== expected) throw new Error("LUT sample data is truncated");
  return { name, dimension, size, domainMin, domainMax, values };
}

function stripCubeComment(line: string): string {
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] === '"') quoted = !quoted;
    if (line[index] === "#" && !quoted) return line.slice(0, index);
  }
  return line;
}

function parseTriplet(tokens: string[], message: string): number[] {
  if (tokens.length !== 3) throw new Error(message);
  const values = tokens.map(Number);
  if (values.some((value) => !Number.isFinite(value))) throw new Error(message);
  return values;
}
