import type { PixelSelectionMask } from "./pixelTools";
export type SelectionRefinement = "expand" | "contract" | "smooth";
/** Box-neighborhood refinement stays binary; soft edges belong to the owned mask. */
export function refineSelection(mask: PixelSelectionMask, operation: SelectionRefinement, radius: number): PixelSelectionMask {
  const {width,height,pixels} = mask;
  if (!Number.isInteger(radius) || radius < 0 || radius > 128 || !Number.isInteger(width) || !Number.isInteger(height)
    || width < 1 || height < 1 || width*height > 16_777_216 || pixels.length !== width*height) throw new Error("Invalid selection refinement");
  if (!radius) return mask;
  const horizontal = new Uint16Array(pixels.length), output = new Uint8Array(pixels.length), span = radius*2+1;
  for (let y=0;y<height;y++) {
    let count=0;
    for (let x=0;x<=Math.min(radius,width-1);x++) count+=pixels[y*width+x]?1:0;
    for (let x=0;x<width;x++) {
      horizontal[y*width+x]=count;
      if(x-radius>=0)count-=pixels[y*width+x-radius]?1:0;
      if(x+radius+1<width)count+=pixels[y*width+x+radius+1]?1:0;
    }
  }
  for(let x=0;x<width;x++) {
    let count=0;
    for(let y=0;y<=Math.min(radius,height-1);y++)count+=horizontal[y*width+x];
    for(let y=0;y<height;y++) {
      output[y*width+x]=operation==="expand"?Number(count>0):operation==="contract"?Number(count===span*span):Number(count>span*span/2);
      if(y-radius>=0)count-=horizontal[(y-radius)*width+x];
      if(y+radius+1<height)count+=horizontal[(y+radius+1)*width+x];
    }
  }
  return {...mask,pixels:output};
}
