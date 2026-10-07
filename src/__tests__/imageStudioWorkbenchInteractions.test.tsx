import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { FileMenu } from "../studio/FileMenu";
import { fileCopy } from "../studio/fileCopy";
import { HistoryPanel } from "../studio/HistoryPanel";

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
    const props = { title: "Doc", copy: fileCopy.en, projects: [{ id: "p", title: "Saved" }], onOpen } as React.ComponentProps<typeof FileMenu>;
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
