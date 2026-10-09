import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const styles = readFileSync(resolve(__dirname, "../styles.css"), "utf8");

describe("canvas cursors and layer handles", () => {
  it("uses a T-shaped text cursor with a system text fallback (image-studio#27)", () => {
    const rule = styles.split("\n").find((line) => line.startsWith(".canvas-surface.tool-text"));
    expect(rule).toMatch(/cursor: url\("data:image\/svg\+xml,.*"\) 4 3, text;/);
    const crosshair = styles.split("\n").find((line) => line.includes("{ cursor: crosshair; }") && line.includes("tool-magicWand"));
    expect(styles).not.toMatch(/\.canvas-surface\.tool-text,[^{]*\{ cursor: crosshair; \}/);
    expect(crosshair).toBeDefined();
  });
});
