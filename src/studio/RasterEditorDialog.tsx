import { useEffect, useRef, useState } from "react";
import type { ConventionalEditorInput, ConventionalEditorOutcome } from "../adapters/conventionalEditor";
import {
  applyFilterPreset, canvasFilter, clampCrop, createRasterAdjustments, hasGeometryChanges, outputDimensions, resizeForCrop,
  type CropRect, type QuarterTurn, type RasterAdjustments, type RasterFilterPreset,
} from "../domain/rasterAdjustments";
import { mixChannelRange } from "../domain/pixelTools";
import { ProductIcon, type ProductIconName } from "./ProductIcon";
import { MAX_CANVAS_EDGE, MAX_CANVAS_PIXELS } from "../../../../frontend/src/shared/imageStudioDomain";
import type { Locale } from "../i18n";

type EditorMode = "adjust" | "filters";
type AdjustTool = "finetune" | "crop" | "rotate" | "flip" | "resize";

interface Props {
  input: ConventionalEditorInput;
  language: Locale;
  initialMode: EditorMode;
  onComplete: (outcome: ConventionalEditorOutcome) => void;
}

const MAX_PIXELS = MAX_CANVAS_PIXELS;
const MAX_PREVIEW_PIXELS = 4_000_000;
const PRESETS: RasterFilterPreset[] = ["original", "vivid", "mono", "sepia", "warm", "cool", "vintage", "dramatic", "fade"];
const rasterEditorCopyEn = { adjust: "Adjust", filters: "Filters", finetune: "Finetune", crop: "Crop", rotate: "Rotate", flip: "Flip", resize: "Resize", undo: "Undo", reset: "Reset", cancel: "Cancel", apply: "Apply", loading: "Loading image…", failed: "The image could not be loaded.", brightness: "Brightness", contrast: "Contrast", saturation: "Saturation", hue: "Hue", temperature: "Temperature", red: "Red channel", green: "Green channel", blue: "Blue channel", grayscale: "Grayscale", sepiaAmount: "Sepia", x: "X", y: "Y", width: "Width", height: "Height", aspect: "Aspect ratio", free: "Free", originalRatio: "Original", square: "Square", rotateLeft: "Rotate left 90°", rotateRight: "Rotate right 90°", flipHorizontal: "Flip horizontal", flipVertical: "Flip vertical", lockRatio: "Lock aspect ratio", outputSize: "Output size", original: "Original", vivid: "Vivid", mono: "Mono", sepia: "Sepia", warm: "Warm", cool: "Cool", vintage: "Vintage", dramatic: "Dramatic", fade: "Fade" };

type EditorCopy = { [Key in keyof typeof rasterEditorCopyEn]: string };

export const RASTER_EDITOR_COPY: Record<Locale, EditorCopy> = {
  en: rasterEditorCopyEn,
  ja: { adjust: "基本調整", filters: "フィルター", finetune: "色調補正", crop: "切り抜き", rotate: "回転", flip: "反転", resize: "サイズ変更", undo: "元に戻す", reset: "リセット", cancel: "キャンセル", apply: "適用", loading: "画像を読み込み中…", failed: "画像を読み込めませんでした。", brightness: "明るさ", contrast: "コントラスト", saturation: "彩度", hue: "色相", temperature: "色温度", red: "赤チャンネル", green: "緑チャンネル", blue: "青チャンネル", grayscale: "グレースケール", sepiaAmount: "セピア", x: "X", y: "Y", width: "幅", height: "高さ", aspect: "縦横比", free: "自由", originalRatio: "元画像", square: "正方形", rotateLeft: "左へ90°", rotateRight: "右へ90°", flipHorizontal: "左右反転", flipVertical: "上下反転", lockRatio: "縦横比を固定", outputSize: "出力サイズ", original: "オリジナル", vivid: "鮮やか", mono: "モノクロ", sepia: "セピア", warm: "暖色", cool: "寒色", vintage: "ヴィンテージ", dramatic: "ドラマチック", fade: "フェード" },
  "zh-CN": { adjust: "常规调整", filters: "滤镜", finetune: "色调调整", crop: "裁剪", rotate: "旋转", flip: "翻转", resize: "调整尺寸", undo: "撤销", reset: "重置", cancel: "取消", apply: "应用", loading: "正在加载图片…", failed: "无法加载图片。", brightness: "亮度", contrast: "对比度", saturation: "饱和度", hue: "色相", temperature: "色温", red: "红色通道", green: "绿色通道", blue: "蓝色通道", grayscale: "黑白", sepiaAmount: "棕褐色", x: "横向位置", y: "纵向位置", width: "宽度", height: "高度", aspect: "裁剪比例", free: "自由", originalRatio: "原图", square: "正方形", rotateLeft: "向左旋转 90°", rotateRight: "向右旋转 90°", flipHorizontal: "水平翻转", flipVertical: "垂直翻转", lockRatio: "锁定宽高比", outputSize: "输出尺寸", original: "原图", vivid: "鲜艳", mono: "黑白", sepia: "棕褐", warm: "暖色", cool: "冷色", vintage: "复古", dramatic: "高反差", fade: "褪色" },
  "zh-TW": { adjust: "常規調整", filters: "濾鏡", finetune: "色調調整", crop: "裁剪", rotate: "旋轉", flip: "翻轉", resize: "調整尺寸", undo: "復原", reset: "重設", cancel: "取消", apply: "套用", loading: "正在載入圖片…", failed: "無法載入圖片。", brightness: "亮度", contrast: "對比度", saturation: "飽和度", hue: "色相", temperature: "色溫", red: "紅色通道", green: "綠色通道", blue: "藍色通道", grayscale: "黑白", sepiaAmount: "棕褐色", x: "橫向位置", y: "縱向位置", width: "寬度", height: "高度", aspect: "裁剪比例", free: "自由", originalRatio: "原圖", square: "正方形", rotateLeft: "向左旋轉 90°", rotateRight: "向右旋轉 90°", flipHorizontal: "水平翻轉", flipVertical: "垂直翻轉", lockRatio: "鎖定寬高比", outputSize: "輸出尺寸", original: "原圖", vivid: "鮮豔", mono: "黑白", sepia: "棕褐", warm: "暖色", cool: "冷色", vintage: "復古", dramatic: "高反差", fade: "褪色" },
};

export function RasterEditorDialog({ input, language, initialMode, onComplete }: Props): JSX.Element {
  const t = RASTER_EDITOR_COPY[language];
  const sourceRef = useRef<HTMLCanvasElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [tool, setTool] = useState<AdjustTool>("finetune");
  const [state, setState] = useState(() => createRasterAdjustments(input.width, input.height));
  const [history, setHistory] = useState<RasterAdjustments[]>([]);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [lockRatio, setLockRatio] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    if (input.width * input.height > MAX_PIXELS) { setFailed(true); return () => controller.abort(); }
    void fetch(input.sourceUrl, { signal: controller.signal }).then((response) => {
      if (!response.ok) throw new Error("image fetch failed");
      return response.blob();
    }).then(createImageBitmap).then((image) => {
      const source = document.createElement("canvas");
      source.width = input.width; source.height = input.height;
      source.getContext("2d")?.drawImage(image, 0, 0, input.width, input.height);
      image.close(); sourceRef.current = source; setReady(true);
    }).catch((error: unknown) => { if (!(error instanceof DOMException && error.name === "AbortError")) setFailed(true); });
    return () => controller.abort();
  }, [input]);

  useEffect(() => {
    if (!ready) return;
    const frame = requestAnimationFrame(() => render(sourceRef.current, canvasRef.current, state, MAX_PREVIEW_PIXELS));
    return () => cancelAnimationFrame(frame);
  }, [ready, state]);

  const update = (next: RasterAdjustments) => {
    setHistory((entries) => [...entries.slice(-39), state]);
    setState(next);
  };
  const patch = (changes: Partial<RasterAdjustments>) => update({ ...state, ...changes });
  const setCrop = (changes: Partial<CropRect>) => update(resizeForCrop(state, clampCrop({ ...state.crop, ...changes }, input.width, input.height)));
  const setRatio = (ratio: number | null) => {
    if (!ratio) return;
    const width = Math.min(input.width - state.crop.x, state.crop.width);
    const height = Math.min(input.height - state.crop.y, Math.max(1, Math.round(width / ratio)));
    setCrop({ width: Math.min(width, Math.round(height * ratio)), height });
  };
  const turn = (amount: number) => patch({ rotation: ((state.rotation + amount + 360) % 360) as QuarterTurn });
  const resize = (dimension: "width" | "height", value: number) => {
    const safe = Math.max(1, Math.min(MAX_CANVAS_EDGE, Math.round(value || 1)));
    if (!lockRatio) { patch(dimension === "width" ? { resizeWidth: safe } : { resizeHeight: safe }); return; }
    const ratio = state.resizeWidth / state.resizeHeight;
    patch(dimension === "width" ? { resizeWidth: safe, resizeHeight: Math.max(1, Math.round(safe / ratio)) } : { resizeHeight: safe, resizeWidth: Math.max(1, Math.round(safe * ratio)) });
  };
  const reset = () => update(createRasterAdjustments(input.width, input.height));
  const undo = () => {
    const previous = history.at(-1); if (!previous) return;
    setHistory((entries) => entries.slice(0, -1)); setState(previous);
  };
  const save = () => {
    if (!sourceRef.current || !ready) return;
    const canvas = document.createElement("canvas");
    render(sourceRef.current, canvas, state);
    const mimeType = ["image/png", "image/jpeg", "image/webp"].includes(input.mimeType) ? input.mimeType : "image/png";
    onComplete({ kind: "saved", output: {
      dataUrl: canvas.toDataURL(mimeType), mimeType, width: canvas.width, height: canvas.height,
      resizeCanvas: hasGeometryChanges(state, input.width, input.height),
    } });
  };

  const adjustTools: Array<[AdjustTool, ProductIconName, string]> = [["finetune", "adjust", t.finetune], ["crop", "crop", t.crop], ["rotate", "rotate-right", t.rotate], ["flip", "flip", t.flip], ["resize", "resize", t.resize]];
  const dimensions = outputDimensions(state);
  return <div className="pixel-editor-backdrop" role="dialog" aria-modal="true" aria-label={initialMode === "filters" ? t.filters : t.adjust}>
    <div className="pixel-editor raster-editor">
      <header><h2>{initialMode === "filters" ? t.filters : t.adjust}</h2><span className="editor-output-size">{dimensions.width} × {dimensions.height} px</span><button onClick={undo} disabled={!history.length}>{t.undo}</button><button onClick={reset}>{t.reset}</button><button onClick={() => onComplete({ kind: "cancelled" })}>{t.cancel}</button><button className="primary" disabled={!ready} onClick={save}>{t.apply}</button></header>
      <nav>{initialMode === "adjust" ? adjustTools.map(([name, icon, label]) => <button key={name} className={tool === name ? "active" : ""} onClick={() => setTool(name)}><ProductIcon name={icon} /><strong>{label}</strong></button>) : PRESETS.map((preset) => <button key={preset} className={isPreset(state, preset) ? "active" : ""} onClick={() => update(applyFilterPreset(state, preset))}><span className={`filter-chip filter-${preset}`} aria-hidden="true" /><strong>{t[preset]}</strong></button>)}</nav>
      <main className={initialMode === "filters" ? "editor-main-no-panel" : undefined}><div className="pixel-canvas-wrap raster-canvas-wrap">{!ready && <p>{failed ? t.failed : t.loading}</p>}<canvas ref={canvasRef} /></div>
        {initialMode === "adjust" && <aside><AdjustPanel t={t} tool={tool} state={state} input={input} lockRatio={lockRatio} patch={patch} setCrop={setCrop} setRatio={setRatio} turn={turn} resize={resize} setLockRatio={setLockRatio} /></aside>}
      </main>
    </div>
  </div>;
}

function AdjustPanel({ t, tool, state, input, lockRatio, patch, setCrop, setRatio, turn, resize, setLockRatio }: { t: EditorCopy; tool: AdjustTool; state: RasterAdjustments; input: ConventionalEditorInput; lockRatio: boolean; patch: (changes: Partial<RasterAdjustments>) => void; setCrop: (changes: Partial<CropRect>) => void; setRatio: (ratio: number | null) => void; turn: (amount: number) => void; resize: (dimension: "width" | "height", value: number) => void; setLockRatio: (value: boolean) => void }): JSX.Element {
  if (tool === "finetune") return <>{([ ["brightness", 0, 200], ["contrast", 0, 200], ["saturation", 0, 200], ["hue", -180, 180], ["temperature", -100, 100], ["red", 0, 200], ["green", 0, 200], ["blue", 0, 200], ["grayscale", 0, 100], ["sepia", 0, 100] ] as const).map(([key, min, max]) => <label key={key}>{key === "sepia" ? t.sepiaAmount : t[key]}<output>{state[key]}{key === "hue" ? "°" : "%"}</output><input type="range" min={min} max={max} value={state[key]} onChange={(event) => patch({ [key]: Number(event.target.value) })} /></label>)}</>;
  if (tool === "crop") return <><h3>{t.crop}</h3><div className="editor-number-grid">{(["x", "y", "width", "height"] as const).map((key) => <label key={key}>{t[key]}<input type="number" min={key === "x" || key === "y" ? 0 : 1} max={key === "x" || key === "width" ? input.width : input.height} value={state.crop[key]} onChange={(event) => setCrop({ [key]: Number(event.target.value) })} /></label>)}</div><h3>{t.aspect}</h3><div className="editor-button-grid"><button onClick={() => setRatio(input.width / input.height)}>{t.originalRatio}</button><button onClick={() => setRatio(1)}>{t.square}</button><button onClick={() => setRatio(4 / 3)}>4:3</button><button onClick={() => setRatio(16 / 9)}>16:9</button></div></>;
  if (tool === "rotate") return <div className="editor-action-stack"><button onClick={() => turn(-90)}><ProductIcon name="rotate-left" /> {t.rotateLeft}</button><button onClick={() => turn(90)}><ProductIcon name="rotate-right" /> {t.rotateRight}</button></div>;
  if (tool === "flip") return <div className="editor-action-stack"><button className={state.flipX ? "active" : ""} onClick={() => patch({ flipX: !state.flipX })}><ProductIcon name="flip" /> {t.flipHorizontal}</button><button className={state.flipY ? "active" : ""} onClick={() => patch({ flipY: !state.flipY })}><ProductIcon name="flip" /> {t.flipVertical}</button></div>;
  return <><h3>{t.outputSize}</h3><div className="editor-number-grid"><label>{t.width}<input type="number" min="1" max={MAX_CANVAS_EDGE} value={state.resizeWidth} onChange={(event) => resize("width", Number(event.target.value))} /></label><label>{t.height}<input type="number" min="1" max={MAX_CANVAS_EDGE} value={state.resizeHeight} onChange={(event) => resize("height", Number(event.target.value))} /></label></div><label className="editor-check"><input type="checkbox" checked={lockRatio} onChange={(event) => setLockRatio(event.target.checked)} /> {t.lockRatio}</label></>;
}

function render(source: HTMLCanvasElement | null, canvas: HTMLCanvasElement | null, state: RasterAdjustments, maxPixels?: number): void {
  if (!source || !canvas) return;
  const dimensions = outputDimensions(state);
  const scale = maxPixels && dimensions.width * dimensions.height > maxPixels
    ? Math.sqrt(maxPixels / (dimensions.width * dimensions.height)) : 1;
  canvas.width = Math.max(1, Math.round(dimensions.width * scale)); canvas.height = Math.max(1, Math.round(dimensions.height * scale));
  const pixelAdjustment = state.temperature !== 0 || state.red !== 100 || state.green !== 100 || state.blue !== 100;
  const context = canvas.getContext("2d", { willReadFrequently: pixelAdjustment }); if (!context) return;
  context.save(); context.translate(canvas.width / 2, canvas.height / 2); context.scale(state.flipX ? -1 : 1, state.flipY ? -1 : 1); context.rotate(state.rotation * Math.PI / 180); context.filter = canvasFilter(state);
  context.drawImage(source, state.crop.x, state.crop.y, state.crop.width, state.crop.height, -state.resizeWidth * scale / 2, -state.resizeHeight * scale / 2, state.resizeWidth * scale, state.resizeHeight * scale); context.restore();
  if (pixelAdjustment) applyPixelAdjustments(context, canvas.width, canvas.height, state);
}

function applyPixelAdjustments(context: CanvasRenderingContext2D, width: number, height: number, state: RasterAdjustments): void {
  const image = context.getImageData(0, 0, width, height);
  const shift = state.temperature * .45;
  if (shift) {
    for (let index = 0; index < image.data.length; index += 4) { image.data[index] += shift; image.data[index + 2] -= shift; }
  }
  mixChannelRange(image.data, image.data.slice(), 0, image.data.length, { red: state.red, green: state.green, blue: state.blue });
  context.putImageData(image, 0, 0);
}

function isPreset(state: RasterAdjustments, preset: RasterFilterPreset): boolean {
  const expected = applyFilterPreset(state, preset);
  return (["brightness", "contrast", "saturation", "hue", "temperature", "red", "green", "blue", "grayscale", "sepia"] as const).every((key) => state[key] === expected[key]);
}
