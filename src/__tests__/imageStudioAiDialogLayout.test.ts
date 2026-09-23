import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("Image Studio AI editor layout", () => {
  const dialog = readFileSync(resolve(__dirname, "../ai/AiEditDialog.tsx"), "utf8");
  const styles = readFileSync(resolve(__dirname, "../styles.css"), "utf8");

  it("places mode navigation, preview and parameters in the shared three-column structure", () => {
    const mainStart = dialog.indexOf("<main>");
    const parameterPanel = dialog.indexOf("<aside>", mainStart);
    const mainEnd = dialog.indexOf("</main>", mainStart);

    expect(dialog).toContain('className="pixel-editor ai-editor"');
    expect(dialog.indexOf("<nav>")).toBeGreaterThan(-1);
    expect(mainStart).toBeGreaterThan(-1);
    expect(parameterPanel).toBeGreaterThan(mainStart);
    expect(parameterPanel).toBeLessThan(mainEnd);
    expect(styles).toContain(".pixel-editor > main { min-width: 0; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) 280px;");
  });
});
