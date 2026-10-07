import type { AnnotationPathElement, PathNode } from "./document";
export function pathData(path:AnnotationPathElement):string {
 const first=path.nodes[0];if(!first)return "";
 let data=`M ${first.x} ${first.y}`;
 const nodes=path.closed?[...path.nodes.slice(1),first]:path.nodes.slice(1);
 let previous=first;
 for(const node of nodes){const a=previous.out??previous,b=node.in??node;data+=` C ${a.x} ${a.y} ${b.x} ${b.y} ${node.x} ${node.y}`;previous=node;}
 return data+(path.closed?" Z":"");
}
export function tracePath(context:CanvasRenderingContext2D,path:AnnotationPathElement):void {
 context.beginPath();const first=path.nodes[0];if(!first)return;
 context.moveTo(first.x,first.y);let previous=first;
 for(const node of path.closed?[...path.nodes.slice(1),first]:path.nodes.slice(1)) {const a=previous.out??previous,b=node.in??node;context.bezierCurveTo(a.x,a.y,b.x,b.y,node.x,node.y);previous=node;}
 if(path.closed)context.closePath();
}
export function movePathNode(node:PathNode,x:number,y:number):PathNode {
 const dx=x-node.x,dy=y-node.y;
 return {...node,x,y,...(node.in?{in:{x:node.in.x+dx,y:node.in.y+dy}}:{}),...(node.out?{out:{x:node.out.x+dx,y:node.out.y+dy}}:{})};
}
