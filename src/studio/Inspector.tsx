import type { KeyboardEvent, ReactNode } from "react";
import type { MessageKey } from "../i18n";

export type InspectorTab = "properties" | "layers";
const TABS: readonly InspectorTab[] = ["properties", "layers"];

interface InspectorProps {
  activeTab: InspectorTab;
  layerCount: number;
  properties: ReactNode;
  layers: ReactNode;
  footer: ReactNode;
  t: (key: MessageKey) => string;
  onTabChange: (tab: InspectorTab) => void;
}

/** Owns inspector tab semantics, keyboard navigation, panels, and shared footer. */
export function Inspector({ activeTab, layerCount, properties, layers, footer, t, onTabChange }: InspectorProps): JSX.Element {
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
    <div className="inspector-tabs" role="tablist" aria-label={t("inspectorPanels")}>
      {TABS.map((tab) => <button key={tab} id={`inspector-tab-${tab}`} role="tab"
        aria-selected={activeTab === tab} aria-controls={`inspector-panel-${tab}`} tabIndex={activeTab === tab ? 0 : -1}
        className={activeTab === tab ? "active" : ""} onClick={() => select(tab)} onKeyDown={(event) => onKeyDown(event, tab)}>
        {t(tab === "properties" ? "propertiesTab" : "layers")}{tab === "layers" && <span>{layerCount}</span>}
      </button>)}
    </div>
    {activeTab === "properties" && <section id="inspector-panel-properties" className="inspector-tabpanel properties-tab" role="tabpanel" aria-labelledby="inspector-tab-properties">{properties}</section>}
    {activeTab === "layers" && <section id="inspector-panel-layers" className="inspector-tabpanel layers-tab" role="tabpanel" aria-labelledby="inspector-tab-layers">{layers}</section>}
    <footer>{footer}</footer>
  </aside>;
}

export function nextInspectorTab(current: InspectorTab, key: string): InspectorTab | null {
  const index = TABS.indexOf(current);
  return key === "Home" ? TABS[0]
    : key === "End" ? TABS[TABS.length - 1]
    : key === "ArrowRight" ? TABS[(index + 1) % TABS.length]
    : key === "ArrowLeft" ? TABS[(index - 1 + TABS.length) % TABS.length]
    : null;
}
