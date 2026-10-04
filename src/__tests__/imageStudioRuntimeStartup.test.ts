import { startImageStudio, type StartupDependencies } from "../runtime/bootstrap";
import { loadRuntimeConfig, setRuntimeConfigForTests } from "../runtime/runtimeConfig";
import { createAiRunGateway, modeManifestUrl } from "../ai/gatewayForMode";
import { HttpAiRunGateway, PLATFORM_MODE_MANIFEST_URL } from "../ai/httpGateway";
import { STANDALONE_MODE_MANIFEST_URL, StandaloneAiRunGateway } from "../ai/standaloneGateway";

function dependencies(overrides: Partial<StartupDependencies>): StartupDependencies & Record<"requireUser" | "render" | "showError", jest.Mock> {
  return {
    loadConfig: async () => ({ mode: "platform", aiAvailable: true }),
    requireUser: jest.fn(async () => true),
    render: jest.fn(),
    showError: jest.fn(),
    ...overrides,
  } as StartupDependencies & Record<"requireUser" | "render" | "showError", jest.Mock>;
}

describe("Image Studio startup by runtime mode", () => {
  afterEach(() => setRuntimeConfigForTests(null));

  it("stops with an error and never logs in or renders when the runtime config is unusable", async () => {
    const failures = [
      async () => { throw new Error("Image Studio runtime config is unavailable (404)"); },
      () => loadRuntimeConfig(jest.fn(async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError("Unexpected token <"); } }) as unknown as Response)),
      () => loadRuntimeConfig(jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ mode: "local" }) }) as unknown as Response)),
      () => loadRuntimeConfig(jest.fn(async () => { throw new TypeError("Failed to fetch"); })),
    ];
    for (const loadConfig of failures) {
      const deps = dependencies({ loadConfig });
      await expect(startImageStudio(deps)).resolves.toBe("config-error");
      expect(deps.showError).toHaveBeenCalledWith(expect.stringMatching(/^Image Studio could not start: /));
      expect(deps.requireUser).not.toHaveBeenCalled();
      expect(deps.render).not.toHaveBeenCalled();
    }
  });

  it("only enters the platform login flow when platform authentication fails", async () => {
    const deps = dependencies({ requireUser: jest.fn(async () => false) });
    await expect(startImageStudio(deps)).resolves.toBe("login-required");
    expect(deps.requireUser).toHaveBeenCalledTimes(1);
    expect(deps.render).not.toHaveBeenCalled();
  });

  it("renders platform mode after the skillsmaster session is confirmed", async () => {
    const deps = dependencies({});
    await expect(startImageStudio(deps)).resolves.toBe("rendered");
    expect(deps.render).toHaveBeenCalledWith({ mode: "platform", aiAvailable: true });
  });

  it("renders standalone mode without any skillsmaster login", async () => {
    const deps = dependencies({ loadConfig: async () => ({ mode: "standalone", aiAvailable: false }) });
    await expect(startImageStudio(deps)).resolves.toBe("rendered");
    expect(deps.requireUser).not.toHaveBeenCalled();
  });

  it("selects the AI adapter strictly from the loaded mode", () => {
    expect(() => createAiRunGateway()).toThrow("not been loaded");
    setRuntimeConfigForTests({ mode: "platform", aiAvailable: true });
    expect(createAiRunGateway()).toBeInstanceOf(HttpAiRunGateway);
    expect(modeManifestUrl()).toBe(PLATFORM_MODE_MANIFEST_URL);
    setRuntimeConfigForTests({ mode: "standalone", aiAvailable: true });
    expect(createAiRunGateway()).toBeInstanceOf(StandaloneAiRunGateway);
    expect(modeManifestUrl()).toBe(STANDALONE_MODE_MANIFEST_URL);
  });
});
