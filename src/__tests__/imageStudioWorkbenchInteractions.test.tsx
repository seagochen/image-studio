import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { FileMenu } from "../studio/FileMenu";
import { fileCopy } from "../studio/fileCopy";
import { HistoryPanel } from "../studio/HistoryPanel";

type FileMenuProps = React.ComponentProps<typeof FileMenu>;
function fileMenuProps(overrides: Partial<FileMenuProps> = {}): FileMenuProps {
  return {
    title: "Doc", copy: fileCopy.en,
    projects: [{ id: "p", title: "Saved", documentVersion: 14, revision: 1,
      createdAt: "2026-10-08T00:00:00Z", updatedAt: "2026-10-08T00:00:00Z" }],
    busy: false, canExport: true, canSave: true, canUndo: true, canRedo: true,
    canDuplicate: true, canDelete: true, canPaste: true, canZoomIn: true,
    canZoomOut: true, navigatorVisible: false, cacheStatus: "",
    shortcuts: { undo: "Mod+z", redo: "Mod+Shift+z", fit: "Mod+0" },
    onRename: jest.fn(async () => true), onNew: jest.fn(), onOpen: jest.fn(),
    onImport: jest.fn(), onSave: jest.fn(), onExport: jest.fn(), onSettings: jest.fn(),
    onClearLocalCache: jest.fn(), onUndo: jest.fn(), onRedo: jest.fn(),
    onDuplicate: jest.fn(), onDelete: jest.fn(), onCopy: jest.fn(), onCut: jest.fn(),
    onPaste: jest.fn(), onZoomIn: jest.fn(), onZoomOut: jest.fn(),
    onActualSize: jest.fn(), onFit: jest.fn(), onToggleNavigator: jest.fn(),
    ...overrides,
  };
}

describe("workbench interactions", () => {
  let host: HTMLDivElement, root: Root;
  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    (globalThis as any).HTMLIFrameElement = document.defaultView!.HTMLIFrameElement;
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
  it("keeps a project submenu open when clicking after hovering", async () => {
    const onOpen = jest.fn();
    const props = fileMenuProps({ onOpen });
    await act(async () => root.render(<FileMenu {...props} />));
    await act(async () => (host.querySelector(".studio-menu-trigger") as HTMLButtonElement).click());
    const submenu = host.querySelector(".studio-menu-submenu")!;
    await act(async () => submenu.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
    await act(async () => (submenu.querySelector("button") as HTMLButtonElement).click());
    const project = host.querySelector('.studio-menu-submenu-panel[data-submenu="projects"] button') as HTMLButtonElement;
    expect(project.textContent).toContain("Saved");
    await act(async () => project.click()); expect(onOpen).toHaveBeenCalledWith("p");
  });
  it("maps past and future history rows to absolute positions and blocks restore while busy", async () => {
    const onSeek = jest.fn();
    const props = { timeline: {undo:["Open", "Paint"],redo:["Crop"]}, locale:"en" as const, onUndo:jest.fn(),onRedo:jest.fn(),onSeek,t:(key:any)=>key };
    await act(async () => root.render(<HistoryPanel {...props} />));
    await act(async () => (host.querySelector(".redo-states button") as HTMLButtonElement).click());
    expect(onSeek).toHaveBeenCalledWith(3);
    await act(async () => (host.querySelector(".history-states button") as HTMLButtonElement).click());
    expect(onSeek).toHaveBeenCalledWith(0);
    await act(async () => root.render(<HistoryPanel {...props} disabled />));
    expect([...host.querySelectorAll<HTMLButtonElement>("button")].every(button=>button.disabled)).toBe(true);
  });
});
