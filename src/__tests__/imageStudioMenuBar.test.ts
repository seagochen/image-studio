import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileCopy } from "../studio/fileCopy";

describe("Image Studio desktop menu bar", () => {
  const menu = readFileSync(resolve(__dirname, "../studio/FileMenu.tsx"), "utf8");
  const studio = readFileSync(resolve(__dirname, "../studio/Studio.tsx"), "utf8");

  it("provides localized File, Edit, View and Settings top-level menus", () => {
    expect(fileCopy.en).toMatchObject({ file: "File", edit: "Edit", view: "View", settings: "Settings" });
    expect(fileCopy.ja).toMatchObject({ file: "ファイル", edit: "編集", view: "表示", settings: "設定" });
    expect(fileCopy["zh-CN"]).toMatchObject({ file: "文件", edit: "编辑", view: "视图", settings: "设置" });
    expect(fileCopy["zh-TW"]).toMatchObject({ file: "檔案", edit: "編輯", view: "檢視", settings: "設定" });
    expect(menu).toContain('const MENUS: MenuName[] = ["file", "edit", "layer", "selection", "adjustments", "filters", "view", "settings"]');
    expect(menu).toContain('role="menubar"');
  });

  it("exposes the required nested actions and keyboard navigation", () => {
    for (const action of ["onNew", "onOpen", "onImport", "onSave", "onExport", "onSettings",
      "onUndo", "onRedo", "onDuplicate", "onDelete", "onZoomIn", "onZoomOut", "onActualSize", "onFit", "onToggleNavigator"]) {
      expect(menu).toContain(`props.${action}`);
    }
    expect(menu).toContain('type SubmenuName = "projects" | "import" | "export"');
    expect(menu).toContain('submenu("import", "import", t.import');
    expect(menu).toContain('accept="image/png,image/jpeg,.png,.jpg,.jpeg"');
    expect(menu).toContain('accept=".ora,image/openraster"');
    expect(menu).toContain('document.addEventListener("pointerdown", outside)');
    expect(menu).toContain('document.addEventListener("focusin", outside)');
    expect(menu).toContain('event.key === "Escape"');
    expect(menu).toContain('event.key === "ArrowRight"');
    expect(menu).toContain('event.key === "ArrowLeft"');
    expect(menu).toContain('event.key === "ArrowDown"');
  });

  it("labels the two import choices and the support ticket action", () => {
    expect(fileCopy.en).toMatchObject({ importImage: "Image (PNG, JPG)", importOpenRaster: "OpenRaster (.ora)" });
    expect(fileCopy["zh-CN"]).toMatchObject({ importImage: "图片（PNG、JPG）", importOpenRaster: "OpenRaster（.ora）" });
    expect(studio).toContain('<span>{t("submitTicket")}</span>');
  });

  it("offers the API Key settings only in standalone mode", () => {
    expect(menu).toContain('{props.onApiKey && row("key", t.apiKey, props.onApiKey)}');
    expect(studio).toContain("onApiKey={standalone ? () => setApiKeyOpen(true) : undefined}");
  });

  it("reports manual save results with a five-second toast", () => {
    expect(studio).toContain("const manuallySaveProject = async () =>");
    expect(studio).toContain('t(saved ? "saveSucceeded" : "saveFailed")');
    expect(studio).toContain("window.setTimeout(() => setSaveToast(null), 5000)");
    expect(studio).toContain('studio-toast-${saveToast.kind}');
    expect(studio).toContain('role={saveToast.kind === "error" ? "alert" : "status"}');
    expect(studio).toContain("onSave={() => void manuallySaveProject()}");
  });

  it("shares command and navigator state with the existing workspace controls", () => {
    expect(studio).toContain("onUndo={undoDocument} onRedo={redoDocument}");
    expect(studio).toContain("onClick={undoDocument}");
    expect(studio).toContain("onClick={redoDocument}");
    expect(studio).toContain("navigatorVisible={!navigatorCollapsed}");
    expect(studio).toContain("collapsed={navigatorCollapsed} onCollapsedChange={setNavigatorCollapsed}");
  });
});
