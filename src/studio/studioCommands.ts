import type { EditorCommand } from "../domain/editorCommands";
import { ADJUSTMENT_KINDS, type AdjustmentKind } from "../domain/document";
import type { MessageKey } from "../i18n";
import { TOOL_ICONS, TOOL_LABELS, type Tool } from "./tools";
import type { InspectorTab } from "./Inspector";
import type { Locale } from "../i18n";
import { workbenchCopy } from "./workbenchCopy";

export interface StudioCommandContext {
  locale: Locale;
  t: (key: MessageKey) => string;
  toolLabel: (tool: Tool) => string;
  toolEnabled: (tool: Tool) => boolean;
  toolShortcut: (tool: Tool) => string | undefined;
  activateTool: (tool: Tool) => void;
  selectPanel: (panel: InspectorTab) => void;
  adjustmentLabels: Record<AdjustmentKind, string>;
  createAdjustment: (kind: AdjustmentKind) => void;
  actions: Record<string, { label: string; enabled: boolean; run: () => void; shortcut?: string }>;
}

export function studioCommands(context: StudioCommandContext): EditorCommand[] {
  const copy = workbenchCopy[context.locale];
  const categories: Record<string, string> = { file: copy.file, edit: copy.edit, view: copy.view, layer: context.t("layers"), selection: TOOL_LABELS[context.locale].selection, filter: context.t("filters") };
  return [
    ...Object.entries(context.actions).map(([id, action]) => ({ id, category: categories[id.split(".")[0]] ?? copy.edit, ...action })),
    ...(Object.keys(TOOL_ICONS) as Tool[]).map((tool) => ({
      id: `tool.${tool}`, label: context.toolLabel(tool), category: copy.tools,
      keywords: TOOL_LABELS.en[tool as keyof typeof TOOL_LABELS.en] ?? tool,
      enabled: context.toolEnabled(tool), shortcut: context.toolShortcut(tool), run: () => context.activateTool(tool),
    })),
    ...(["properties", "layers", "history"] as InspectorTab[]).map((panel) => ({
      id: `panel.${panel}`, label: context.t(panel === "properties" ? "propertiesTab" : panel), category: copy.panels,
      enabled: true, run: () => context.selectPanel(panel),
    })),
    ...ADJUSTMENT_KINDS.map((kind) => ({
      id: `adjustment.${kind}`, label: context.adjustmentLabels[kind], category: copy.adjustments,
      enabled: context.actions["edit.newAdjustment"].enabled, run: () => context.createAdjustment(kind),
    })),
  ];
}
