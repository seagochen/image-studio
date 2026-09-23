import { Inflate, zipSync } from "fflate";

export const ORA_MAX_BYTES = 100 * 1024 * 1024;
export const ORA_MAX_EXPANDED_BYTES = 256 * 1024 * 1024;
export const ORA_MAX_ENTRIES = 1100;
const decoder = new TextDecoder("utf-8", { fatal: true });
export const textBytes = (value: string): Uint8Array => new TextEncoder().encode(value);
export const bytesText = (value: Uint8Array): string => decoder.decode(value);
export function safeArchivePath(name: string): boolean {
  return name.length > 0 && name.length <= 240 && !/[\\:\u0000-\u001f]/.test(name)
    && !name.startsWith("/") && name.split("/").every((part) => part && part !== "." && part !== "..");
}
interface Entry { name: string; size: number; packed: number; method: number; crc: number; offset: number; start: number }

export async function readArchive(bytes: Uint8Array, signal?: AbortSignal): Promise<Map<string, Uint8Array>> {
  if (bytes.length < 22 || bytes.length > ORA_MAX_BYTES) throw new Error("OpenRaster archive size exceeds limits");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  while (end >= Math.max(0, bytes.length - 65557) && view.getUint32(end, true) !== 0x06054b50) end--;
  if (end < 0 || view.getUint32(end, true) !== 0x06054b50 || end + 22 + view.getUint16(end + 20, true) !== bytes.length) throw new Error("Invalid ZIP directory");
  const count = view.getUint16(end + 10, true), directorySize = view.getUint32(end + 12, true), directory = view.getUint32(end + 16, true);
  if (view.getUint32(end + 4, true) !== 0 || view.getUint16(end + 8, true) !== count || count < 2 || count > ORA_MAX_ENTRIES
    || directory + directorySize !== end) throw new Error("Unsupported ZIP directory");
  const entries: Entry[] = [], names = new Set<string>();
  let cursor = directory, total = 0;
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > end || view.getUint32(cursor, true) !== 0x02014b50) throw new Error("Invalid ZIP entry");
    const flags = view.getUint16(cursor + 8, true), method = view.getUint16(cursor + 10, true);
    const packed = view.getUint32(cursor + 20, true), size = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true), extra = view.getUint16(cursor + 30, true), comment = view.getUint16(cursor + 32, true);
    const offset = view.getUint32(cursor + 42, true), crc = view.getUint32(cursor + 16, true);
    const next = cursor + 46 + nameLength + extra + comment;
    if (next > end || offset + 30 > directory) throw new Error("Invalid ZIP bounds");
    const name = bytesText(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    if ((!safeArchivePath(name) && !(name.endsWith("/") && safeArchivePath(name.slice(0, -1)))) || names.has(name)
      || (flags & ~0x080e) !== 0 || ![0, 8].includes(method) || view.getUint16(cursor + 34, true) !== 0
      || ((view.getUint32(cursor + 38, true) >>> 16) & 0xf000) === 0xa000) throw new Error("Unsafe or unsupported ZIP entry");
    names.add(name); total += size;
    if (size > ORA_MAX_BYTES || total > ORA_MAX_EXPANDED_BYTES) throw new Error("Expanded archive exceeds limits");
    if (view.getUint32(offset, true) !== 0x04034b50 || view.getUint16(offset + 6, true) !== flags || view.getUint16(offset + 8, true) !== method) throw new Error("ZIP header mismatch");
    const localName = view.getUint16(offset + 26, true), localExtra = view.getUint16(offset + 28, true);
    const start = offset + 30 + localName + localExtra;
    if (start + packed > directory || bytesText(bytes.subarray(offset + 30, offset + 30 + localName)) !== name
      || (!(flags & 8) && (view.getUint32(offset + 18, true) !== packed || view.getUint32(offset + 22, true) !== size || view.getUint32(offset + 14, true) !== crc))) throw new Error("ZIP local entry mismatch");
    entries.push({name,size,packed,method,crc,offset,start}); cursor = next;
  }
  if (cursor !== end) throw new Error("ZIP directory length mismatch");
  const ordered = [...entries].sort((a,b) => a.offset - b.offset);
  if (ordered[0].offset !== 0 || ordered[0].name !== "mimetype" || ordered[0].method !== 0) throw new Error("OpenRaster mimetype must be stored first");
  for (let i = 1; i < ordered.length; i++) if (ordered[i].offset < ordered[i-1].start + ordered[i-1].packed) throw new Error("Overlapping ZIP entries");
  const result = new Map<string, Uint8Array>();
  for (const entry of entries) {
    signal?.throwIfAborted();
    const output = new Uint8Array(entry.size); let written = 0;
    if (entry.method === 0) {
      if (entry.packed !== entry.size) throw new Error("Invalid stored entry size");
      output.set(bytes.subarray(entry.start, entry.start + entry.packed)); written = entry.size;
    } else {
      const inflate = new Inflate((chunk) => {
        if (written + chunk.length > entry.size) throw new Error("ZIP expansion exceeds declared size");
        output.set(chunk, written); written += chunk.length;
      });
      for (let offset = 0; offset < entry.packed; offset += 1024) {
        signal?.throwIfAborted();
        inflate.push(bytes.subarray(entry.start + offset, entry.start + Math.min(entry.packed, offset + 1024)), offset + 1024 >= entry.packed);
        if (offset % 65536 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    }
    if (written !== entry.size || crc32(output) !== entry.crc) throw new Error("ZIP checksum or length mismatch");
    result.set(entry.name, output);
  }
  if (bytesText(result.get("mimetype") ?? new Uint8Array()) !== "image/openraster") throw new Error("Invalid OpenRaster mimetype");
  return result;
}

export function writeArchive(files: Map<string, Uint8Array>): Uint8Array {
  let total = 0;
  for (const [name, bytes] of files) {
    if (!safeArchivePath(name) || bytes.length > ORA_MAX_BYTES) throw new Error("Invalid archive entry");
    total += bytes.length;
  }
  if (files.size > ORA_MAX_ENTRIES || total > ORA_MAX_EXPANDED_BYTES) throw new Error("OpenRaster export exceeds limits");
  // PNGs are already compressed. Stored entries also keep mimetype first and uncompressed.
  const result = zipSync(Object.fromEntries(files), { level: 0 });
  if (result.length > ORA_MAX_BYTES) throw new Error("OpenRaster export exceeds file size limit");
  return result;
}

const crcTable = Array.from({length:256}, (_, index) => {
  let value = index; for (let i=0;i<8;i++) value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff; for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
