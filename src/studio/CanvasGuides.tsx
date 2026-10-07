import { useRef } from "react";
import type { CanvasGuide } from "../domain/document";
import type { Viewport } from "../shared/canvas";
import type { Locale } from "../i18n";
import { layoutCopy } from "./layoutCopy";
export function CanvasGuides({viewport,width,height,grid,spacing,rulers,guides,locale,onAdd,onMove,onRemove}: {
 viewport:Viewport;width:number;height:number;grid:boolean;spacing:number;rulers:boolean;guides:CanvasGuide[];locale:Locale;
 onAdd:(axis:"x"|"y",position:number)=>void;onMove:(id:string,position:number)=>void;onRemove:(id:string)=>void;
}):JSX.Element {
 const ref=useRef<HTMLDivElement>(null),copy=layoutCopy[locale];
 const position=(event:React.PointerEvent<HTMLElement>,axis:"x"|"y")=>{const bounds=ref.current!.getBoundingClientRect();return Math.round(((axis==="x"?event.clientX-bounds.left:event.clientY-bounds.top)-(axis==="x"?viewport.offsetX:viewport.offsetY))/viewport.scale);};
 const ticks=(axis:"x"|"y")=>{const span=axis==="x"?width:height;const step=Math.max(1,Math.ceil(50/viewport.scale/10)*10);return Array.from({length:Math.min(1000,Math.floor(span/step)+1)},(_,i)=><span key={i} style={axis==="x"?{left:viewport.offsetX+i*step*viewport.scale}:{top:viewport.offsetY+i*step*viewport.scale}}>{i*step}</span>);};
 return <div ref={ref} className="canvas-guides">
 {grid&&<div className="canvas-grid" style={{left:viewport.offsetX,top:viewport.offsetY,width:width*viewport.scale,height:height*viewport.scale,backgroundSize:`${spacing*viewport.scale}px ${spacing*viewport.scale}px`}} />}
 {rulers&&(["x","y"] as const).map(axis=><div key={axis} className={`canvas-ruler ruler-${axis}`} aria-label={copy.rulers} onPointerDown={event=>event.currentTarget.setPointerCapture(event.pointerId)} onPointerUp={event=>{if(event.currentTarget.hasPointerCapture(event.pointerId))onAdd(axis==="x"?"y":"x",position(event,axis==="x"?"y":"x"));}}>{ticks(axis)}</div>)}
 {guides.map(guide=><div key={guide.id} className={`canvas-guide guide-${guide.axis}`} role="separator" tabIndex={0} aria-label={`${guide.axis.toUpperCase()} ${guide.position}`} aria-valuenow={guide.position}
 style={guide.axis==="x"?{left:viewport.offsetX+guide.position*viewport.scale}:{top:viewport.offsetY+guide.position*viewport.scale}}
 onPointerDown={event=>event.currentTarget.setPointerCapture(event.pointerId)} onPointerMove={event=>{if(event.currentTarget.hasPointerCapture(event.pointerId))onMove(guide.id,position(event,guide.axis));}}
 onDoubleClick={()=>onRemove(guide.id)} onKeyDown={event=>{if(event.key==="Delete"||event.key==="Backspace"){event.preventDefault();onRemove(guide.id);}else if(["ArrowLeft","ArrowUp","ArrowRight","ArrowDown"].includes(event.key)){event.preventDefault();onMove(guide.id,guide.position+(["ArrowLeft","ArrowUp"].includes(event.key)?-1:1));}}} title={copy.remove} />)}
 </div>;
}
