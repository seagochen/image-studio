import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ADJUSTMENT_KINDS, type AdjustmentKind } from "../domain/document";
import { AdjustmentMenu } from "../studio/AdjustmentMenu";

const labels = Object.fromEntries(ADJUSTMENT_KINDS.map((kind) => [kind, kind])) as Record<AdjustmentKind, string>;

describe("Image Studio adjustment layer menu", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    (globalThis as any).HTMLIFrameElement = document.defaultView!.HTMLIFrameElement;
    (globalThis as any).addEventListener = document.defaultView!.addEventListener.bind(document.defaultView);
    (globalThis as any).removeEventListener = document.defaultView!.removeEventListener.bind(document.defaultView);
    (globalThis as any).dispatchEvent = document.defaultView!.dispatchEvent.bind(document.defaultView);
    (globalThis as any).innerWidth = 1280;
    (globalThis as any).innerHeight = 900;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  async function renderMenu(overrides: Partial<React.ComponentProps<typeof AdjustmentMenu>> = {}) {
    const props: React.ComponentProps<typeof AdjustmentMenu> = {
      disabled: false,
      label: "Adjustment layer",
      labels,
      onSelect: jest.fn(),
      ...overrides,
    };
    await act(async () => root.render(<AdjustmentMenu {...props} />));
    return props;
  }

  async function openMenu() {
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Adjustment layer"]')?.click());
  }

  it("opens every advanced adjustment kind and resolves hue/saturation", async () => {
    const props = await renderMenu();
    await openMenu();
    const items = [...document.querySelectorAll<HTMLButtonElement>(".layer-create-popover [role=menuitem]")];
    expect(items.map((item) => item.textContent)).toEqual(ADJUSTMENT_KINDS);
    await act(async () => items[4].click());
    expect(props.onSelect).toHaveBeenCalledWith("hue-saturation");
    expect(document.querySelector(".layer-create-popover")).toBeNull();
  });

  it("keeps the portal open and repositions it when its scroll anchor moves", async () => {
    await renderMenu();
    await openMenu();
    expect(document.querySelector(".layer-create-popover")).not.toBeNull();
    await act(async () => window.dispatchEvent(new Event("scroll")));
    expect(document.querySelector(".layer-create-popover")).not.toBeNull();
  });
});
