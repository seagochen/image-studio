import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { LAYER_TRANSFORMER_PROPS } from "../studio/tools";

const styles = readFileSync(resolve(__dirname, "../styles.css"), "utf8");
const studio = readFileSync(resolve(__dirname, "../studio/Studio.tsx"), "utf8");

describe("canvas cursors and layer handles", () => {
  it("uses a T-shaped text cursor with a system text fallback (image-studio#27)", () => {
    const rule = styles.split("\n").find((line) => line.startsWith(".canvas-surface.tool-text"));
    expect(rule).toMatch(/cursor: url\("data:image\/svg\+xml,.*"\) 4 3, text;/);
    const crosshair = styles.split("\n").find((line) => line.includes("{ cursor: crosshair; }") && line.includes("tool-magicWand"));
    expect(styles).not.toMatch(/\.canvas-surface\.tool-text,[^{]*\{ cursor: crosshair; \}/);
    expect(crosshair).toBeDefined();
  });

  it("scales freely by default, stretches from edge anchors and keeps ratio with Shift (image-studio#24)", () => {
    expect(LAYER_TRANSFORMER_PROPS).toMatchObject({ keepRatio: false, shiftBehavior: "default", rotateEnabled: true });
    expect(LAYER_TRANSFORMER_PROPS.enabledAnchors).toEqual(expect.arrayContaining(["top-center", "bottom-center", "middle-left", "middle-right", "top-left", "bottom-right"]));
    expect(studio.match(/<Transformer ref=\{transformerRef\} \{\.\.\.LAYER_TRANSFORMER_PROPS\} \/>/g)).toHaveLength(2);
  });
});
