import type { ImageStudioDocument, ImageStudioLayer, LayerTransform } from "./document";
import { layerAncestors } from "./layerHierarchy";
export type Matrix = [number,number,number,number,number,number];
export function multiply(a:Matrix,b:Matrix):Matrix {
 return [a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];
}
export function transformMatrix(t:LayerTransform):Matrix {
 const angle=t.rotation*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle);
 return [c*t.scaleX,s*t.scaleX,-s*t.scaleY,c*t.scaleY,t.x,t.y];
}
export function layerMatrix(document:ImageStudioDocument,layer:ImageStudioLayer):Matrix {
 return [...layerAncestors(document.layers,layer.id).reverse(),layer].reduce<Matrix>((matrix,current)=>multiply(matrix,transformMatrix(current.transform)),[1,0,0,1,0,0]);
}
export function matrixPoint(matrix:Matrix,point:{x:number;y:number}) {
 return {x:matrix[0]*point.x+matrix[2]*point.y+matrix[4],y:matrix[1]*point.x+matrix[3]*point.y+matrix[5]};
}
export function inverse(matrix:Matrix):Matrix {
 const [a,b,c,d,e,f]=matrix,det=a*d-b*c;
 if(Math.abs(det)<1e-12)throw new Error("Layer transform is singular");
 return [d/det,-b/det,-c/det,a/det,(c*f-d*e)/det,(b*e-a*f)/det];
}
