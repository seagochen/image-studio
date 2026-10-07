import { useEffect, useState } from "react";
const KEY = "image-studio.panel-layout.v1";
export interface PanelLayout { width: number; split: number }
export function normalizePanelLayout(value: Partial<PanelLayout>): PanelLayout {
  return {width: Number.isFinite(value.width) ? Math.max(240,Math.min(480,value.width!)) : 320,
    split: Number.isFinite(value.split) ? Math.max(25,Math.min(70,value.split!)) : 46};
}
export function usePanelLayout() {
  const [layout,setLayout] = useState<PanelLayout>(() => {
    try {return normalizePanelLayout(JSON.parse(localStorage.getItem(KEY) ?? "{}"));} catch {return normalizePanelLayout({});}
  });
  useEffect(() => {try {localStorage.setItem(KEY,JSON.stringify(layout));} catch {}},[layout]);
  return [layout,(next:Partial<PanelLayout>)=>setLayout(current=>normalizePanelLayout({...current,...next}))] as const;
}
