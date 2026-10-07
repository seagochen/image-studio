import { useRef, useState } from "react";
import type { AnnotationPathElement, ImageStudioDocument, ImageStudioLayer, PathNode } from "../domain/document";
import { createId } from "../domain/document";
import { inverse, layerMatrix, matrixPoint, type Matrix } from "../domain/layerGeometry";
import { movePathNode, pathData } from "../domain/vectorPath";
import type { Locale } from "../i18n";
const en={pen:"Pen path",edit:"Edit path",mask:"Draw vector mask",editMask:"Edit vector mask",remove:"Remove vector mask",invert:"Invert vector mask",save:"Apply path",cancel:"Cancel",closed:"Closed path",fill:"Fill",stroke:"Stroke",width:"Stroke width",hint:"Click to add anchors; drag to create curve handles. Drag anchors or handles to edit. Enter applies; Escape cancels.",delete:"Delete anchor",clearHandles:"Corner point"};
export const pathCopy:Record<Locale,typeof en>={en,
 "zh-CN":{pen:"钢笔路径",edit:"编辑路径",mask:"绘制矢量蒙版",editMask:"编辑矢量蒙版",remove:"移除矢量蒙版",invert:"反转矢量蒙版",save:"应用路径",cancel:"取消",closed:"闭合路径",fill:"填充",stroke:"描边",width:"描边宽度",hint:"点击添加锚点，拖动创建曲线控制柄；拖动锚点或控制柄调整。Enter 应用，Escape 取消。",delete:"删除锚点",clearHandles:"转为角点"},
 "zh-TW":{pen:"鋼筆路徑",edit:"編輯路徑",mask:"繪製向量遮罩",editMask:"編輯向量遮罩",remove:"移除向量遮罩",invert:"反轉向量遮罩",save:"套用路徑",cancel:"取消",closed:"閉合路徑",fill:"填滿",stroke:"描邊",width:"描邊寬度",hint:"點擊新增錨點，拖曳建立曲線控制柄；拖曳錨點或控制柄調整。Enter 套用，Escape 取消。",delete:"刪除錨點",clearHandles:"轉為角點"},
 ja:{pen:"ペンパス",edit:"パスを編集",mask:"ベクターマスクを描画",editMask:"ベクターマスクを編集",remove:"ベクターマスクを削除",invert:"ベクターマスクを反転",save:"パスを適用",cancel:"キャンセル",closed:"閉じたパス",fill:"塗り",stroke:"線",width:"線の幅",hint:"クリックでアンカーを追加、ドラッグで曲線ハンドルを作成。アンカーとハンドルをドラッグして編集。Enter で適用、Escape でキャンセル。",delete:"アンカーを削除",clearHandles:"角に変換"}};
export function CanvasPathEditor({document,layer,initial,mask,color,viewport,onSave,onClose,locale}:{
 document:ImageStudioDocument;layer?:ImageStudioLayer;initial?:AnnotationPathElement;mask:boolean;color:string;
 viewport:{offsetX:number;offsetY:number;scale:number};onSave:(path:AnnotationPathElement)=>void;onClose:()=>void;locale:Locale;
}):JSX.Element {
 const [path,setPath]=useState<AnnotationPathElement>(()=>initial?JSON.parse(JSON.stringify(initial)):{id:createId("path"),kind:"path",nodes:[],closed:mask,fill:"transparent",stroke:color,strokeWidth:2});
 const [active,setActive]=useState<number|null>(null);const svg=useRef<SVGSVGElement>(null),drag=useRef<{index:number;part:"anchor"|"in"|"out"|"create"}|null>(null);
 const matrix:Matrix=layer?layerMatrix(document,layer):[1,0,0,1,0,0],copy=pathCopy[locale];
 const point=(event:React.PointerEvent)=>{const bounds=svg.current!.getBoundingClientRect();return matrixPoint(inverse(matrix),{x:(event.clientX-bounds.left)/viewport.scale,y:(event.clientY-bounds.top)/viewport.scale});};
 const begin=(event:React.PointerEvent,index?:number,part:"anchor"|"in"|"out"="anchor")=>{
  if(event.button!==0)return;event.preventDefault();event.stopPropagation();svg.current?.focus();svg.current?.setPointerCapture(event.pointerId);
  if(index===undefined){if(path.nodes.length>=1000)return;const p=point(event);index=path.nodes.length;setPath(current=>({...current,nodes:[...current.nodes,p]}));drag.current={index,part:"create"};}
  else drag.current={index,part};setActive(index);
 };
 const apply=()=>{if(path.nodes.length>=2){onSave({...path,closed:mask||path.closed});onClose();}};
 return <div className="canvas-path-editor"><div className="path-editor-actions" onPointerDown={event=>event.stopPropagation()}>
 <span>{copy.hint}</span><label><input type="checkbox" checked={mask||path.closed} disabled={mask} onChange={event=>setPath(current=>({...current,closed:event.target.checked}))} />{copy.closed}</label>
 {!mask&&<><label>{copy.fill}<input type="checkbox" checked={path.fill!=="transparent"} onChange={event=>setPath(current=>({...current,fill:event.target.checked?color:"transparent"}))} /><input aria-label={copy.fill} type="color" value={path.fill==="transparent"?color:path.fill} onChange={event=>setPath(current=>({...current,fill:event.target.value}))} /></label>
 <label>{copy.stroke}<input type="color" value={path.stroke} onChange={event=>setPath(current=>({...current,stroke:event.target.value}))} /></label><label>{copy.width}<input type="number" min="0" max="100" value={path.strokeWidth} onChange={event=>{const value=event.target.valueAsNumber;if(Number.isFinite(value))setPath(current=>({...current,strokeWidth:Math.max(0,Math.min(100,value))}));}} /></label></>}
 <button disabled={active===null} onClick={()=>{setPath(current=>({...current,nodes:current.nodes.filter((_,index)=>index!==active)}));setActive(null);}}>{copy.delete}</button>
 <button disabled={active===null} onClick={()=>setPath(current=>({...current,nodes:current.nodes.map((node,index)=>index===active?{x:node.x,y:node.y}:node)}))}>{copy.clearHandles}</button>
 <button disabled={path.nodes.length<2} onClick={apply}>{copy.save}</button><button onClick={onClose}>{copy.cancel}</button></div>
 <svg ref={svg} tabIndex={0} aria-label={mask?copy.mask:copy.pen} style={{left:viewport.offsetX,top:viewport.offsetY,width:document.canvas.width*viewport.scale,height:document.canvas.height*viewport.scale}} viewBox={`0 0 ${document.canvas.width} ${document.canvas.height}`}
 onPointerDown={event=>begin(event)} onPointerMove={event=>{const session=drag.current;if(!session)return;const p=point(event);setPath(current=>({...current,nodes:current.nodes.map((node,index):PathNode=>{if(index!==session.index)return node;if(session.part==="anchor")return movePathNode(node,p.x,p.y);if(session.part==="create")return {...node,out:p,in:{x:2*node.x-p.x,y:2*node.y-p.y}};return {...node,[session.part]:p};})}));}}
 onPointerUp={()=>{drag.current=null;}} onPointerCancel={()=>{drag.current=null;}} onKeyDown={event=>{if(event.key==="Escape"){event.preventDefault();onClose();}if(event.key==="Enter"){event.preventDefault();apply();}event.stopPropagation();}}>
 <g transform={`matrix(${matrix.join(" ")})`}><path d={pathData(path)} fill={path.closed&&path.fill!=="transparent"?path.fill:"none"} stroke={path.stroke} strokeWidth={Math.max(path.strokeWidth,1/viewport.scale)} pointerEvents="none" />
 {path.nodes.map((node,index)=><g key={index}>{(["in","out"] as const).map(part=>node[part]&&<g key={part}><line x1={node.x} y1={node.y} x2={node[part]!.x} y2={node[part]!.y} stroke="#6366f1" strokeWidth={1/viewport.scale} pointerEvents="none" /><circle aria-label={`${part} ${index+1}`} cx={node[part]!.x} cy={node[part]!.y} r={4/viewport.scale} fill="#fff" stroke="#6366f1" strokeWidth={1/viewport.scale} onPointerDown={event=>begin(event,index,part)} /></g>)}
 <circle aria-label={`Anchor ${index+1}`} cx={node.x} cy={node.y} r={5/viewport.scale} fill={active===index?"#6366f1":"#fff"} stroke="#6366f1" strokeWidth={1/viewport.scale} onPointerDown={event=>begin(event,index)} /></g>)}
 </g></svg></div>;
}
