import type { Locale, MessageKey } from "../i18n";
import type { BrushSettings } from "../domain/brushEngine";
import type { SelectionOperation } from "../domain/pixelTools";
import { SELECTION_TOOLS, SHAPE_ICONS, SIZED_CURSOR_TOOLS, TOOL_ICONS, TOOL_LABELS, type ShapeTool, type Tool } from "./tools";
import { BRUSH_UI } from "./brushLayerLabels";
import { ProductIcon } from "./ProductIcon";
import { workbenchCopy } from "./workbenchCopy";

interface Props {
  tool: Tool; label: string; locale: Locale; t: (key: MessageKey) => string;
  color: string; onColor: (color: string) => void;
  size: number; onSize: (size: number) => void;
  brush: BrushSettings; onBrush: (brush: BrushSettings) => void;
  tolerance: number; onTolerance: (value: number) => void;
  selectionOperation: SelectionOperation; onSelectionOperation: (value: SelectionOperation) => void;
  shape: ShapeTool; onShape: (shape: ShapeTool) => void;
  /** Present only where the browser offers a screen-wide colour picker. */
  onPickScreen?: () => void;
}

export function ToolOptions(props: Props): JSX.Element {
  const { tool, locale, t, brush } = props;
  const brushTool = tool === "brush" || tool === "eraser" || tool === "airbrush";
  return <div className="tool-options" role="region" aria-label={props.label}>
    <span className="active-tool-label"><ProductIcon name={TOOL_ICONS[tool]} />{props.label}</span>
    <span className="toolbar-divider" />
    {!["hand", "select", ...SELECTION_TOOLS].includes(tool) && <label className="tool-option-color">{workbenchCopy[locale].foreground}<input type="color" value={props.color} aria-label={workbenchCopy[locale].foreground} onChange={(event) => props.onColor(event.target.value)} /></label>}
    {SIZED_CURSOR_TOOLS.includes(tool) && <label>{t("brushSize")}<input type="number" min="1" max="200" value={props.size} onChange={(event) => {
      const value = event.target.valueAsNumber;
      if (Number.isFinite(value)) props.onSize(Math.max(1, Math.min(200, Math.round(value))));
    }} />px</label>}
    {brushTool && <>
      <label>{BRUSH_UI[locale].opacity}<input type="range" min="0" max="1" step=".01" value={brush.opacity} onChange={(event) => props.onBrush({ ...brush, opacity: Number(event.target.value) })} /><output>{Math.round(brush.opacity * 100)}%</output></label>
      <label>{BRUSH_UI[locale].flow}<input type="range" min="0" max="1" step=".01" value={brush.flow} onChange={(event) => props.onBrush({ ...brush, flow: Number(event.target.value) })} /><output>{Math.round(brush.flow * 100)}%</output></label>
    </>}
    {SELECTION_TOOLS.includes(tool) && <label>{t("selectionOperation")}<select value={props.selectionOperation} onChange={(event) => props.onSelectionOperation(event.target.value as SelectionOperation)}>
      {(["replace", "add", "subtract", "intersect"] as SelectionOperation[]).map((operation) => <option key={operation} value={operation}>{t(`selection${operation[0].toUpperCase()}${operation.slice(1)}` as MessageKey)}</option>)}
    </select></label>}
    {tool === "magicWand" && <label>{t("tolerance")}<input type="number" min="0" max="255" value={props.tolerance} onChange={(event) => {
      const value = event.target.valueAsNumber;
      if (Number.isFinite(value)) props.onTolerance(Math.max(0, Math.min(255, Math.round(value))));
    }} /></label>}
    {tool === "select" && <span className="tool-option-hint">{workbenchCopy[locale].transformHint}</span>}
    {tool === "eyedropper" && <>
      <span className="tool-option-hint">{workbenchCopy[locale].eyedropperHint}</span>
      {props.onPickScreen && <button type="button" onClick={props.onPickScreen}>{workbenchCopy[locale].pickScreen}</button>}
    </>}
    {tool === "shape" && <label>{TOOL_LABELS[locale].shape}<select value={props.shape} onChange={(event) => props.onShape(event.target.value as ShapeTool)}>
      {(Object.keys(SHAPE_ICONS) as ShapeTool[]).map((shape) => <option key={shape} value={shape}>{TOOL_LABELS[locale][shape]}</option>)}
    </select></label>}
  </div>;
}
