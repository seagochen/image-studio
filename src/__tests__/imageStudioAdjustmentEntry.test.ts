import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("Image Studio adjustment layer entry", () => {
  const studio = readFileSync(resolve(__dirname, "../studio/Studio.tsx"), "utf8");
  const layerPanel = readFileSync(resolve(__dirname, "../studio/LayerPanel.tsx"), "utf8");
  const toolRail = readFileSync(resolve(__dirname, "../studio/ToolRail.tsx"), "utf8");
  const menu = readFileSync(resolve(__dirname, "../studio/AdjustmentMenu.tsx"), "utf8");
  const dialog = readFileSync(resolve(__dirname, "../studio/AdjustmentEditorDialog.tsx"), "utf8");
  const rasterDialog = readFileSync(resolve(__dirname, "../studio/RasterEditorDialog.tsx"), "utf8");
  const styles = readFileSync(resolve(__dirname, "../styles.css"), "utf8");

  it("requires an explicit adjustment type and opens it as a draft, not straight into the document", () => {
    expect(toolRail).toContain('onOpenRasterEditor("Adjust")');
    expect(layerPanel).toContain("<AdjustmentMenu");
    expect(layerPanel).toContain("onSelect={props.onCreateAdjustment}");
    expect(studio).toContain("onCreateAdjustment={createAdjustmentForSelection}");
    expect(menu).toContain("ADJUSTMENT_KINDS.map");
    expect(studio).toContain("setAdjustmentDraft({ layer, sourceLayerId })");
    expect(studio).not.toContain('createAdjustmentLayer(current, "exposure", t("adjustLayer")');
    expect(rasterDialog).toContain('type EditorMode = "adjust" | "filters"');
    expect(rasterDialog).toContain('["finetune", "adjust", t.finetune]');
  });

  it("renders the type menu in a viewport-level portal above clipped inspector panels", () => {
    expect(menu).toContain("createPortal(");
    expect(menu).toContain("window.document.body");
    expect(menu).toContain('className="layer-create-popover"');
    expect(styles).toContain(".layer-create-popover { position: fixed; z-index: 1000;");
    expect(menu).toContain('window.addEventListener("scroll", placeMenu, true)');
  });

  it("keeps hue, saturation and lightness inside the advanced adjustment editor", () => {
    const panel = readFileSync(resolve(__dirname, "../studio/AdjustmentPanel.tsx"), "utf8");
    expect(panel).toContain('"hue-saturation": [');
    expect(panel).toContain('{ key: "hue"');
    expect(panel).toContain('{ key: "saturation"');
    expect(panel).toContain('{ key: "lightness"');
  });

  it("keeps adjustment masks position-derived while allowing an ordinary layer to own one raster mask", () => {
    expect(studio).toContain("insertLayerAfter(current, selected.id, mask)");
    expect(studio).toContain('selected.type === "adjustment"');
    expect(studio).toContain("patchLayer(current, selected.id, { rasterMaskId: mask.id })");
    expect(studio).toContain('selected?.rasterMaskId');
  });

  it("uses one plus action to create a new drawing layer, rather than a standalone mask action", () => {
    expect(layerPanel.match(/<ProductIcon name="plus" \/>/g)).toHaveLength(1);
    expect(layerPanel).toContain('title={t("newLayer")}');
    expect(layerPanel).not.toContain('name="mask"');
    expect(studio).toContain('createDrawingLayer(current, "paint", t("newLayer"))');
  });

  it("applies conventional and perspective results to the selected raster", () => {
    expect(studio.match(/applyConventionalEditorOutcome\(current, selected\.id, outcome\)/g)).toHaveLength(2);
    expect(studio).not.toContain("Perspective result exceeds undo memory budget");
  });

  it("opens a popup dialog for a new adjustment layer, like the raster editor's, instead of the properties tab", () => {
    expect(studio).toContain("{adjustmentDraft && <AdjustmentEditorDialog");
    expect(dialog).toContain('className="pixel-editor-backdrop"');
    expect(dialog).toContain('className="pixel-editor no-nav"');
    expect(styles).toContain(".pixel-editor.no-nav { grid-template-columns: minmax(0, 1fr); }");
  });

  it("keeps or bakes the draft only once the dialog resolves, never mutating the document mid-edit", () => {
    expect(studio).toContain('if (outcome.kind === "keep") {');
    expect(studio).toContain("commit((current) => addLayer(current, outcome.layer), \"Add adjustment layer\")");
    expect(studio).toContain('else if (outcome.kind === "bake" && adjustmentDraft.sourceLayerId)');
    expect(studio).toContain("const bakeAdjustmentDraft = async (layer: AdjustmentLayer, sourceLayerId: string) => {");
  });

  it("bakes as an absolute, full-canvas composite and bails if the source layer changed mid-export", () => {
    expect(studio).toContain("if (documentRef.current.layers !== snapshot.layers) return;");
    expect(studio).toContain("resetPosition: true,");
  });

  it("blocks canvas shortcuts while the adjustment draft dialog is open", () => {
    expect(studio).toContain("fileBusy || adjustmentDraft) return;");
  });
});
