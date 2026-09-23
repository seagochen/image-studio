import { clampNavigatorPosition } from "../studio/navigatorPosition";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("Image Studio navigator panel position", () => {
  it("keeps a dragged panel inside the canvas surface", () => {
    expect(clampNavigatorPosition({ x: 40, y: 60 }, { width: 900, height: 600 }, { width: 224, height: 210 }))
      .toEqual({ x: 40, y: 60 });
    expect(clampNavigatorPosition({ x: -30, y: -10 }, { width: 900, height: 600 }, { width: 224, height: 210 }))
      .toEqual({ x: 0, y: 0 });
    expect(clampNavigatorPosition({ x: 850, y: 590 }, { width: 900, height: 600 }, { width: 224, height: 210 }))
      .toEqual({ x: 676, y: 390 });
  });

  it("pins an oversized panel to the surface origin", () => {
    expect(clampNavigatorPosition({ x: 20, y: 20 }, { width: 120, height: 80 }, { width: 224, height: 210 }))
      .toEqual({ x: 0, y: 0 });
  });

  it("keeps panel dragging separate from viewport dragging and exposes a titled frame", () => {
    const component = readFileSync(resolve(__dirname, "../studio/Navigator.tsx"), "utf8");
    const styles = readFileSync(resolve(__dirname, "../styles.css"), "utf8");

    expect(component).toContain('className="navigator-titlebar"');
    expect(component).toContain("onPointerDown={startPanelDrag}");
    expect(component).toContain('className="navigator-body"');
    expect(component).toContain("draggingRef.current = true; panTo");
    expect(component).toContain("Math.round(viewport.scale * 100)");
    expect(component).toContain("[preview, navWidth, navHeight, collapsed]");
    expect(styles).toContain(".navigator-panel { position: absolute;");
    expect(styles).toContain("border: 1px solid #cfd5df");
  });
});
