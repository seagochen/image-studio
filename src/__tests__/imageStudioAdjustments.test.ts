import { applyAdjustment, applyAdjustmentAsync, createAdjustmentLayer, defaultAdjustment, histogram } from "../domain/adjustmentEngine";
import { addLayer } from "../domain/commands";
import { createEmptyDocument, parseDocument, serializeDocument, type AdjustmentKind } from "../domain/document";

describe("Image Studio non-destructive adjustments", () => {
  it.each([
    "exposure", "levels", "curves", "vibrance", "hue-saturation", "temperature-tint",
    "color-balance", "black-white", "gradient-map", "invert",
    "lut", "selective-color", "clarity", "dehaze", "shadows-highlights",
  ] as AdjustmentKind[])("processes %s while preserving alpha", (kind) => {
    const source = new Uint8ClampedArray([70, 120, 190, 255, 20, 30, 40, 0]);
    const definition = defaultAdjustment(kind);
    if (kind === "invert") expect(applyAdjustment(source, definition)[0]).toBe(185);
    expect(applyAdjustment(source, definition)[7]).toBe(0);
  });

  it("blends through opacity and a grayscale mask", () => {
    const source = new Uint8ClampedArray([10, 20, 30, 255]);
    const invert = defaultAdjustment("invert");
    expect([...applyAdjustment(source, invert, 0)]).toEqual([...source]);
    expect(applyAdjustment(source, invert, 1, new Uint8ClampedArray([0, 0, 0, 255]))[0]).toBe(10);
    expect(applyAdjustment(source, invert, 1, new Uint8ClampedArray([255, 255, 255, 255]))[0]).toBe(245);
  });

  it.each([
    ["exposure", { exposure: 1 }], ["levels", { inputBlack: 30, inputWhite: 220 }], ["curves", { points: [{ x: 0, y: 20 }, { x: 255, y: 235 }] }],
    ["vibrance", { amount: 80 }], ["hue-saturation", { hue: 90, saturation: 40 }], ["temperature-tint", { temperature: 40, tint: -20 }],
    ["color-balance", { midtonesCyanRed: 30 }], ["black-white", {}], ["gradient-map", { shadow: "#ff0000", highlight: "#00ff00" }], ["invert", {}],
  ] as Array<[AdjustmentKind, Record<string, unknown>]>)("applies visible %s parameters", (kind, parameters) => {
    const definition = defaultAdjustment(kind);
    definition.parameters = { ...definition.parameters, ...parameters } as typeof definition.parameters;
    const source = new Uint8ClampedArray([70, 120, 190, 255]);
    expect([...applyAdjustment(source, definition).slice(0, 3)]).not.toEqual([...source.slice(0, 3)]);
  });

  it("persists editable adjustment layers and rejects unknown kinds", () => {
    const initial = createEmptyDocument();
    const layer = createAdjustmentLayer(initial, "curves", "Curves");
    const document = addLayer(initial, layer);
    expect(parseDocument(serializeDocument(document)).layers[0]).toMatchObject({ type: "adjustment", adjustment: { kind: "curves" } });
    const invalid = { ...document, layers: [{ ...layer, adjustment: { kind: "future-filter", parameters: {} } }] };
    expect(() => parseDocument(JSON.stringify(invalid))).toThrow("adjustment");
  });

  it.each([
    "exposure", "levels", "curves", "vibrance", "hue-saturation", "temperature-tint",
    "color-balance", "black-white", "gradient-map", "invert", "lut", "selective-color",
    "clarity", "dehaze", "shadows-highlights",
  ] as AdjustmentKind[])("persists only the declared %s parameter keys", (kind) => {
    const initial = createEmptyDocument();
    const layer = createAdjustmentLayer(initial, kind, kind);
    const expected = { ...layer.adjustment.parameters };
    layer.adjustment.parameters = { ...layer.adjustment.parameters, temporaryUiValue: 42 };
    const parsed = parseDocument(serializeDocument(addLayer(initial, layer)));
    expect(parsed.layers[0].type === "adjustment" && parsed.layers[0].adjustment.parameters).toEqual(expected);
  });

  it("applies 1D LUT strength and selective color without changing alpha", () => {
    const lut = defaultAdjustment("lut");
    lut.parameters = { name: "Cyan", dimension: "1d", size: 2, domainMin: [0, 0, 0], domainMax: [1, 1, 1], values: [0, 0, 0, 0, 1, 1], strength: 100 };
    expect([...applyAdjustment(new Uint8ClampedArray([255, 255, 255, 128]), lut)]).toEqual([0, 255, 255, 128]);
    lut.parameters.strength = 0;
    expect([...applyAdjustment(new Uint8ClampedArray([255, 255, 255, 128]), lut)]).toEqual([255, 255, 255, 128]);

    const selective = defaultAdjustment("selective-color");
    selective.parameters.redCyan = 100;
    const result = applyAdjustment(new Uint8ClampedArray([230, 30, 30, 177]), selective);
    expect(result[0]).toBeLessThan(230);
    expect(result[3]).toBe(177);
  });

  it("uses local context for clarity rather than a global contrast transform", () => {
    const pixels = new Uint8ClampedArray([80,80,80,255, 80,80,80,255, 100,100,100,255, 120,120,120,255, 120,120,120,255]);
    const clarity = defaultAdjustment("clarity"); clarity.parameters = { amount: 100, radius: 2 };
    const result = applyAdjustment(pixels, clarity, 1, undefined, "normal", { width: 5, height: 1 });
    expect([...result]).not.toEqual([...pixels]);
    expect(result[8]).toBeGreaterThanOrEqual(95);
    expect(result[3]).toBe(255);
  });

  it("expands hazy contrast and recovers shadows/highlights deterministically", () => {
    const hazy = new Uint8ClampedArray([150,155,160,255, 180,185,190,255, 0,0,0,0]);
    const dehaze = defaultAdjustment("dehaze"); dehaze.parameters = { amount: 70, radius: 1, toneProtection: 40 };
    const cleared = applyAdjustment(hazy, dehaze, 1, undefined, "normal", { width: 3, height: 1 });
    expect(cleared[3]).toBe(255); expect(cleared[11]).toBe(0);
    expect(Math.abs(cleared[0] - cleared[4])).toBeGreaterThanOrEqual(Math.abs(hazy[0] - hazy[4]));
    const recovery = defaultAdjustment("shadows-highlights"); recovery.parameters = { shadows: 80, highlights: 80, radius: 1 };
    expect(applyAdjustment(hazy, recovery, 1, undefined, "normal", { width: 3, height: 1 }))
      .toEqual(applyAdjustment(hazy, recovery, 1, undefined, "normal", { width: 3, height: 1 }));
  });

  it("round-trips a bounded LUT adjustment in the versioned document", () => {
    const initial = createEmptyDocument();
    const layer = createAdjustmentLayer(initial, "lut", "Cyan LUT");
    layer.adjustment.parameters = { name: "Cyan", dimension: "1d", size: 2, domainMin: [0,0,0], domainMax: [1,1,1], values: [0,0,0,0,1,1], strength: 75 };
    expect(parseDocument(serializeDocument(addLayer(initial, layer))).layers[0]).toMatchObject({ adjustment: { kind: "lut", parameters: { strength: 75 } } });
  });

  it("builds channel histograms without counting transparent pixels", () => {
    const values = histogram(new Uint8ClampedArray([10, 20, 30, 255, 10, 20, 30, 0]));
    expect(values.red[10]).toBe(1);
    expect(values.green[20]).toBe(1);
    expect(values.blue[30]).toBe(1);
  });
});

describe("adjustment numerical and cancellation regressions", () => {
  it("extends curves using their nearest endpoint", () => {
    const curve = { kind: "curves" as const, parameters: { channel: "rgb", points: [{ x: 30, y: 10 }, { x: 128, y: 180 }] } };
    expect([...applyAdjustment(new Uint8ClampedArray([0, 200, 255, 128]), curve)]).toEqual([10, 180, 180, 128]);
    curve.parameters.points = [{ x: 100, y: 10 }, { x: 100, y: 200 }];
    expect([...applyAdjustment(new Uint8ClampedArray([0, 100, 255, 255]), curve)]).toEqual([10, 10, 200, 255]);
  });
  it("keeps color balance continuous through both range transitions", () => {
    const gradient = new Uint8ClampedArray(Array.from({ length: 256 }, (_, value) => [value, value, value, 255]).flat());
    const zero = defaultAdjustment("color-balance");
    expect(applyAdjustment(gradient, zero)).toEqual(gradient);
    zero.parameters.shadowsCyanRed = 100;
    zero.parameters.highlightsYellowBlue = -100;
    const result = applyAdjustment(gradient, zero);
    for (let i = 4; i < result.length; i += 4) {
      expect(Math.abs(result[i] - result[i - 4])).toBeLessThanOrEqual(3);
      expect(Math.abs(result[i + 2] - result[i - 2])).toBeLessThanOrEqual(3);
    }
  });
  it("chunks exactly the same operation and preserves its source", async () => {
    const data = new Uint8ClampedArray(20000 * 4).fill(120);
    const definition = defaultAdjustment("curves");
    definition.parameters.points = [{ x: 0, y: 30 }, { x: 255, y: 220 }];
    const yieldTask = jest.fn(async () => {});
    expect(await applyAdjustmentAsync(data, definition, { yieldTask })).toEqual(applyAdjustment(data, definition));
    expect(yieldTask).toHaveBeenCalledTimes(2);
    expect(data[0]).toBe(120);
  });
  it("cancels between chunks without publishing a partial result", async () => {
    const controller = new AbortController();
    const yieldTask = jest.fn(async () => { controller.abort(); });
    await expect(applyAdjustmentAsync(new Uint8ClampedArray(20000 * 4), defaultAdjustment("invert"), {
      signal: controller.signal, yieldTask,
    })).rejects.toThrow();
    expect(yieldTask).toHaveBeenCalledTimes(1);
  });
});
