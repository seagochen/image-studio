import { useState } from "react";
import type { Locale } from "../i18n";
import { refineSelection, type SelectionRefinement } from "../domain/selectionRefinement";
import type { SelectionArchive } from "../domain/document";
import type { PixelSelection } from "./tools";
const labels = {
 en: {expand:"Expand",contract:"Contract",smooth:"Smooth",radius:"Radius",store:"Store selection",restore:"Restore selection",remove:"Delete stored selection"},
 "zh-CN": {expand:"扩展",contract:"收缩",smooth:"平滑",radius:"半径",store:"存档选区",restore:"恢复选区",remove:"删除选区存档"},
 "zh-TW": {expand:"擴展",contract:"收縮",smooth:"平滑",radius:"半徑",store:"儲存選取",restore:"恢復選取",remove:"刪除選取存檔"},
 ja: {expand:"拡張",contract:"縮小",smooth:"滑らかに",radius:"半径",store:"選択範囲を保存",restore:"選択範囲を復元",remove:"保存した選択範囲を削除"},
};
export function SelectionRefinementPanel({selection,archives,locale,onChange,onStore,onRestore,onRemove}: {
 selection:PixelSelection|null;archives:SelectionArchive[];locale:Locale;onChange:(next:PixelSelection)=>void;
 onStore:()=>void;onRestore:(archive:SelectionArchive)=>void;onRemove:(id:string)=>void;
}):JSX.Element {
 const [radius,setRadius]=useState(1),[savedId,setSavedId]=useState("");const copy=labels[locale],saved=archives.find(archive=>archive.id===savedId);
 return <div className="selection-refinement"><label>{copy.radius}<input type="number" min="1" max="128" value={radius} onChange={event=>{const n=event.target.valueAsNumber;if(Number.isFinite(n))setRadius(Math.max(1,Math.min(128,Math.round(n))));}} /></label>
 {(["expand","contract","smooth"] as SelectionRefinement[]).map(operation=><button key={operation} disabled={!selection} onClick={()=>selection&&onChange({...selection,...refineSelection(selection,operation,radius)})}>{copy[operation]}</button>)}
 <button disabled={!selection || archives.length>=32} onClick={onStore}>{copy.store}</button>
 <select aria-label={copy.restore} value={savedId} onChange={event=>setSavedId(event.target.value)}><option value="">—</option>{archives.map(archive=><option key={archive.id} value={archive.id}>{archive.name}</option>)}</select>
 <button disabled={!saved} onClick={()=>saved&&onRestore(saved)}>{copy.restore}</button><button disabled={!saved} aria-label={copy.remove} onClick={()=>saved&&onRemove(saved.id)}>×</button>
 </div>;
}
export const selectionRefinementCopy = labels;
