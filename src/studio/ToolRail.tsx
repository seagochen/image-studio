import type { MouseEvent } from "react";
import type { MessageKey } from "../i18n";
import { ProductIcon } from "./ProductIcon";
import {
  BASIC_DRAWING_TOOLS, NAVIGATION_TOOLS, SECONDARY_TOOLS, SELECTION_TOOLS,
  SHAPE_ICONS, TOOL_ICONS, type ShapeTool, type Tool,
} from "./tools";

interface ToolRailProps {
  tool: Tool;
  shapeTool: ShapeTool;
  labels: Record<string, string>;
  toolLabel: (tool: Tool) => string;
  t: (key: MessageKey) => string;
  perspectiveLabel: string;
  rasterToolDisabled: boolean;
  oversizedRaster: boolean;
  canEditRaster: boolean;
  canUseAi: boolean;
  onActivate: (tool: Tool) => void;
  onShapeChange: (shape: ShapeTool) => void;
  onPickColor: () => void;
  onOpenRasterEditor: (mode: "Adjust" | "Filters" | "Perspective") => void;
  onOpenAi: () => void;
}

/** Owns the complete direct-tool presentation while Studio retains command orchestration. */
export function ToolRail(props: ToolRailProps): JSX.Element {
  const {
    tool, shapeTool, labels, toolLabel, t, perspectiveLabel, rasterToolDisabled,
    oversizedRaster, canEditRaster, canUseAi, onActivate, onShapeChange,
    onPickColor, onOpenRasterEditor, onOpenAi,
  } = props;
  const closeMenu = (event: MouseEvent<HTMLButtonElement>) => event.currentTarget.closest("details")?.removeAttribute("open");
  return <nav className="studio-toolrail" aria-label={t("tools")}
    onScroll={(event) => event.currentTarget.querySelectorAll("details[open]").forEach((menu) => menu.removeAttribute("open"))}>
    {NAVIGATION_TOOLS.map((name) => <ToolButton key={name} name={name} active={tool === name} label={toolLabel(name)}
      disabled={(name === "brush" || name === "eraser") && oversizedRaster} onClick={() => onActivate(name)} />)}
    <details className="toolrail-menu selection-menu" onToggle={positionToolMenu}>
      <summary className={SELECTION_TOOLS.includes(tool) ? "active" : ""} aria-label={labels.selection} title={labels.selection}>
        <ProductIcon name={SELECTION_TOOLS.includes(tool) ? TOOL_ICONS[tool] : TOOL_ICONS.marquee} />
      </summary>
      <div>{SELECTION_TOOLS.map((name) => <button key={name} className={tool === name ? "active" : ""}
        aria-label={toolLabel(name)} title={toolLabel(name)} disabled={rasterToolDisabled}
        onClick={(event) => { onActivate(name); closeMenu(event); }}><ProductIcon name={TOOL_ICONS[name]} /></button>)}</div>
    </details>
    {BASIC_DRAWING_TOOLS.map((name) => <ToolButton key={name} name={name} active={tool === name} label={toolLabel(name)}
      disabled={(name === "brush" || name === "eraser") && oversizedRaster}
      onClick={() => name === "eyedropper" ? onPickColor() : onActivate(name)} />)}
    <details className="toolrail-menu shape-menu" onToggle={positionToolMenu}>
      <summary className={tool === "shape" ? "active" : ""} aria-label={labels.shape} title={labels.shape}><ProductIcon name={TOOL_ICONS.shape} /></summary>
      <div>{(Object.keys(SHAPE_ICONS) as ShapeTool[]).map((name) => <button key={name} className={shapeTool === name ? "active" : ""}
        aria-label={labels[name]} title={labels[name]} onClick={(event) => { onShapeChange(name); onActivate("shape"); closeMenu(event); }}>
        <ProductIcon name={SHAPE_ICONS[name]} />
      </button>)}</div>
    </details>
    {SECONDARY_TOOLS.map((name) => <ToolButton key={name} name={name} active={tool === name} label={toolLabel(name)}
      disabled={rasterToolDisabled} onClick={() => onActivate(name)} />)}
    <div className="toolrail-divider" role="separator" aria-label={labels.advanced} />
    <AdvancedButton label={t("adjust")} icon="adjust" disabled={!canEditRaster} onClick={() => onOpenRasterEditor("Adjust")} />
    <AdvancedButton label={t("filters")} icon="filter" disabled={!canEditRaster} onClick={() => onOpenRasterEditor("Filters")} />
    <AdvancedButton label={perspectiveLabel} icon="perspective" disabled={!canEditRaster} onClick={() => onOpenRasterEditor("Perspective")} />
    <AdvancedButton label={t("aiEdit")} icon="sparkle" disabled={!canUseAi} onClick={onOpenAi} />
  </nav>;
}

function ToolButton({ name, active, label, disabled, onClick }: { name: Tool; active: boolean; label: string; disabled: boolean; onClick: () => void }): JSX.Element {
  return <button className={`tool-nav-button ${active ? "active" : ""}`} aria-label={label} title={label}
    aria-pressed={active} disabled={disabled} onClick={onClick}><ProductIcon name={TOOL_ICONS[name]} /></button>;
}

function AdvancedButton({ label, icon, disabled, onClick }: { label: string; icon: "adjust" | "filter" | "perspective" | "sparkle"; disabled: boolean; onClick: () => void }): JSX.Element {
  return <button className="tool-nav-button" aria-label={label} title={label} disabled={disabled} onClick={onClick}><ProductIcon name={icon} /></button>;
}

function positionToolMenu(event: { currentTarget: HTMLDetailsElement }): void {
  const menu = event.currentTarget;
  if (!menu.open) return;
  const panel = menu.querySelector("div"); if (!panel) return;
  const bounds = menu.getBoundingClientRect();
  panel.style.left = `${Math.min(window.innerWidth - panel.offsetWidth - 8, bounds.right + 9)}px`;
  panel.style.top = `${Math.max(8, Math.min(window.innerHeight - panel.offsetHeight - 8, bounds.top))}px`;
}
