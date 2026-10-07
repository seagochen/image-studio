import type { KeyboardEvent, ReactNode } from "react";
import type { MessageKey } from "../i18n";

export type InspectorTab = "properties" | "layers" | "history";
const TABS: readonly InspectorTab[] = ["properties", "history"];

interface InspectorProps {
  activeTab: InspectorTab;
  layerCount: number;
  properties: ReactNode;
  layers: ReactNode;
  history?: ReactNode;
  footer: ReactNode;
  t: (key: MessageKey) => string;
  onTabChange: (tab: InspectorTab) => void;
}

/** Properties/history share the upper dock; layers remain visible in the lower dock. */
export function Inspector({ activeTab, layerCount, properties, layers, history, footer, t, onTabChange }: InspectorProps): JSX.Element {
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
  return <aside className="inspector-panel" aria-label={t("inspectorPanels")}>
    <div className="inspector-upper-dock">
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
