import { pathCopy } from "./CanvasPathEditor";
import { filterCopy } from "./LayerFiltersPanel";
import { layoutCopy } from "./layoutCopy";
import { selectionRefinementCopy } from "./SelectionRefinementPanel";
// Registry of every per-locale text catalog used across Image Studio (Issue #165):
// tools, brushes, layers, file menu, perspective correction, properties, adjustments and
// the conventional raster editor each own their catalog file/section, but all of them are
// listed here once so a single completeness check (see __tests__/i18nCompleteness.test.ts)
// covers the whole app instead of relying on each feature to remember to test itself.
import { CORE_LABELS } from "../i18n";
import { PROPERTY_LABELS } from "./propertyLabels";
import { TOOL_LABELS } from "./tools";
import { fileCopy } from "./fileCopy";
import { perspectiveCopy } from "./perspectiveCopy";
import { RASTER_EDITOR_COPY } from "./RasterEditorDialog";
import { BRUSH_UI, BRUSH_PRESET_LABELS, LAYER_UI } from "./brushLayerLabels";
import { ADJUSTMENT_KIND_LABELS, PANEL_LABELS, CONTROL_LABELS, COLOR_RANGE_LABELS } from "./AdjustmentPanel";
import { quickTransformCopy, selectionCommandCopy, workbenchCopy } from "./workbenchCopy";

import { editingCopy } from "./editingCopy";
import { disabledReasonCopy } from "./disabledReasons";

export const IMAGE_STUDIO_LOCALE_CATALOGS: Record<string, Record<string, Record<string, string>>> = {
  selectionRefinement: selectionRefinementCopy,
  layout: layoutCopy,
  paths: pathCopy,
  filters: filterCopy,
  editing: editingCopy,
  disabledReason: disabledReasonCopy,
  core: CORE_LABELS,
  property: PROPERTY_LABELS,
  tool: TOOL_LABELS,
  file: fileCopy,
  perspective: perspectiveCopy,
  rasterEditor: RASTER_EDITOR_COPY,
  brush: BRUSH_UI,
  brushPreset: BRUSH_PRESET_LABELS,
  layer: LAYER_UI,
  adjustmentKind: ADJUSTMENT_KIND_LABELS,
  adjustmentPanel: PANEL_LABELS,
  adjustmentControl: CONTROL_LABELS,
  adjustmentColorRange: COLOR_RANGE_LABELS,
  workbench: workbenchCopy,
  quickTransform: quickTransformCopy,
  selectionCommand: selectionCommandCopy,
};
