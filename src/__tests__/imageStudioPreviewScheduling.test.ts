import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createEmptyDocument, type ImageStudioDocument } from "../domain/document";
import { useCompositePreview } from "../studio/useCompositePreview";
import { renderImageStudioDocument } from "../domain/exportImage";

jest.mock("../domain/exportImage", () => ({
  previewScale: () => .5,
  renderImageStudioDocument: jest.fn(),
}));

it("coalesces continuous drawing without starving the running preview and cancels parameter changes", async () => {
  jest.useFakeTimers();
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  (globalThis as any).HTMLIFrameElement = document.defaultView!.HTMLIFrameElement;
  const host = document.createElement("div"); document.body.appendChild(host);
  let root: Root | undefined;
  let shown: HTMLCanvasElement | null = null;
  const jobs: Array<{ resolve: (canvas: HTMLCanvasElement) => void }> = [];
  (renderImageStudioDocument as jest.Mock).mockImplementation(() => new Promise((resolve) => jobs.push({ resolve })));
  function Harness({ source, tick, drawing }: { source: ImageStudioDocument; tick: number; drawing: boolean }) {
    shown = useCompositePreview(source, true, tick, undefined, drawing, () => { throw new Error("Unexpected render failure"); });
    return null;
  }
  try {
    root = createRoot(host);
    const source = createEmptyDocument();
    const render = async (tick: number, drawing = true, next = source) => {
      await act(async () => { root!.render(React.createElement(Harness, { source: next, tick, drawing })); });
      await act(async () => { jest.advanceTimersByTime(20); });
    };
    await render(0);
    expect(jobs).toHaveLength(1);
    await render(1); await render(2);
    expect(jobs).toHaveLength(1);
    const firstCanvas = document.createElement("canvas");
    await act(async () => { jobs[0].resolve(firstCanvas); });
    expect(shown).toBe(firstCanvas);
    await act(async () => { jest.advanceTimersByTime(20); });
    expect(jobs).toHaveLength(2);
    const secondSignal = (renderImageStudioDocument as jest.Mock).mock.calls[1][1].signal as AbortSignal;
    await render(3, false, { ...source, layers: [] });
    expect(secondSignal.aborted).toBe(true);
    const discarded = document.createElement("canvas");
    await act(async () => { jobs[1].resolve(discarded); });
    expect(shown).toBe(firstCanvas);
    await act(async () => { jest.advanceTimersByTime(20); });
    expect(jobs).toHaveLength(3);
    const thirdSignal = (renderImageStudioDocument as jest.Mock).mock.calls[2][1].signal as AbortSignal;
    await act(async () => { root!.unmount(); }); root = undefined;
    expect(thirdSignal.aborted).toBe(true);
    await act(async () => { jobs[2].resolve(document.createElement("canvas")); });
    jest.runOnlyPendingTimers();
    expect(jobs).toHaveLength(3);
  } finally {
    if (root) await act(async () => root!.unmount());
    host.remove();
    delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
    delete (globalThis as any).HTMLIFrameElement;
    jest.useRealTimers();
  }
});
