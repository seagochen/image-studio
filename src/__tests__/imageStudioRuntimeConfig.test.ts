import { loadRuntimeConfig, parseRuntimeConfig, runtimeConfig, setRuntimeConfigForTests } from "../runtime/runtimeConfig";

describe("Image Studio runtime mode", () => {
  afterEach(() => setRuntimeConfigForTests(null));

  it("accepts the three explicit modes and requires a platform origin for hosted mode", () => {
    expect(parseRuntimeConfig({ mode: "platform" })).toEqual({ mode: "platform", aiAvailable: true });
    expect(parseRuntimeConfig({ mode: "standalone", ai: { available: false } })).toEqual({ mode: "standalone", aiAvailable: false });
    expect(parseRuntimeConfig({ mode: "hosted", platformOrigin: "https://api.skillsmaster.jp" }))
      .toEqual({ mode: "hosted", aiAvailable: true, platformOrigin: "https://api.skillsmaster.jp" });
    expect(() => parseRuntimeConfig({ mode: "hosted" })).toThrow("platform origin");
    expect(() => parseRuntimeConfig({ mode: "hosted", platformOrigin: "javascript:alert(1)" })).toThrow();
    expect(() => parseRuntimeConfig({ mode: "local" })).toThrow("runtime mode");
    expect(() => parseRuntimeConfig(null)).toThrow("runtime config");
  });

  it("fails instead of guessing a mode when the config cannot be loaded", async () => {
    const unavailable = jest.fn(async () => ({ ok: false, status: 502 }) as Response);
    await expect(loadRuntimeConfig(unavailable)).rejects.toThrow("unavailable");
    expect(unavailable).toHaveBeenCalledWith("/apps/image-studio/runtime-config.json", expect.objectContaining({ cache: "no-store" }));
    expect(() => runtimeConfig()).toThrow("not been loaded");
  });
});
