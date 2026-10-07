import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { CommandPalette } from "../studio/CommandPalette";
import type { EditorCommand } from "../domain/editorCommands";

describe("command palette keyboard and focus", () => {
  let host: HTMLDivElement, root: Root, trigger: HTMLButtonElement;
  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    (globalThis as any).HTMLIFrameElement = document.defaultView!.HTMLIFrameElement;
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    trigger = document.createElement("button"); document.body.append(trigger); trigger.focus();
  });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); trigger.remove(); });

  it("does not execute disabled commands, navigates by keyboard and restores focus", async () => {
    const blocked = jest.fn(), allowed = jest.fn(), onClose = jest.fn();
    const commands: EditorCommand[] = [
      { id: "layer.delete", label: "Delete", category: "Layers", enabled: false, run: blocked },
      { id: "tool.brush", label: "Brush", category: "Tools", enabled: true, run: allowed },
    ];
    await act(async () => root.render(<CommandPalette commands={commands} locale="en" onClose={onClose} />));
    const input = host.querySelector<HTMLInputElement>("input")!;
    expect(document.activeElement).toBe(input);
    await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(blocked).not.toHaveBeenCalled(); expect(onClose).not.toHaveBeenCalled();
    await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
    expect(input.getAttribute("aria-activedescendant")).toBe("studio-command-1");
    await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(allowed).toHaveBeenCalledTimes(1); expect(onClose).toHaveBeenCalledTimes(1);
    await act(async () => root.render(null)); expect(document.activeElement).toBe(trigger);
  });
  it("closes on Escape and ignores Enter while composing", async () => {
    const run = jest.fn(), close = jest.fn();
    await act(async () => root.render(<CommandPalette commands={[{ id: "tool.brush", label: "Brush", category: "Tools", enabled: true, run }]} locale="en" onClose={close} />));
    const input = host.querySelector<HTMLInputElement>("input")!;
    await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true })));
    expect(run).not.toHaveBeenCalled();
    await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(close).toHaveBeenCalledTimes(1);
  });
});
