import { zipSync } from "fflate";
import { readArchive, writeArchive, textBytes, bytesText, ORA_MAX_EXPANDED_BYTES } from "../projects/openRaster/archive";
import { parseStack, pngDimensions, ORA_NAMESPACE } from "../projects/openRaster/stack";

const png = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==","base64"));
const stack = (inside = '<layer name="Photo" src="data/a.png"/>') => `<?xml version="1.0"?><image version="0.0.6" w="4" h="3" xmlns:sm="${ORA_NAMESPACE}"><stack>${inside}</stack></image>`;
const files = (xml = stack()) => new Map([["mimetype",textBytes("image/openraster")],["stack.xml",textBytes(xml)],["data/a.png",png]]);

describe("OpenRaster archive and baseline", () => {
  beforeAll(() => { Object.defineProperty(globalThis,"DOMParser",{configurable:true,value:document.defaultView!.DOMParser}); });
  it("writes mimetype first and uncompressed and reads both stored and deflated files", async () => {
    const stored = writeArchive(files()), view = new DataView(stored.buffer);
    expect(view.getUint16(8,true)).toBe(0);
    expect(bytesText(stored.subarray(30,38))).toBe("mimetype");
    expect((await readArchive(stored)).get("data/a.png")).toEqual(png);
    const compressed = zipSync({mimetype:[textBytes("image/openraster"),{level:0}],"stack.xml":textBytes(stack()),"data/a.png":png});
    expect(bytesText((await readArchive(compressed)).get("stack.xml")!)).toEqual(stack());
  });
  it("rejects traversal, absolute paths, duplicate paths, encrypted entries and corrupt checksums", async () => {
    for (const path of ["../a.png","/a.png","data/../a.png","data\\a.png"]) {
      await expect(readArchive(zipSync({mimetype:[textBytes("image/openraster"),{level:0}],[path]:png}))).rejects.toThrow();
    }
    const corrupt = writeArchive(files()); corrupt[corrupt.length-80] ^= 1;
    await expect(readArchive(corrupt)).rejects.toThrow();
    const encrypted = writeArchive(files()); new DataView(encrypted.buffer).setUint16(6,1,true);
    await expect(readArchive(encrypted)).rejects.toThrow();
    const duplicate = zipSync({mimetype:[textBytes("image/openraster"),{level:0}],"a.png":png,"b.png":png},{level:0});
    for(let i=0;i<duplicate.length-5;i++) if(duplicate[i] === 98 && duplicate[i+1]===46 && duplicate[i+2]===112) duplicate[i]=97;
    await expect(readArchive(duplicate)).rejects.toThrow();
  });
  it("rejects forged expansion lengths before decoding and aborts bounded inflation", async () => {
    const archive = writeArchive(files()); const view = new DataView(archive.buffer);
    for(let i=0;i<archive.length-46;i++) if(view.getUint32(i,true)===0x02014b50) {view.setUint32(i+24,ORA_MAX_EXPANDED_BYTES+1,true);break;}
    await expect(readArchive(archive)).rejects.toThrow("Expanded");
    const controller = new AbortController();controller.abort();
    await expect(readArchive(writeArchive(files()),controller.signal)).rejects.toThrow();
  });
  it("stops inflation when the stream exceeds its declared output length", async () => {
    const archive=zipSync({mimetype:[textBytes("image/openraster"),{level:0}],"data/a.png":new Uint8Array(65536)});
    const view=new DataView(archive.buffer);
    for(let i=0;i<archive.length-46;i++) {
      if(view.getUint32(i,true)===0x02014b50 && view.getUint32(i+24,true)===65536) {
        const local=view.getUint32(i+42,true);view.setUint32(i+24,1,true);view.setUint32(local+22,1,true);break;
      }
    }
    await expect(readArchive(archive)).rejects.toThrow("expansion exceeds");
  });
  it("restores bottom-to-top ordering, isolated groups, offsets, opacity, visibility and lock extension", () => {
    const doc = parseStack(files(stack('<stack name="Group" opacity="0.5" isolation="isolate"><layer name="Top" src="data/a.png" x="-2" y="3" sm:locked="true" composite-op="svg:multiply"/></stack><layer name="Bottom" src="data/a.png" visibility="hidden"/>')));
    expect(doc.layers.map(layer=>layer.name)).toEqual(["Bottom","Group","Top"]);
    expect(doc.layers[0].visible).toBe(false);expect(doc.layers[1].opacity).toBe(.5);
    expect(doc.layers[2]).toMatchObject({parentId:doc.layers[1].id,locked:true,blendMode:"multiply",transform:{x:-2,y:3}});
  });
  it("rejects unsafe XML, external sources, excessive geometry, unsupported blending and pass-through groups", () => {
    for(const xml of [
      '<!DOCTYPE image [<!ENTITY x SYSTEM "file:///etc/passwd">]>'+stack(),
      stack('<layer src="https://example.com/a.png"/>'),stack('<layer src="../a.png"/>'),
      stack('<layer src="data/a.svg"/>'),stack('<layer src="data/a.png" opacity="NaN"/>'),
      stack('<layer src="data/a.png" composite-op="svg:color-dodge"/>'),stack('<stack isolation="auto"/>'),
      stack().replace('w="4"','w="999999"'),stack('<stack>'.repeat(18)+'</stack>'.repeat(18)),
    ]) expect(()=>parseStack(files(xml))).toThrow();
    const huge=png.slice();new DataView(huge.buffer).setUint32(16,100000);expect(()=>pngDimensions(huge)).toThrow();
  });
});
