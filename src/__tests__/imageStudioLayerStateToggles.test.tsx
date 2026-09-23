import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { LayerStateToggles } from "../studio/LayerStateToggles";
import type { MessageKey } from "../i18n";

const labels = {
  visible: "Layer visibility", locked: "Layer lock",
  showLayer: "Show layer", hideLayer: "Hide layer", lockLayer: "Lock layer", unlockLayer: "Unlock layer",
} as const;
const t = (key: MessageKey) => labels[key as keyof typeof labels] ?? key;

describe("Image Studio layer state toggles", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    (globalThis as any).HTMLIFrameElement = document.defaultView!.HTMLIFrameElement;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  async function render(visible: boolean, locked: boolean, variant: "controls" | "row" = "controls", onParentClick = jest.fn()) {
    const onVisibilityChange = jest.fn();
    const onLockChange = jest.fn();
    await act(async () => root.render(<div onClick={onParentClick}><LayerStateToggles visible={visible} locked={locked} t={t}
      variant={variant} onVisibilityChange={onVisibilityChange} onLockChange={onLockChange} /></div>));
    return { onVisibilityChange, onLockChange, onParentClick };
  }

  it.each([
    [true, true, "eye", "lock", "Hide layer", "Unlock layer"],
    [false, false, "eye-closed", "lock-open", "Show layer", "Lock layer"],
  ] as const)("renders current visibility and lock states", async (visible, locked, eye, lock, visibilityAction, lockAction) => {
    await render(visible, locked);
    const visibility = host.querySelector<HTMLButtonElement>('[aria-label="Layer visibility"]')!;
    const locking = host.querySelector<HTMLButtonElement>('[aria-label="Layer lock"]')!;
    expect(visibility.getAttribute("aria-pressed")).toBe(String(visible));
    expect(locking.getAttribute("aria-pressed")).toBe(String(locked));
    expect(visibility.title).toBe(visibilityAction);
    expect(locking.title).toBe(lockAction);
    expect(visibility.querySelector("use.product-icon-main")?.getAttribute("href")).toBe(`/icons.svg#icon-${eye}`);
    expect(locking.querySelector("use.product-icon-main")?.getAttribute("href")).toBe(`/icons.svg#icon-${lock}`);
  });

  it("fires one callback per control and stops row click propagation", async () => {
    const callbacks = await render(true, false, "row");
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Layer visibility"]')!.click());
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Layer lock"]')!.click());
    expect(callbacks.onVisibilityChange).toHaveBeenCalledTimes(1);
    expect(callbacks.onLockChange).toHaveBeenCalledTimes(1);
    expect(callbacks.onParentClick).not.toHaveBeenCalled();
  });
});
