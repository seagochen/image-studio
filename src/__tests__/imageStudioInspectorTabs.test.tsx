import { renderToStaticMarkup } from "react-dom/server";
import { Inspector, nextInspectorTab } from "../studio/Inspector";

const t = (key: string) => ({ inspectorPanels: "Panels", propertiesTab: "Properties", layers: "Layers" }[key] ?? key);

describe("Image Studio inspector tabs", () => {
  it("renders only the active panel with accessible tab relationships", () => {
    document.body.innerHTML = renderToStaticMarkup(<Inspector activeTab="properties" layerCount={2} t={t as any}
      onTabChange={jest.fn()} properties={<p data-testid="properties">properties</p>} layers={<p data-testid="layers">layers</p>} footer="history" />);
    expect(document.querySelector('[role="tablist"]')).not.toBeNull();
    expect(document.querySelector('#inspector-tab-properties')?.getAttribute("aria-selected")).toBe("true");
    expect(document.querySelector('#inspector-panel-properties [data-testid="properties"]')).not.toBeNull();
    expect(document.querySelector('#inspector-panel-layers')).toBeNull();
  });

  it("renders the layer count and layer panel when selected", () => {
    document.body.innerHTML = renderToStaticMarkup(<Inspector activeTab="layers" layerCount={7} t={t as any}
      onTabChange={jest.fn()} properties="properties" layers={<p data-testid="layers">layers</p>} footer="history" />);
    expect(document.querySelector('#inspector-tab-layers')?.textContent).toContain("7");
    expect(document.querySelector('#inspector-tab-layers')?.getAttribute("tabindex")).toBe("0");
    expect(document.querySelector('#inspector-panel-layers [data-testid="layers"]')).not.toBeNull();
  });

  it("changes tabs through keyboard navigation", () => {
    expect(nextInspectorTab("properties", "ArrowRight")).toBe("layers");
    expect(nextInspectorTab("layers", "ArrowLeft")).toBe("properties");
    expect(nextInspectorTab("layers", "Home")).toBe("properties");
    expect(nextInspectorTab("properties", "End")).toBe("layers");
    expect(nextInspectorTab("properties", "Enter")).toBeNull();
  });
});
