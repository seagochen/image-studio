import { renderToStaticMarkup } from "react-dom/server";
import { Inspector, nextInspectorTab } from "../studio/Inspector";

const t = (key: string) => ({ inspectorPanels: "Panels", propertiesTab: "Properties", layers: "Layers" }[key] ?? key);

describe("Image Studio inspector tabs", () => {
  it("keeps layers visible below the properties dock", () => {
    document.body.innerHTML = renderToStaticMarkup(<Inspector activeTab="properties" layerCount={2} t={t as any}
      onTabChange={jest.fn()} properties={<p data-testid="properties">properties</p>} layers={<p data-testid="layers">layers</p>} footer="history" />);
    expect(document.querySelector('[role="tablist"]')).not.toBeNull();
    expect(document.querySelector('#inspector-tab-properties')?.getAttribute("aria-selected")).toBe("true");
    expect(document.querySelector('#inspector-panel-properties [data-testid="properties"]')).not.toBeNull();
    expect(document.querySelector('#inspector-panel-layers [data-testid="layers"]')).not.toBeNull();
  });

  it("renders the layer count and retains properties when layers are selected", () => {
    document.body.innerHTML = renderToStaticMarkup(<Inspector activeTab="layers" layerCount={7} t={t as any}
      onTabChange={jest.fn()} properties="properties" layers={<p data-testid="layers">layers</p>} footer="history" />);
    expect(document.querySelector('#inspector-tab-layers')?.textContent).toContain("7");
    expect(document.querySelector('#inspector-tab-layers')?.getAttribute("aria-controls")).toBe("inspector-panel-layers");
    expect(document.querySelector('#inspector-panel-properties')).not.toBeNull();
    expect(document.querySelector('#inspector-panel-layers [data-testid="layers"]')).not.toBeNull();
  });

  it("shows history in the upper dock while keeping layers visible", () => {
    document.body.innerHTML = renderToStaticMarkup(<Inspector activeTab="history" layerCount={2} t={t as any}
      onTabChange={jest.fn()} properties="properties" history="History entries" layers="Layer entries" footer="status" />);
    expect(document.querySelector('#inspector-tab-history')?.getAttribute("aria-selected")).toBe("true");
    expect(document.querySelector('#inspector-panel-properties')).toBeNull();
    expect(document.querySelector('#inspector-panel-history')?.textContent).toBe("History entries");
    expect(document.querySelector('#inspector-panel-layers')?.textContent).toBe("Layer entries");
  });

  it("changes tabs through keyboard navigation", () => {
    expect(nextInspectorTab("properties", "ArrowRight")).toBe("history");
    expect(nextInspectorTab("history", "ArrowLeft")).toBe("properties");
    expect(nextInspectorTab("layers", "Home")).toBe("properties");
    expect(nextInspectorTab("properties", "End")).toBe("history");
    expect(nextInspectorTab("layers", "ArrowRight")).toBe("history");
    expect(nextInspectorTab("history", "ArrowRight")).toBe("properties");
    expect(nextInspectorTab("properties", "Enter")).toBeNull();
  });
});
