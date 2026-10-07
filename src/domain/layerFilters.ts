import type { LayerFilter } from "./document";
import { adjustmentKernel, applySpatialAdjustment, isSpatialAdjustment, spatialRadius, yieldRenderTask } from "./adjustmentEngine";
import { releaseRenderCanvas, reserveRenderBytes, type RenderMemoryBudget } from "./renderMemory";
import { decodeSelectionRuns } from "./selectionMaskRuns";
export async function renderLayerFilters(image:CanvasImageSource,width:number,height:number,filters:readonly LayerFilter[],
 createCanvas:(width:number,height:number)=>HTMLCanvasElement,scale:number,signal?:AbortSignal,budget?:RenderMemoryBudget):Promise<HTMLCanvasElement> {
 const output=createCanvas(width,height);let baseline:HTMLCanvasElement|undefined;
 try {
  const context=output.getContext("2d");if(!context)throw new Error("Filter canvas is unavailable");
  context.drawImage(image,0,0,output.width,output.height);
  const w=output.width,h=output.height;
  for(const filter of filters) {
   if(!filter.enabled||!filter.opacity)continue;
   await yieldRenderTask(signal);
   baseline=createCanvas(width,height);const source=baseline.getContext("2d");if(!source)throw new Error("Filter canvas is unavailable");source.drawImage(output,0,0);
   let mask:Uint8Array|undefined,releaseMask=()=>{};
   try {
    if(filter.maskRuns){releaseMask=reserveRenderBytes(budget,width*height);mask=decodeSelectionRuns(filter.maskRuns,width,height);}
    const spatial=filter.kind==="adjustment"&&isSpatialAdjustment(filter.adjustment.kind);
    const adjustment=filter.kind==="adjustment"?{...filter.adjustment,parameters:{...filter.adjustment.parameters,...(spatial?{radius:Math.max(1,Math.round(spatialRadius(filter.adjustment)*scale))}:{})}}:undefined;
    const halo=spatial&&adjustment?spatialRadius(adjustment):filter.kind==="sharpen"?1:0;
    if(filter.kind==="blur") {context.clearRect(0,0,w,h);context.save();context.filter=`blur(${filter.radius*scale}px)`;context.drawImage(baseline,0,0);context.restore();}
    const rows=Math.max(1,Math.floor(262144/w));
    for(let y=0;y<h;y+=rows) {
     await yieldRenderTask(signal);
     const end=Math.min(h,y+rows),readY=Math.max(0,y-halo),readEnd=Math.min(h,end+halo);
     const release=reserveRenderBytes(budget,w*(readEnd-readY)*(spatial?56:12));
     try {
      const before=source.getImageData(0,readY,w,readEnd-readY),data=filter.kind==="blur"?context.getImageData(0,readY,w,readEnd-readY):new ImageData(new Uint8ClampedArray(before.data),w,before.height);
      if(filter.kind==="adjustment"&&adjustment) {
       if(spatial)data.data.set(applySpatialAdjustment(before.data,w,before.height,adjustment));
       else adjustmentKernel(adjustment,1,"normal")(data.data);
      }else if(filter.kind==="sharpen") {
       for(let row=0;row<before.height;row++)for(let x=0;x<w;x++) {
        const i=(row*w+x)*4;if(!before.data[i+3])continue;
        const neighbors=[(row*w+Math.max(0,x-1))*4,(row*w+Math.min(w-1,x+1))*4,(Math.max(0,row-1)*w+x)*4,(Math.min(before.height-1,row+1)*w+x)*4];
        for(let c=0;c<3;c++)data.data[i+c]=before.data[i+c]+filter.amount*neighbors.reduce((sum,n)=>sum+(before.data[n+3]?before.data[i+c]-before.data[n+c]:0),0);
       }
      }
      for(let row=y-readY;row<end-readY;row++)for(let x=0;x<w;x++) {
       const i=(row*w+x)*4,coverage=mask?mask[Math.min(height-1,Math.floor((row+readY)/scale))*width+Math.min(width-1,Math.floor(x/scale))]:1;
       const strength=coverage*filter.opacity;
       const oldAlpha=before.data[i+3]/255,newAlpha=data.data[i+3]/255;
       const alpha=oldAlpha*(1-strength)+newAlpha*strength;
       for(let c=0;c<3;c++)data.data[i+c]=alpha?(before.data[i+c]*oldAlpha*(1-strength)+data.data[i+c]*newAlpha*strength)/alpha:0;
       data.data[i+3]=alpha*255;
      }
      context.putImageData(data,0,readY,0,y-readY,w,end-y);
     }finally{release();}
    }
   }finally{releaseMask();}
   releaseRenderCanvas(baseline);baseline=undefined;
  }
  return output;
 }catch(error){releaseRenderCanvas(output);throw error;}finally{if(baseline)releaseRenderCanvas(baseline);}
}
