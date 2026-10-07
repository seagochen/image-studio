import type { AnnotationTextElement } from "./document";
export function textFont(element: AnnotationTextElement): string {
 return `${element.italic ? "italic" : "normal"} ${element.fontWeight ?? 400} ${element.fontSize}px ${element.fontFamily}`;
}
export function textLines(element: AnnotationTextElement, measure: (text:string)=>number): string[] {
 const spacing=element.letterSpacing??0, width=(text:string)=>measure(text)+Math.max(0,Array.from(text).length-1)*spacing;
 const lines:string[]=[];
 for(const paragraph of element.text.split("\n")) {
  let line="";
  for(const glyph of Array.from(paragraph)) {
   if(line && width(line+glyph)>element.width) {lines.push(line);line=glyph;}else line+=glyph;
  }
  lines.push(line);
 }
 return lines;
}
export function renderText(context:CanvasRenderingContext2D,element:AnnotationTextElement):void {
 context.font=textFont(element);context.textBaseline="top";context.textAlign="left";
 const spacing=element.letterSpacing??0;
 textLines(element,text=>context.measureText(text).width).forEach((line,index)=>{
  const glyphs=Array.from(line),width=context.measureText(line).width+Math.max(0,glyphs.length-1)*spacing;
  let x=element.align==="center"?(element.width-width)/2:element.align==="right"?element.width-width:0;
  const y=index*element.fontSize*(element.lineHeight??1.2);
  if(!spacing){context.fillText(line,x,y);return;}
  for(const glyph of glyphs){context.fillText(glyph,x,y);x+=context.measureText(glyph).width+spacing;}
 });
}
