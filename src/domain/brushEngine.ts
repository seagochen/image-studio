import type { Point } from "./document";
import { BRUSH_PRESET_IDS, type BrushPresetId } from "../shared/imageStudioDomain";

export { BRUSH_PRESET_IDS };
export type { BrushPresetId };

export interface StrokeSample extends Point {
  time: number;
  pressure: number;
  tiltX: number;
  tiltY: number;
  twist: number;
}

export interface BrushDynamics {
  pressureSize: boolean;
  pressureOpacity: boolean;
  pressureFlow: boolean;
  tiltAngle: boolean;
  speedTaper: boolean;
  smoothing: number;
}

export interface BrushSettings {
  version: 1;
  presetId: BrushPresetId;
  hardness: number;
  spacing: number;
  opacity: number;
  flow: number;
  seed: number;
  dynamics: BrushDynamics;
}

export interface BrushDab extends Point {
  radiusX: number;
  radiusY: number;
  angle: number;
  opacity: number;
  hardness: number;
  texture: number;
}

// Serializable defaults only — UI-facing preset labels live in Studio.tsx's
// locale catalog, not here, so BrushSettings never carries a display string
// into persisted documents (Issue #164).
export const BRUSH_PRESETS: Record<BrushPresetId, Pick<BrushSettings, "hardness" | "spacing" | "opacity" | "flow">> = {
  "hard-round": { hardness: 1, spacing: .16, opacity: 1, flow: 1 },
  "soft-round": { hardness: .15, spacing: .12, opacity: .8, flow: .45 },
  pencil: { hardness: .92, spacing: .1, opacity: .82, flow: .72 },
  marker: { hardness: .72, spacing: .13, opacity: .62, flow: .7 },
  texture: { hardness: .55, spacing: .22, opacity: .72, flow: .58 },
  scatter: { hardness: .8, spacing: .35, opacity: .7, flow: .55 },
};

export function createBrushSettings(presetId: BrushPresetId = "hard-round", seed = randomSeed()): BrushSettings {
  const preset = BRUSH_PRESETS[presetId];
  return {
    version: 1, presetId, hardness: preset.hardness, spacing: preset.spacing, opacity: preset.opacity, flow: preset.flow, seed,
    dynamics: { pressureSize: true, pressureOpacity: false, pressureFlow: true, tiltAngle: true, speedTaper: false, smoothing: .35 },
  };
}

export function settingsForPreset(current: BrushSettings, presetId: BrushPresetId): BrushSettings {
  return { ...current, presetId, ...BRUSH_PRESETS[presetId], seed: randomSeed() };
}

export function pointerSamples(event: Event | undefined, fallback: Point, now = performance.now()): StrokeSample[] {
  const pointer = isPointerEvent(event) ? event : null;
  const coalesced = pointer?.getCoalescedEvents?.() ?? [];
  const events = coalesced.length ? coalesced : pointer ? [pointer] : [];
  if (!events.length) return [fallbackSample(fallback, now)];
  return events.slice(-256).map((sample, index) => ({
    x: Number.isFinite(sample.clientX) && pointer ? fallback.x + sample.clientX - pointer.clientX : fallback.x,
    y: Number.isFinite(sample.clientY) && pointer ? fallback.y + sample.clientY - pointer.clientY : fallback.y,
    time: Number.isFinite(sample.timeStamp) ? sample.timeStamp : now + index,
    pressure: normalizedPressure(sample.pressure, sample.pointerType),
    tiltX: finiteRange(sample.tiltX, -90, 90, 0),
    tiltY: finiteRange(sample.tiltY, -90, 90, 0),
    twist: finiteRange(sample.twist, 0, 359, 0),
  }));
}

export function fallbackSample(point: Point, time = 0): StrokeSample {
  return { ...point, time, pressure: .5, tiltX: 0, tiltY: 0, twist: 0 };
}

export function smoothSamples(samples: readonly StrokeSample[], amount: number): StrokeSample[] {
  const strength = finiteRange(amount, 0, .95, 0);
  if (samples.length < 2 || strength === 0) return samples.map((sample) => ({ ...sample }));
  const output = [{ ...samples[0] }];
  for (const sample of samples.slice(1)) {
    const previous = output[output.length - 1];
    const follow = 1 - strength;
    output.push({ ...sample, x: previous.x + (sample.x - previous.x) * follow, y: previous.y + (sample.y - previous.y) * follow });
  }
  return output;
}

export const MAX_STROKE_SAMPLES = 100_000;
export const MAX_STROKE_DABS = 100_000;

/** State survives event boundaries: smoothing, spacing and randomness must not restart per event. */
export class BrushStrokeSession {
  private previous: StrokeSample | null = null;
  private previousDab: StrokeSample | null = null;
  private remaining = 0;
  private samples = 0;
  private dabs = 0;
  private readonly random: () => number;
  private readonly spacing: number;

  constructor(private readonly size: number, private readonly settings: BrushSettings) {
    this.random = seededRandom(settings.seed);
    this.spacing = Math.max(.5, size * finiteRange(settings.spacing, .02, 2, .15));
  }

  push(samples: readonly StrokeSample[]): BrushDab[] {
    const output: BrushDab[] = [];
    for (const input of samples) {
      if (this.samples >= MAX_STROKE_SAMPLES || this.dabs >= MAX_STROKE_DABS) break;
      this.samples += 1;
      if (!this.previous) {
        this.previous = { ...input };
        output.push(this.dab(input));
        this.remaining = this.spacing;
        continue;
      }
      const start = this.previous;
      const follow = 1 - finiteRange(this.settings.dynamics.smoothing, 0, .95, 0);
      const end = { ...input, x: start.x + (input.x - start.x) * follow, y: start.y + (input.y - start.y) * follow };
      const distance = Math.hypot(end.x - start.x, end.y - start.y);
      let travelled = this.remaining;
      while (travelled <= distance && distance > 0 && this.dabs < MAX_STROKE_DABS) {
        output.push(this.dab(interpolateSample(start, end, travelled / distance)));
        travelled += this.spacing;
      }
      this.remaining = travelled - distance;
      this.previous = end;
    }
    return output;
  }

  dwell(time: number): BrushDab[] {
    return this.previous && this.dabs < MAX_STROKE_DABS ? [this.dab({ ...this.previous, time })] : [];
  }

  private dab(sample: StrokeSample): BrushDab {
    this.dabs += 1;
    const settings = this.settings;
    const previous = this.previousDab ?? sample;
    const speed = Math.hypot(sample.x - previous.x, sample.y - previous.y) / Math.max(1, sample.time - previous.time);
    this.previousDab = sample;
    const pressure = finiteRange(sample.pressure, .05, 1, .5);
    const taper = settings.dynamics.speedTaper ? Math.max(.35, 1 - Math.min(1, speed / 2) * .45) : 1;
    const diameter = Math.max(.5, this.size * (settings.dynamics.pressureSize ? .2 + pressure * .8 : 1) * taper);
    const tilt = Math.min(1, Math.hypot(sample.tiltX, sample.tiltY) / 90);
    const flatness = (settings.presetId === "marker" ? .45 : 1) * (settings.dynamics.tiltAngle ? 1 - tilt * .65 : 1);
    const angle = !settings.dynamics.tiltAngle ? 0 : (tilt > .02 ? Math.atan2(sample.tiltY, sample.tiltX) : 0) + sample.twist * Math.PI / 180;
    const scatter = settings.presetId === "scatter" ? diameter * .85 : 0;
    const theta = this.random() * Math.PI * 2;
    const offset = Math.sqrt(this.random()) * scatter;
    const texture = settings.presetId === "texture" ? .45 + this.random() * .55 : 1;
    return {
      x: sample.x + Math.cos(theta) * offset, y: sample.y + Math.sin(theta) * offset,
      radiusX: diameter / 2, radiusY: diameter * flatness / 2, angle,
      opacity: finiteRange(settings.opacity * settings.flow * (settings.dynamics.pressureOpacity ? pressure : 1)
        * (settings.dynamics.pressureFlow ? .25 + pressure * .75 : 1) * texture, 0, 1, 0),
      hardness: settings.presetId === "pencil" ? .94 : finiteRange(settings.hardness, 0, 1, 1), texture,
    };
  }
}

export function createBrushDabs(samples: readonly StrokeSample[], size: number, settings: BrushSettings): BrushDab[] {
  return new BrushStrokeSession(size, settings).push(samples);
}

export function renderBrushDabs(context: CanvasRenderingContext2D, dabs: readonly BrushDab[], color: string, erase = false): void {
  context.save();
  context.globalCompositeOperation = erase ? "destination-out" : "source-over";
  for (const dab of dabs) {
    if (dab.opacity <= 0) continue;
    context.save();
    context.translate(dab.x, dab.y); context.rotate(dab.angle); context.scale(1, dab.radiusY / Math.max(.001, dab.radiusX));
    context.globalAlpha = dab.opacity;
    const radius = dab.radiusX;
    if (dab.hardness >= .98) context.fillStyle = color;
    else {
      const gradient = context.createRadialGradient(0, 0, radius * dab.hardness, 0, 0, radius);
      gradient.addColorStop(0, color); gradient.addColorStop(Math.max(.001, dab.hardness), color); gradient.addColorStop(1, "rgba(0,0,0,0)");
      context.fillStyle = gradient;
    }
    context.beginPath(); context.arc(0, 0, radius, 0, Math.PI * 2); context.fill(); context.restore();
  }
  context.restore();
}

function interpolateSample(start: StrokeSample, end: StrokeSample, progress: number): StrokeSample {
  const lerp = (a: number, b: number) => a + (b - a) * progress;
  return { x: lerp(start.x, end.x), y: lerp(start.y, end.y), time: lerp(start.time, end.time), pressure: lerp(start.pressure, end.pressure), tiltX: lerp(start.tiltX, end.tiltX), tiltY: lerp(start.tiltY, end.tiltY), twist: lerp(start.twist, end.twist) };
}

function normalizedPressure(value: number, pointerType: string): number {
  if (pointerType === "mouse" || !Number.isFinite(value) || value <= 0) return .5;
  return finiteRange(value, .01, 1, .5);
}

function isPointerEvent(event: Event | undefined): event is PointerEvent {
  return typeof PointerEvent !== "undefined" && event instanceof PointerEvent;
}

function finiteRange(value: number, minimum: number, maximum: number, fallback: number): number {
  return Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, value)) : fallback;
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0 || 0x9e3779b9;
  return () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 0x1_0000_0000; };
}

function randomSeed(): number {
  return typeof crypto !== "undefined" && "getRandomValues" in crypto ? crypto.getRandomValues(new Uint32Array(1))[0] : Date.now() >>> 0;
}
