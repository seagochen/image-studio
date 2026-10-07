import { resolveRasterEditCoverage, canBakeSelectedAdjustment } from "../domain/editCoverage";
import { createAdjustmentLayer } from "../domain/adjustmentEngine";
import { createEmptyDocument, parseDocument, serializeDocument, type AnnotationPathElement } from "../domain/document";
import { attachPaintAsRasterMask, addLayer, createAnnotationLayer, createDrawingLayer, duplicateLayer } from "../domain/commands";
import { refineSelection } from "../domain/selectionRefinement";
import { pathData, movePathNode } from "../domain/vectorPath";
import { inverse, layerMatrix, matrixPoint } from "../domain/layerGeometry";
import { textLines } from "../domain/textLayout";
import { cropCanvas, snapLayer } from "../domain/layoutCommands";
import { estimateRenderPeak } from "../domain/exportMemoryPlan";
const path:AnnotationPathElement={id:"path",kind:"path",closed:true,fill:"#ff0000",stroke:"#000000",strokeWidth:2,nodes:[{x:2,y:3,out:{x:8,y:3}},{x:20,y:10,in:{x:12,y:10}},{x:2,y:20}]};
describe("persistent workbench features",()=>{
 it("round trips typography, guides, stored selections, live filters and editable vector masks",()=>{
  const empty=createEmptyDocument(),layer={...createAnnotationLayer(empty,"Artwork"),width:4,height:4,elements:[path,{id:"t",kind:"text" as const,x:0,y:0,width:100,rotation:0,text:"ABC",fontFamily:"Arial",fontSize:20,fill:"#000000",align:"left" as const,fontWeight:700,italic:true,letterSpacing:2,lineHeight:1.5}],vectorMask:{path,inverted:true},filters:[{id:"blur",kind:"blur" as const,enabled:true,opacity:.5,radius:2,maskRuns:[0,8,8]}]};
  const doc={...addLayer(empty,layer),guides:[{id:"g",axis:"x" as const,position:20}],selectionArchives:[{id:"s",name:"Selection",width:4,height:4,runs:[0,8,8]}]};
  expect(parseDocument(serializeDocument(doc))).toEqual(doc);
  const copy=duplicateLayer(doc,layer.id);expect(copy.layers[1].vectorMask).toEqual(layer.vectorMask);expect(copy.layers[1].vectorMask).not.toBe(layer.vectorMask);
  const history=JSON.parse(serializeDocument(doc));history.layers[0].vectorMask.path.nodes[0].out.x=Infinity;
  expect(()=>parseDocument(JSON.stringify(history))).toThrow("path");
 });
 it("keeps filtered artwork from becoming an invalid raster-mask layer",()=>{
  const empty=createEmptyDocument(),owner=createDrawingLayer(empty,"paint","Owner"),paint={...createDrawingLayer(empty,"paint","Mask source"),filters:[{id:"f",kind:"blur" as const,enabled:true,opacity:1,radius:2}]};
  const doc=addLayer(addLayer(empty,owner),paint);
  expect(attachPaintAsRasterMask(doc,paint.id,owner.id)).toBe(doc);
 });
 it("rejects malformed filters, unclosed masks and oversized selection archives",()=>{
  const empty=createEmptyDocument(),paint=createDrawingLayer(empty,"paint","Paint"),doc=addLayer(empty,paint);
  const invalid=(layer:any)=>()=>parseDocument(JSON.stringify({...doc,layers:[layer]}));
  expect(invalid({...paint,vectorMask:{path:{...path,closed:false}}})).toThrow("mask");
  expect(invalid({...paint,filters:[{id:"a",kind:"blur",enabled:true,opacity:2,radius:4}]})).toThrow("filter");
  expect(()=>parseDocument(JSON.stringify({...doc,selectionArchives:[{id:"s",name:"s",width:1,height:1,runs:[0,2]}]}))).toThrow("archive");
 });
 it("uses vector mask alpha for local edit coverage and keeps live filters out of raw adjustment baking",()=>{
  const empty=createEmptyDocument(),raster={...createDrawingLayer(empty,"paint","P"),type:"raster" as const,width:2,height:2,source:{kind:"data-url" as const,value:"data:image/png;base64,AA==",mimeType:"image/png"},vectorMask:{path}};
  const doc=addLayer(empty,raster),pixels=new Uint8ClampedArray(16);[255,0,128,255].forEach((alpha,index)=>pixels[index*4+3]=alpha);
  const context={beginPath(){},moveTo(){},bezierCurveTo(){},closePath(){},fill(){},getImageData(){return {data:pixels};}};
  const factory=()=>({width:2,height:2,getContext:()=>context}) as unknown as HTMLCanvasElement;
  const selection={width:2,height:2,pixels:new Uint8Array([1,1,0,1])};
  expect([...resolveRasterEditCoverage(doc,raster,selection,factory)!]).toEqual([255,0,0,255]);
  expect([...resolveRasterEditCoverage(doc,{...raster,vectorMask:{path,inverted:true}},null,factory)!]).toEqual([0,255,127,0]);
  expect(canBakeSelectedAdjustment(doc,raster.id,selection,createAdjustmentLayer(doc,"invert","Invert"))).toBe(false);
 });
 it("expands and contracts neighborhoods and removes isolated noise without changing input",()=>{
  const pixels=new Uint8Array(25);pixels[12]=1;const mask={width:5,height:5,pixels};
  expect([...refineSelection(mask,"expand",1).pixels].reduce((a,b)=>a+b,0)).toBe(9);
  expect([...refineSelection(refineSelection(mask,"expand",1),"contract",1).pixels]).toEqual([...pixels]);
  expect(refineSelection(mask,"smooth",1).pixels.some(Boolean)).toBe(false);expect(pixels[12]).toBe(1);
 });
 it("moves Bezier handles with their anchor and transforms nested layer coordinates reversibly",()=>{
  expect(pathData(path)).toContain("C 8 3 12 10 20 10");expect(pathData(path)).toMatch(/Z$/);
  expect(movePathNode(path.nodes[0],12,13).out).toEqual({x:18,y:13});
  const empty=createEmptyDocument(),layer={...createAnnotationLayer(empty,"P"),transform:{x:20,y:30,rotation:45,scaleX:2,scaleY:-1}};
  const matrix=layerMatrix(addLayer(empty,layer),layer),p=matrixPoint(inverse(matrix),matrixPoint(matrix,{x:10,y:20}));
  expect(p.x).toBeCloseTo(10);expect(p.y).toBeCloseTo(20);
 });
 it("wraps text with letter spacing and moves guides on canvas crop",()=>{
  const text={id:"t",kind:"text" as const,x:0,y:0,width:25,rotation:0,text:"ABCD\nEF",fontFamily:"Arial",fontSize:20,fill:"#000000",align:"left" as const,letterSpacing:5};
  expect(textLines(text,s=>s.length*10)).toEqual(["AB","CD","EF"]);
  const empty=createEmptyDocument(),paint={...createDrawingLayer(empty,"paint","P"),width:10,height:10};
  const doc={...addLayer(empty,paint),guides:[{id:"g",axis:"x" as const,position:123}]};
  expect(snapLayer(doc,paint.id,{...paint.transform,x:121,y:50},3).x).toBe(123);
  expect(cropCanvas(doc,{x:20,y:30,width:100,height:100}).guides?.[0].position).toBe(103);
  expect(estimateRenderPeak({...doc,layers:[{...paint,filters:[{id:"f",kind:"blur",enabled:true,opacity:1,radius:5}]}]})).toBeGreaterThan(estimateRenderPeak(doc));
 });
});
