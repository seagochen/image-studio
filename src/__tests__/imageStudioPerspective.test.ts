import { fullImageQuad, projectPoint, rectangleToQuad, validOutputSize, validQuad, warpPerspective, type Quad } from "../domain/perspective";
import { createEmptyDocument, parseDocument } from "../domain/document";
import { addLayer } from "../domain/commands";
import { rasterLayerFromImage } from "../domain/importImage";
import { DocumentHistory } from "../domain/history";
import { applyConventionalEditorOutcome } from "../adapters/conventionalEditor";

const signal = () => new AbortController().signal;
describe("Perspective correction", () => {
  it("maps all four corners and a known projective interior point", () => {
    const quad: Quad = [{x:2,y:0},{x:6,y:0},{x:8,y:4},{x:0,y:4}];
    const matrix = rectangleToQuad(quad);
    [[0,0],[1,0],[1,1],[0,1]].forEach(([u,v], i) => {
      const p = projectPoint(matrix,u,v);
      expect(p.x).toBeCloseTo(quad[i].x); expect(p.y).toBeCloseTo(quad[i].y);
    });
    expect(projectPoint(matrix,.5,.5).x).toBeCloseTo(4);
    expect(projectPoint(matrix,.5,.5).y).toBeCloseTo(4/3);
  });
  it("rejects crossed, concave, repeated, out-of-bounds and non-finite corners", () => {
    expect(validQuad(fullImageQuad(10,10),10,10)).toBe(true);
    for (const quad of [
      [{x:0,y:0},{x:10,y:10},{x:10,y:0},{x:0,y:10}],
      [{x:0,y:0},{x:10,y:0},{x:2,y:2},{x:10,y:10}],
      [{x:0,y:0},{x:0,y:0},{x:10,y:10},{x:0,y:10}],
      [{x:-1,y:0},{x:10,y:0},{x:10,y:10},{x:0,y:10}],
      [{x:NaN,y:0},{x:10,y:0},{x:10,y:10},{x:0,y:10}],
    ]) expect(validQuad(quad as Quad,10,10)).toBe(false);
    for (const [w,h] of [[0,1],[1.5,2],[Infinity,2],[16385,1],[10000,10000]]) expect(validOutputSize(w,h)).toBe(false);
  });
  it("preserves an identity image and samples a rectangular crop at pixel centers", async () => {
    const data = new Uint8ClampedArray([255,0,0,255, 0,255,0,255, 0,0,255,255, 255,255,255,255]);
    const source = {width:2,height:2,data};
    expect((await warpPerspective(source,fullImageQuad(2,2),2,2,signal())).data).toEqual(data);
    const quad: Quad = [{x:1,y:0},{x:2,y:0},{x:2,y:2},{x:1,y:2}];
    expect(Array.from((await warpPerspective(source,quad,1,2,signal())).data)).toEqual([0,255,0,255,255,255,255,255]);
  });
  it("resamples a known trapezoid using projective rather than affine coordinates", async () => {
    const data = new Uint8ClampedArray(8 * 4 * 4);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 8; x++) data.set([x * 20, y * 60, 0, 255], (y * 8 + x) * 4);
    const quad: Quad = [{x:2,y:0},{x:6,y:0},{x:8,y:4},{x:0,y:4}];
    const output = await warpPerspective({width:8,height:4,data},quad,1,1,signal());
    expect(Array.from(output.data)).toEqual([70,50,0,255]);
  });
  it("interpolates premultiplied alpha without leaking transparent RGB", async () => {
    const source = {width:2,height:1,data:new Uint8ClampedArray([255,0,0,0, 0,0,255,255])};
    expect(Array.from((await warpPerspective(source,fullImageQuad(2,1),1,1,signal())).data)).toEqual([0,0,255,128]);
  });
  it("aborts between chunks and rejects excessive output before allocation", async () => {
    const source = {width:1,height:1,data:new Uint8ClampedArray([1,2,3,255])};
    const controller = new AbortController();
    await expect(warpPerspective(source,fullImageQuad(1,1),256,256,controller.signal,()=>controller.abort())).rejects.toThrow();
    await expect(warpPerspective(source,fullImageQuad(1,1),10000,10000,signal())).rejects.toThrow("Invalid perspective");
  });
  it("replaces the selected raster, round-trips and supports undo/redo", () => {
    const image = {dataUrl:"data:image/png;base64,AAAA",mimeType:"image/png",width:2,height:2,name:"Source"};
    const original = addLayer(createEmptyDocument(),rasterLayerFromImage(image));
    const result = applyConventionalEditorOutcome(original, original.layers[0].id, {
      kind: "saved",
      output: {dataUrl:"data:image/png;base64,QkJCQg==",mimeType:image.mimeType,width:3,height:image.height},
    });
    const history = new DocumentHistory();
    expect(history.canRecord(original,result)).toBe(true);
    history.execute(original,result,"Correct perspective");
    expect(history.undo(result)).toEqual(original); expect(history.redo(original)).toEqual(result);
    expect(result.layers).toHaveLength(1);
    expect(result.layers[0].id).toBe(original.layers[0].id);
    expect(result.layers[0]).toMatchObject({type:"raster",locked:false,width:3,source:{kind:"data-url",value:"data:image/png;base64,QkJCQg=="}});
    expect(original.layers[0]).toMatchObject({width:2,source:{kind:"data-url",value:"data:image/png;base64,AAAA"}});
    expect(parseDocument(JSON.stringify(result)).layers).toEqual(result.layers);
    expect(new DocumentHistory({maxEntries:50,maxBytes:1}).canRecord(original,result)).toBe(false);
  });
});
