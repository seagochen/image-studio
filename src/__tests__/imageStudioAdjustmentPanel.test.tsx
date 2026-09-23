import { renderToStaticMarkup } from "react-dom/server";
import { AdjustmentPanel } from "../studio/AdjustmentPanel";
import { createEmptyDocument } from "../domain/document";
import { createAdjustmentLayer } from "../domain/adjustmentEngine";

// The keep/bake decision now happens up front in AdjustmentEditorDialog, before a draft layer
// ever reaches the document — AdjustmentPanel only renders parameter controls for a settled layer.
describe("Image Studio adjustment panel", () => {
  const document = createEmptyDocument();
  const layer = createAdjustmentLayer(document, "hue-saturation", "Hue / Saturation");

  function render(): string {
    return renderToStaticMarkup(<AdjustmentPanel layer={layer} locale="en" onChange={() => {}} />);
  }

  it("no longer offers an inline kind picker, mask picker, or pending resolution", () => {
    const html = render();
    expect(html).not.toContain("<select");
    expect(html).not.toContain(">Mask<");
    expect(html).not.toContain("adjustment-pending-actions");
  });

  it("renders a numeric control per parameter for the selected kind", () => {
    const html = render();
    expect(html).toContain(">Hue<");
    expect(html).toContain(">Saturation<");
    expect(html).toContain(">Lightness<");
  });
});
