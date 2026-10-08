import { renderToStaticMarkup } from "react-dom/server";
import { ToolRail } from "../studio/ToolRail";
import { BASIC_DRAWING_TOOLS, SECONDARY_TOOLS, SELECTION_TOOLS, type Tool } from "../studio/tools";

const labels = Object.fromEntries([
  "selection", "shape", "advanced", "marquee", "magicWand", "rect", "ellipse", "star", "polygon", "line", "arrow",
].map((key) => [key, key]));
function render(tool: Tool = "select", overrides: Partial<React.ComponentProps<typeof ToolRail>> = {}): HTMLElement {
  document.body.innerHTML = renderToStaticMarkup(<ToolRail
    tool={tool} shapeTool="rect" labels={labels} toolLabel={(name) => name} t={(key) => key}
    perspectiveLabel="perspective" brushBlocker={null} rasterToolBlocker={null} selectionToolBlocker={null} magicWandBlocker={null} rasterEditBlocker={null} aiBlocker={null}
    onActivate={jest.fn()} onShapeChange={jest.fn()} onPickColor={jest.fn()}
    onOpenRasterEditor={jest.fn()} onOpenAi={jest.fn()} {...overrides} />);
  return document.body;
}

describe("Image Studio direct toolrail", () => {
  it("renders every direct drawing and selection tool with accessible names", () => {
    const root = render();
    for (const tool of [...BASIC_DRAWING_TOOLS, ...SECONDARY_TOOLS, ...SELECTION_TOOLS]) {
      expect(root.querySelector(`[aria-label="${tool}"]`)).not.toBeNull();
    }
    expect(root.querySelector('[aria-label="eyedropper"]')).not.toBeNull();
    expect(root.querySelector('[aria-label="freehand"]')).toBeNull();
  });

  it("marks the active tool and disables raster-only actions when no editable raster exists", () => {
    const root = render("brush", { brushBlocker: "too large", rasterToolBlocker: "raster only", selectionToolBlocker: "no layer", magicWandBlocker: "raster only", rasterEditBlocker: "raster only", aiBlocker: "save first" });
    expect(root.querySelector('[aria-label="brush"]')?.getAttribute("aria-pressed")).toBe("true");
    expect((root.querySelector('[aria-label="brush"]') as HTMLButtonElement).disabled).toBe(true);
    expect((root.querySelector('[aria-label="magicWand"]') as HTMLButtonElement).disabled).toBe(true);
    expect((root.querySelector('[aria-label="adjust"]') as HTMLButtonElement).disabled).toBe(true);
    expect((root.querySelector('[aria-label="aiEdit"]') as HTMLButtonElement).disabled).toBe(true);
  });

  it("explains in the tooltip why a tool is disabled", () => {
    const root = render("select", { aiBlocker: "save first" });
    expect(root.querySelector('[aria-label="aiEdit"]')?.getAttribute("title")).toBe("aiEdit\nsave first");
    expect(root.querySelector('[aria-label="adjust"]')?.getAttribute("title")).toBe("adjust");
  });

  it("exposes explicit advanced editor actions without a nested advanced menu", () => {
    const root = render();
    expect(root.querySelector('[aria-label="adjust"]')).not.toBeNull();
    expect(root.querySelector('[aria-label="filters"]')).not.toBeNull();
    expect(root.querySelector('[aria-label="perspective"]')).not.toBeNull();
    expect(root.querySelector(".advanced-menu")).toBeNull();
  });
});
