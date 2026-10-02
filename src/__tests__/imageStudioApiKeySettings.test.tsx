import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ApiKeySettingsDialog } from "../studio/ApiKeySettingsDialog";
import { fileCopy } from "../studio/fileCopy";

function response(body: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => body } as Response;
}

const none = { enabled: true, baseUrl: "https://skillsmaster.jp", keySource: "none", keyHint: null, editable: true };

describe("Settings → API Key dialog", () => {
  let host: HTMLDivElement;
  let root: Root;
  const fetchMock = jest.fn();

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    (globalThis as any).HTMLIFrameElement = document.defaultView!.HTMLIFrameElement;
    (globalThis as any).fetch = fetchMock;
    fetchMock.mockReset();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  const render = async () => {
    await act(async () => root.render(<ApiKeySettingsDialog copy={fileCopy.en} onClose={() => undefined} />));
  };
  const input = () => host.querySelector<HTMLInputElement>('input[type="password"]')!;
  const button = (label: string) => [...host.querySelectorAll("button")].find((item) => item.textContent === label)!;
  const type = async (value: string) => {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input(), value);
      input().dispatchEvent(new Event("input", { bubbles: true }));
    });
  };

  it("saves a key to the local server and shows only the hint afterwards", async () => {
    fetchMock.mockResolvedValueOnce(response(none))
      .mockResolvedValueOnce(response({ ...none, keySource: "settings", keyHint: "…cdef", verified: true }));
    await render();
    expect(host.textContent).toContain("Not configured");
    expect(host.textContent).toContain("https://skillsmaster.jp");
    await type("sk-live-abcdef");
    await act(async () => button("Save").click());
    expect(fetchMock).toHaveBeenLastCalledWith("/local-ai/settings/api-key", expect.objectContaining({
      method: "PUT", body: JSON.stringify({ apiKey: "sk-live-abcdef" }),
    }));
    expect(host.textContent).toContain("Saved (…cdef)");
    expect(host.textContent).toContain("API key saved and verified.");
    expect(input().value).toBe("");
    expect(host.innerHTML).not.toContain("sk-live-abcdef");
  });

  it("reports a rejected key and keeps a config-managed key read-only", async () => {
    fetchMock.mockResolvedValueOnce(response(none)).mockResolvedValueOnce(response({ detail: "skillsmaster.jp rejected this API key" }, 422));
    await render();
    await type("bad-key-123");
    await act(async () => button("Save").click());
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("skillsmaster.jp rejected this API key");

    await act(async () => root.unmount());
    root = createRoot(host);
    fetchMock.mockResolvedValueOnce(response({ ...none, keySource: "config", keyHint: "…9999", editable: false }));
    await render();
    expect(host.textContent).toContain("Set by the server configuration file (…9999)");
    expect(host.querySelector('input[type="password"]')).toBeNull();
  });
});
