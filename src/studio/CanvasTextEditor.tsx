import { useEffect, useRef, useState } from "react";
import type { AnnotationLayer, AnnotationTextElement, ImageStudioDocument } from "../domain/document";
import type { Viewport } from "../shared/canvas";
import { layerMatrix, multiply, transformMatrix } from "../domain/layerGeometry";
import { textFont } from "../domain/textLayout";
import { PROPERTY_LABELS } from "./propertyLabels";
import type { Locale } from "../i18n";
export function CanvasTextEditor({document,layer,element,viewport,locale,onSave,onClose}: {
 document:ImageStudioDocument;layer:AnnotationLayer;element:AnnotationTextElement;viewport:Viewport;locale:Locale;
 onSave:(element:AnnotationTextElement)=>void;onClose:()=>void;
}):JSX.Element {
 const [text,setText]=useState(element.text),ref=useRef<HTMLTextAreaElement>(null),finished=useRef(false);
 const matrix=multiply([viewport.scale,0,0,viewport.scale,viewport.offsetX,viewport.offsetY],multiply(layerMatrix(document,layer),transformMatrix({x:element.x,y:element.y,scaleX:1,scaleY:1,rotation:element.rotation})));
 useEffect(()=>{ref.current?.focus();ref.current?.select();},[]);
 useEffect(()=>{if(ref.current){ref.current.style.height="auto";ref.current.style.height=`${Math.max(element.fontSize*(element.lineHeight??1.2),ref.current.scrollHeight)}px`;}},[text]);
 const finish=(save:boolean)=>{if(finished.current)return;finished.current=true;if(save && text!==element.text)onSave({...element,text});onClose();};
 return <textarea ref={ref} className="canvas-text-editor" aria-label={PROPERTY_LABELS[locale].text} value={text} maxLength={5000}
  style={{width:element.width,transform:`matrix(${matrix.join(',')})`,font:textFont(element),lineHeight:element.lineHeight??1.2,letterSpacing:element.letterSpacing??0,color:element.fill,textAlign:element.align}}
  onChange={event=>setText(event.target.value)} onBlur={()=>finish(true)} onKeyDown={event=>{event.stopPropagation();if(event.nativeEvent.isComposing)return;if(event.key==="Escape"){event.preventDefault();finish(false);}else if(event.key==="Enter"&&(event.ctrlKey||event.metaKey)){event.preventDefault();finish(true);}}} />;
}
