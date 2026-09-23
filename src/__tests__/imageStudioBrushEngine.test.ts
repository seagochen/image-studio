import {
  BRUSH_PRESET_IDS, MAX_STROKE_SAMPLES, pointerSamples, BrushStrokeSession, renderBrushDabs, createBrushDabs, createBrushSettings, fallbackSample, settingsForPreset, smoothSamples,
} from "../domain/brushEngine";

describe("Image Studio brush engine", () => {
  it("provides six distinct, serializable presets", () => {
    expect(BRUSH_PRESET_IDS).toHaveLength(6);
    const base = createBrushSettings("hard-round", 42);
    expect(new Set(BRUSH_PRESET_IDS.map((id) => JSON.stringify(settingsForPreset(base, id)))).size).toBe(6);
  });

  it("replays the same samples and seed deterministically", () => {
    const settings = createBrushSettings("scatter", 123);
    const samples = [fallbackSample({ x: 2, y: 3 }, 0), { ...fallbackSample({ x: 80, y: 20 }, 20), pressure: .9 }];
    expect(createBrushDabs(samples, 20, settings)).toEqual(createBrushDabs(samples, 20, settings));
  });

  it("maps pressure and tilt while retaining stable mouse fallback", () => {
    const settings = createBrushSettings("marker", 8);
    const low = { ...fallbackSample({ x: 0, y: 0 }), pressure: .1, tiltX: 70 };
    const high = { ...fallbackSample({ x: 1, y: 1 }, 1), pressure: 1, tiltX: 0 };
    const lowDab = createBrushDabs([low], 40, settings)[0];
    const highDab = createBrushDabs([high], 40, settings)[0];
    expect(lowDab.radiusX).toBeLessThan(highDab.radiusX);
    expect(lowDab.radiusY).toBeLessThan(lowDab.radiusX);
    expect(fallbackSample({ x: 4, y: 5 })).toMatchObject({ pressure: .5, tiltX: 0, tiltY: 0, twist: 0 });
  });

  it("smooths noisy paths while preserving sample count and the starting point", () => {
    const samples = [fallbackSample({ x: 0, y: 0 }), fallbackSample({ x: 100, y: 100 }, 1), fallbackSample({ x: 200, y: 0 }, 2)];
    const smoothed = smoothSamples(samples, .5);
    expect(smoothed).toHaveLength(samples.length);
    expect(smoothed[0]).toEqual(samples[0]);
    expect(smoothed[1].x).toBe(50);
  });
});

describe("continuous raster brush regressions", () => {
  const samples = Array.from({ length: 40 }, (_, i) => ({ ...fallbackSample({ x: i * 3, y: i % 3 }, i * 7), pressure: .1 + i / 50 }));
  it("keeps event batching independent of smoothing, spacing and randomness", () => {
    const settings = createBrushSettings("scatter", 42);
    settings.dynamics.speedTaper = true;
    const whole = createBrushDabs(samples, 12, settings);
    const session = new BrushStrokeSession(12, settings);
    const chunks = [samples.slice(0, 1), samples.slice(1, 7), samples.slice(7, 19), samples.slice(19)];
    expect(chunks.flatMap((chunk) => session.push(chunk))).toEqual(whole);
  });
  it("does not emit a new dab for every sub-spacing event", () => {
    const settings = createBrushSettings("hard-round", 1);
    settings.dynamics.smoothing = 0;
    settings.spacing = 1;
    const session = new BrushStrokeSession(20, settings);
    expect(session.push([fallbackSample({ x: 0, y: 0 })])).toHaveLength(1);
    expect(session.push([fallbackSample({ x: 3, y: 0 }, 10)])).toHaveLength(0);
    expect(session.push([fallbackSample({ x: 21, y: 0 }, 20)])[0].x).toBe(20);
  });
  it("applies speed taper across event boundaries", () => {
    const settings = createBrushSettings("hard-round", 1);
    settings.dynamics = { ...settings.dynamics, smoothing: 0, speedTaper: true };
    const session = new BrushStrokeSession(10, settings);
    const first = session.push([fallbackSample({ x: 0, y: 0 }, 0)])[0];
    const fast = session.push([fallbackSample({ x: 100, y: 0 }, 10)]).at(-1)!;
    expect(fast.radiusX).toBeLessThan(first.radiusX);
  });
  it("stops accepting input after the per-stroke sample budget", () => {
    const settings = createBrushSettings("hard-round", 1);
    const sample = fallbackSample({ x: 0, y: 0 }, 0);
    const session = new BrushStrokeSession(20, settings);
    session.push(Array(MAX_STROKE_SAMPLES + 1).fill(sample));
    expect(session.push([{ ...sample, x: 100, time: 1 }])).toEqual([]);
  });
  it.each(["opacity", "flow"] as const)("keeps zero %s inert for paint, erase and dwell", (key) => {
    const settings = { ...createBrushSettings("soft-round", 1), [key]: 0 };
    const session = new BrushStrokeSession(24, settings);
    const dabs = [...session.push(samples), ...session.dwell(1000)];
    expect(dabs.every((dab) => dab.opacity === 0)).toBe(true);
    const context = { save: jest.fn(), restore: jest.fn(), fill: jest.fn(), globalCompositeOperation: "" };
    renderBrushDabs(context as any, dabs, "#ff0000");
    renderBrushDabs(context as any, dabs, "#ff0000", true);
    expect(context.fill).not.toHaveBeenCalled();
  });
});

describe("pointer sample fallbacks", () => {
  it("retains pen dynamics when coalesced events are empty and converts every coalesced coordinate", () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, "PointerEvent");
    class TestPointer extends MouseEvent {
      pressure = .8;
      pointerType = "pen";
      tiltX = 40;
      tiltY = 20;
      twist = 30;
      coalesced: TestPointer[] = [];
      getCoalescedEvents() { return this.coalesced; }
    }
    Object.defineProperty(globalThis, "PointerEvent", { value: TestPointer, configurable: true });
    try {
      const pointer = new TestPointer("pointermove", { clientX: 200, clientY: 300 });
      expect(pointerSamples(pointer, { x: 100, y: 150 })[0]).toMatchObject({ x: 100, y: 150, pressure: .8, tiltX: 40, twist: 30 });
      const first = new TestPointer("pointermove", { clientX: 180, clientY: 290 });
      first.pressure = .2;
      pointer.coalesced = [first, new TestPointer("pointermove", { clientX: 200, clientY: 300 })];
      expect(pointerSamples(pointer, { x: 100, y: 150 })).toMatchObject([
        { x: 80, y: 140, pressure: .2 }, { x: 100, y: 150, pressure: .8 },
      ]);
      pointer.coalesced = Array.from({ length: 300 }, (_, index) => new TestPointer("pointermove", { clientX: index, clientY: 300 }));
      expect(pointerSamples(pointer, { x: 100, y: 150 })).toHaveLength(256);
      pointer.coalesced = [];
      pointer.pointerType = "mouse";
      expect(pointerSamples(pointer, { x: 100, y: 150 })[0].pressure).toBe(.5);
      expect(pointerSamples(undefined, { x: 5, y: 8 }, 10)[0]).toEqual(fallbackSample({ x: 5, y: 8 }, 10));
    } finally {
      if (original) Object.defineProperty(globalThis, "PointerEvent", original);
      else delete (globalThis as any).PointerEvent;
    }
  });
});
