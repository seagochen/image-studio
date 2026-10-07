import { layoutCopy } from "./layoutCopy";
import type { Locale } from "../i18n";
import { usePanelLayout } from "./usePanelLayout";
import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import type { MessageKey } from "../i18n";

export type InspectorTab = "properties" | "layers" | "history";
const TABS: readonly InspectorTab[] = ["properties", "history"];

interface InspectorProps {
  activeTab: InspectorTab;
  locale?: Locale;
  layerCount: number;
  properties: ReactNode;
  layers: ReactNode;
  history?: ReactNode;
  footer: ReactNode;
  t: (key: MessageKey) => string;
  onTabChange: (tab: InspectorTab) => void;
}

/** Properties/history share the upper dock; layers remain visible in the lower dock. */
export function Inspector({ activeTab, layerCount, properties, layers, history, footer, t, onTabChange, locale = "en" }: InspectorProps): JSX.Element {
  const [layout,setLayout] = usePanelLayout();
  const panelRef = useRef<HTMLElement>(null);
  useEffect(() => {panelRef.current?.parentElement?.style.setProperty("--studio-inspector-width", `${layout.width}px`);},[layout.width]);
  const resize = (event: React.PointerEvent<HTMLDivElement>, axis: "width" | "split") => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const bounds = panelRef.current?.getBoundingClientRect(); if (!bounds) return;
    setLayout(axis === "width" ? {width: bounds.right-event.clientX} : {split: (event.clientY-bounds.top)/bounds.height*100});
  };
  const upperTab = activeTab === "history" ? "history" : "properties";
  const select = (tab: InspectorTab, focus = false) => {
    onTabChange(tab);
    if (focus) window.requestAnimationFrame(() => document.getElementById(`inspector-tab-${tab}`)?.focus());
  };
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, current: InspectorTab) => {
    const next = nextInspectorTab(current, event.key);
    if (!next) return;
    event.preventDefault(); select(next, true);
  };
  return <aside ref={panelRef} className="inspector-panel" aria-label={t("inspectorPanels")}>
    <div className="inspector-width-handle" role="separator" tabIndex={0} aria-label={layoutCopy[locale].width} aria-orientation="vertical" aria-valuemin={240} aria-valuemax={480} aria-valuenow={layout.width}
      onPointerDown={event=>event.currentTarget.setPointerCapture(event.pointerId)} onPointerMove={event=>resize(event,"width")}
      onKeyDown={event=>{if(event.key==="ArrowLeft" || event.key==="ArrowRight"){event.preventDefault();setLayout({width:layout.width+(event.key==="ArrowLeft"?16:-16)});}}} />
    <div className="inspector-upper-dock" style={{flexBasis:`${layout.split}%`}}>
    <div className="inspector-tabs" role="tablist" aria-label={t("inspectorPanels")}>
      {TABS.map((tab) => <button key={tab} id={`inspector-tab-${tab}`} role="tab"
        aria-selected={upperTab === tab} aria-controls={`inspector-panel-${tab}`} tabIndex={upperTab === tab ? 0 : -1}
        className={upperTab === tab ? "active" : ""} onClick={() => select(tab)} onKeyDown={(event) => onKeyDown(event, tab)}>
        {t(tab === "properties" ? "propertiesTab" : tab)}
      </button>)}
    </div>
    {upperTab === "properties" && <section id="inspector-panel-properties" className="inspector-tabpanel properties-tab" role="tabpanel" aria-labelledby="inspector-tab-properties">{properties}</section>}
    {upperTab === "history" && <section id="inspector-panel-history" className="inspector-tabpanel" role="tabpanel" aria-labelledby="inspector-tab-history">{history}</section>}
    </div>
    <div className="inspector-split-handle" role="separator" tabIndex={0} aria-label={layoutCopy[locale].split} aria-orientation="horizontal" aria-valuemin={25} aria-valuemax={70} aria-valuenow={layout.split}
      onPointerDown={event=>event.currentTarget.setPointerCapture(event.pointerId)} onPointerMove={event=>resize(event,"split")}
      onKeyDown={event=>{if(event.key==="ArrowUp" || event.key==="ArrowDown"){event.preventDefault();setLayout({split:layout.split+(event.key==="ArrowUp"?-5:5)});}}} />
    <button id="inspector-tab-layers" className="layer-dock-heading" aria-controls="inspector-panel-layers" onClick={() => select("layers")}>{t("layers")}<span>{layerCount}</span></button>
    <section id="inspector-panel-layers" className="inspector-tabpanel layers-tab" aria-labelledby="inspector-tab-layers">{layers}</section>
    <footer>{footer}</footer>
  </aside>;
}

export function nextInspectorTab(current: InspectorTab, key: string): InspectorTab | null {
  const index = Math.max(0, TABS.indexOf(current));
  return key === "Home" ? TABS[0]
    : key === "End" ? TABS[TABS.length - 1]
    : key === "ArrowRight" ? TABS[(index + 1) % TABS.length]
    : key === "ArrowLeft" ? TABS[(index - 1 + TABS.length) % TABS.length]
    : null;
}
