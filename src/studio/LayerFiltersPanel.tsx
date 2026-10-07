import { useState } from "react";
import type { ImageStudioLayer, LayerFilter, AdjustmentKind, AdjustmentLayer } from "../domain/document";
import { ADJUSTMENT_KINDS, createId } from "../domain/document";
import { defaultAdjustment } from "../domain/adjustmentEngine";
import type { Locale } from "../i18n";
import { AdjustmentPanel, ADJUSTMENT_KIND_LABELS } from "./AdjustmentPanel";
const en={title:"Live filters",add:"Add filter",blur:"Blur",sharpen:"Sharpen",radius:"Radius",amount:"Amount",opacity:"Opacity",up:"Move up",down:"Move down",remove:"Remove",mask:"Use current selection as mask",clearMask:"Remove filter mask",masked:"Selection mask"};
export const filterCopy:Record<Locale,typeof en>={en,
 "zh-CN":{title:"可编辑滤镜",add:"添加滤镜",blur:"模糊",sharpen:"锐化",radius:"半径",amount:"强度",opacity:"不透明度",up:"上移",down:"下移",remove:"移除",mask:"使用当前选区作为蒙版",clearMask:"移除滤镜蒙版",masked:"选区蒙版"},
 "zh-TW":{title:"可編輯濾鏡",add:"新增濾鏡",blur:"模糊",sharpen:"銳化",radius:"半徑",amount:"強度",opacity:"不透明度",up:"上移",down:"下移",remove:"移除",mask:"使用目前選取作為遮罩",clearMask:"移除濾鏡遮罩",masked:"選取遮罩"},
 ja:{title:"編集可能なフィルター",add:"フィルターを追加",blur:"ぼかし",sharpen:"シャープ",radius:"半径",amount:"強度",opacity:"不透明度",up:"上へ",down:"下へ",remove:"削除",mask:"選択範囲をマスクに使用",clearMask:"フィルターマスクを削除",masked:"選択マスク"}};
export function LayerFiltersPanel({layer,locale,disabled,selectionRuns,onChange}: {
 layer:ImageStudioLayer;locale:Locale;disabled:boolean;selectionRuns?:()=>number[]|undefined;onChange:(filters:LayerFilter[])=>void;
}):JSX.Element|null {
 const [kind,setKind]=useState<AdjustmentKind|"blur"|"sharpen">("blur"),[useMask,setUseMask]=useState(false),[error,setError]=useState(false);
 if(!["raster","paint","annotation"].includes(layer.type))return null;
 const filters=layer.filters??[],copy=filterCopy[locale];
 const patch=(id:string,recipe:(filter:LayerFilter)=>LayerFilter)=>onChange(filters.map(filter=>filter.id===id?recipe(filter):filter));
 const reorder=(index:number,delta:number)=>{const next=[...filters];[next[index],next[index+delta]]=[next[index+delta],next[index]];onChange(next);};
 return <fieldset className="layer-filters-panel" disabled={disabled}><legend>{copy.title}</legend>
 <div className="filter-add"><select aria-label={copy.title} value={kind} onChange={event=>setKind(event.target.value as typeof kind)}><option value="blur">{copy.blur}</option><option value="sharpen">{copy.sharpen}</option>{ADJUSTMENT_KINDS.map(kind=><option key={kind} value={kind}>{ADJUSTMENT_KIND_LABELS[locale][kind]}</option>)}</select>
 <button disabled={filters.length>=8 || useMask&&!selectionRuns} onClick={()=>{try{const base={id:createId("filter"),enabled:true,opacity:1,maskRuns:useMask?selectionRuns?.():undefined};onChange([...filters,kind==="blur"?{...base,kind,radius:4}:kind==="sharpen"?{...base,kind,amount:.5}:{...base,kind:"adjustment",adjustment:defaultAdjustment(kind)}]);setError(false);}catch{setError(true);}}}>{copy.add}</button></div>
 <label><input type="checkbox" checked={useMask} disabled={!selectionRuns&&!useMask} onChange={event=>setUseMask(event.target.checked)} />{copy.mask}</label>
 {error&&<p role="alert">{copy.mask}</p>}
 {filters.map((filter,index)=><details key={filter.id} className="live-filter"><summary><input aria-label={filter.kind==="adjustment"?ADJUSTMENT_KIND_LABELS[locale][filter.adjustment.kind]:copy[filter.kind]} type="checkbox" checked={filter.enabled} onChange={event=>patch(filter.id,current=>({...current,enabled:event.target.checked}))} />{filter.kind==="adjustment"?ADJUSTMENT_KIND_LABELS[locale][filter.adjustment.kind]:copy[filter.kind]}{filter.maskRuns&&<small>{copy.masked}</small>}</summary>
 <div className="filter-actions"><button disabled={index===0} onClick={()=>reorder(index,-1)}>{copy.up}</button><button disabled={index===filters.length-1} onClick={()=>reorder(index,1)}>{copy.down}</button><button onClick={()=>onChange(filters.filter(candidate=>candidate.id!==filter.id))}>{copy.remove}</button></div>
 <label>{copy.opacity}<input type="range" min="0" max="1" step=".01" value={filter.opacity} onChange={event=>patch(filter.id,current=>({...current,opacity:Number(event.target.value)}))} /></label>
 {filter.kind==="adjustment"?<AdjustmentPanel layer={{...layer,type:"adjustment",adjustment:filter.adjustment} as AdjustmentLayer} locale={locale} onChange={adjustment=>patch(filter.id,current=>({...current,kind:"adjustment",adjustment}))} />:<label>{filter.kind==="blur"?copy.radius:copy.amount}<input type="number" min="0" max={filter.kind==="blur"?32:2} step=".1" value={filter.kind==="blur"?filter.radius:filter.amount} onChange={event=>{const value=event.target.valueAsNumber;if(Number.isFinite(value))patch(filter.id,current=>current.kind==="blur"?{...current,radius:Math.max(0,Math.min(32,value))}:current.kind==="sharpen"?{...current,amount:Math.max(0,Math.min(2,value))}:current);}} /></label>}
 {filter.maskRuns&&<button onClick={()=>patch(filter.id,current=>({...current,maskRuns:undefined}))}>{copy.clearMask}</button>}
 </details>)}
 </fieldset>;
}
