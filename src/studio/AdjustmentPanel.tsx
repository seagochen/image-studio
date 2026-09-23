import { useState } from "react";
import type { AdjustmentDefinition, AdjustmentLayer } from "../domain/document";
import { CUBE_LUT_MAX_BYTES, parseCubeLut } from "../domain/cubeLut";
import type { Locale } from "../i18n";

interface Props {
  layer: AdjustmentLayer;
  locale: Locale;
  histogram?: number[];
  onChange: (adjustment: AdjustmentDefinition, mergeKey?: string) => void;
}

const adjustmentKindLabelsEn = { exposure: "Exposure", levels: "Levels", curves: "Curves", vibrance: "Vibrance", "hue-saturation": "Hue / Saturation", "temperature-tint": "Temperature / Tint", "color-balance": "Color balance", "black-white": "Black & white", "gradient-map": "Gradient map", invert: "Invert", lut: "Color lookup (LUT)", "selective-color": "Selective color", clarity: "Clarity", dehaze: "Dehaze", "shadows-highlights": "Shadows / Highlights" };
type AdjustmentKindLabels = { [Key in keyof typeof adjustmentKindLabelsEn]: string };
export const ADJUSTMENT_KIND_LABELS: Record<Locale, AdjustmentKindLabels> = {
  en: adjustmentKindLabelsEn,
  ja: { exposure: "露光量", levels: "レベル補正", curves: "トーンカーブ", vibrance: "自然な彩度", "hue-saturation": "色相・彩度", "temperature-tint": "色温度・色かぶり", "color-balance": "カラーバランス", "black-white": "白黒", "gradient-map": "グラデーションマップ", invert: "階調の反転", lut: "カラー参照 (LUT)", "selective-color": "特定色域の選択", clarity: "明瞭度", dehaze: "かすみの除去", "shadows-highlights": "シャドウ・ハイライト" },
  "zh-CN": { exposure: "曝光度", levels: "色阶", curves: "曲线", vibrance: "自然饱和度", "hue-saturation": "色相/饱和度", "temperature-tint": "色温/色调", "color-balance": "色彩平衡", "black-white": "黑白", "gradient-map": "渐变映射", invert: "反相", lut: "颜色查找 (LUT)", "selective-color": "可选颜色", clarity: "清晰度", dehaze: "去雾", "shadows-highlights": "阴影/高光" },
  "zh-TW": { exposure: "曝光度", levels: "色階", curves: "曲線", vibrance: "自然飽和度", "hue-saturation": "色相/飽和度", "temperature-tint": "色溫/色調", "color-balance": "色彩平衡", "black-white": "黑白", "gradient-map": "漸層對應", invert: "負片效果", lut: "顏色查找 (LUT)", "selective-color": "選取顏色", clarity: "清晰度", dehaze: "去霧", "shadows-highlights": "陰影/亮部" },
};

const panelLabelsEn = {
  channel: "Channel", keepAsLayer: "Keep as adjustment layer", bakeIntoOriginal: "Apply to original layer",
  cancel: "Cancel", reset: "Reset", loading: "Loading preview…", previewFailed: "The preview could not be generated.",
};
type PanelLabels = { [Key in keyof typeof panelLabelsEn]: string };
export const PANEL_LABELS: Record<Locale, PanelLabels> = {
  en: panelLabelsEn,
  ja: {
    channel: "チャンネル", keepAsLayer: "調整レイヤーとして保持", bakeIntoOriginal: "元のレイヤーに適用",
    cancel: "キャンセル", reset: "リセット", loading: "プレビューを生成中…", previewFailed: "プレビューを生成できませんでした。",
  },
  "zh-CN": {
    channel: "通道", keepAsLayer: "保留为调整图层", bakeIntoOriginal: "应用到原始图层",
    cancel: "取消", reset: "重置", loading: "正在生成预览…", previewFailed: "无法生成预览。",
  },
  "zh-TW": {
    channel: "通道", keepAsLayer: "保留為調整圖層", bakeIntoOriginal: "套用到原始圖層",
    cancel: "取消", reset: "重設", loading: "正在生成預覽…", previewFailed: "無法生成預覽。",
  },
};

// Covers both the LUT/selective-color panel fields and every numeric slider label rendered
// through CONTROLS below (Issue #165) — one catalog so no adjustment control field is ever
// left as a raw English literal regardless of which adjustment kind renders it.
const controlLabelsEn = {
  importLut: "Import CUBE LUT", lutMissing: "Choose a LUT file", invalidLut: "The LUT could not be loaded", strength: "Strength", radius: "Radius", amount: "Amount", toneProtection: "Highlight protection", shadows: "Shadows", highlights: "Highlights", range: "Color range", cyan: "Cyan", magenta: "Magenta", yellow: "Yellow", black: "Black",
  exposure: "Exposure", offset: "Offset", gamma: "Gamma", inputBlack: "Input black", inputWhite: "Input white", outputBlack: "Output black", outputWhite: "Output white", vibrance: "Vibrance", hue: "Hue", saturation: "Saturation", lightness: "Lightness", temperature: "Temperature", tint: "Tint", tintColor: "Tint color", reverse: "Reverse", curveMidpoint: "Curve midpoint", midtones: "Midtones",
};
type ControlLabels = { [Key in keyof typeof controlLabelsEn]: string };
export const CONTROL_LABELS: Record<Locale, ControlLabels> = {
  en: controlLabelsEn,
  ja: {
    importLut: "CUBE LUTを読み込む", lutMissing: "LUTを選択してください", invalidLut: "LUTを読み込めません", strength: "強度", radius: "半径", amount: "量", toneProtection: "ハイライト保護", shadows: "シャドウ", highlights: "ハイライト", range: "色域", cyan: "シアン", magenta: "マゼンタ", yellow: "イエロー", black: "ブラック",
    exposure: "露光量", offset: "オフセット", gamma: "ガンマ", inputBlack: "入力（黒点）", inputWhite: "入力（白点）", outputBlack: "出力（黒点）", outputWhite: "出力（白点）", vibrance: "自然な彩度", hue: "色相", saturation: "彩度", lightness: "明度", temperature: "色温度", tint: "色かぶり", tintColor: "色かぶりの色", reverse: "反転", curveMidpoint: "カーブの中間点", midtones: "中間調",
  },
  "zh-CN": {
    importLut: "导入 CUBE LUT", lutMissing: "请选择 LUT 文件", invalidLut: "无法读取 LUT", strength: "强度", radius: "半径", amount: "数量", toneProtection: "高光保护", shadows: "阴影", highlights: "高光", range: "颜色范围", cyan: "青色", magenta: "洋红", yellow: "黄色", black: "黑色",
    exposure: "曝光", offset: "偏移", gamma: "伽马", inputBlack: "输入黑场", inputWhite: "输入白场", outputBlack: "输出黑场", outputWhite: "输出白场", vibrance: "自然饱和度", hue: "色相", saturation: "饱和度", lightness: "明度", temperature: "色温", tint: "色调", tintColor: "色调颜色", reverse: "反转", curveMidpoint: "曲线中点", midtones: "中间调",
  },
  "zh-TW": {
    importLut: "匯入 CUBE LUT", lutMissing: "請選擇 LUT 檔案", invalidLut: "無法讀取 LUT", strength: "強度", radius: "半徑", amount: "數量", toneProtection: "亮部保護", shadows: "陰影", highlights: "亮部", range: "顏色範圍", cyan: "青色", magenta: "洋紅", yellow: "黃色", black: "黑色",
    exposure: "曝光", offset: "偏移", gamma: "伽瑪", inputBlack: "輸入黑場", inputWhite: "輸入白場", outputBlack: "輸出黑場", outputWhite: "輸出白場", vibrance: "自然飽和度", hue: "色相", saturation: "飽和度", lightness: "明度", temperature: "色溫", tint: "色調", tintColor: "色調顏色", reverse: "反轉", curveMidpoint: "曲線中點", midtones: "中間調",
  },
};

interface NumericControl { key: string; label: (locale: Locale) => string; min: number; max: number; step?: number; }

function colorBalanceLabel(locale: Locale, range: "shadows" | "midtones" | "highlights", a: ColorRangeKey, b: ColorRangeKey): string {
  return `${CONTROL_LABELS[locale][range]} ${COLOR_RANGE_LABELS[locale][a]} / ${COLOR_RANGE_LABELS[locale][b]}`;
}

const CONTROLS: Record<string, NumericControl[]> = {
  exposure: [
    { key: "exposure", label: (locale: Locale) => CONTROL_LABELS[locale].exposure, min: -5, max: 5, step: .05 },
    { key: "offset", label: (locale: Locale) => CONTROL_LABELS[locale].offset, min: -.5, max: .5, step: .01 },
    { key: "gamma", label: (locale: Locale) => CONTROL_LABELS[locale].gamma, min: .1, max: 3, step: .01 },
  ],
  levels: [
    { key: "inputBlack", label: (locale: Locale) => CONTROL_LABELS[locale].inputBlack, min: 0, max: 254 },
    { key: "inputWhite", label: (locale: Locale) => CONTROL_LABELS[locale].inputWhite, min: 1, max: 255 },
    { key: "gamma", label: (locale: Locale) => CONTROL_LABELS[locale].gamma, min: .1, max: 3, step: .01 },
    { key: "outputBlack", label: (locale: Locale) => CONTROL_LABELS[locale].outputBlack, min: 0, max: 254 },
    { key: "outputWhite", label: (locale: Locale) => CONTROL_LABELS[locale].outputWhite, min: 1, max: 255 },
  ],
  vibrance: [{ key: "amount", label: (locale: Locale) => CONTROL_LABELS[locale].vibrance, min: -100, max: 100 }],
  "hue-saturation": [
    { key: "hue", label: (locale: Locale) => CONTROL_LABELS[locale].hue, min: -180, max: 180 },
    { key: "saturation", label: (locale: Locale) => CONTROL_LABELS[locale].saturation, min: -100, max: 100 },
    { key: "lightness", label: (locale: Locale) => CONTROL_LABELS[locale].lightness, min: -100, max: 100 },
  ],
  "temperature-tint": [
    { key: "temperature", label: (locale: Locale) => CONTROL_LABELS[locale].temperature, min: -100, max: 100 },
    { key: "tint", label: (locale: Locale) => CONTROL_LABELS[locale].tint, min: -100, max: 100 },
  ],
  "color-balance": (["shadows", "midtones", "highlights"] as const).flatMap((range) => [
    { key: `${range}CyanRed`, label: (locale: Locale) => colorBalanceLabel(locale, range, "cyan", "red"), min: -100, max: 100 },
    { key: `${range}MagentaGreen`, label: (locale: Locale) => colorBalanceLabel(locale, range, "magenta", "green"), min: -100, max: 100 },
    { key: `${range}YellowBlue`, label: (locale: Locale) => colorBalanceLabel(locale, range, "yellow", "blue"), min: -100, max: 100 },
  ]),
  "black-white": (["red", "yellow", "green", "cyan", "blue", "magenta"] as const).map((key) => ({ key, label: (locale: Locale) => COLOR_RANGE_LABELS[locale][key], min: -200, max: 300 })),
  clarity: [
    { key: "amount", label: (locale: Locale) => CONTROL_LABELS[locale].amount, min: -100, max: 100 },
    { key: "radius", label: (locale: Locale) => CONTROL_LABELS[locale].radius, min: 1, max: 32 },
  ],
  dehaze: [
    { key: "amount", label: (locale: Locale) => CONTROL_LABELS[locale].amount, min: 0, max: 100 },
    { key: "radius", label: (locale: Locale) => CONTROL_LABELS[locale].radius, min: 1, max: 32 },
    { key: "toneProtection", label: (locale: Locale) => CONTROL_LABELS[locale].toneProtection, min: 0, max: 100 },
  ],
  "shadows-highlights": [
    { key: "shadows", label: (locale: Locale) => CONTROL_LABELS[locale].shadows, min: -100, max: 100 },
    { key: "highlights", label: (locale: Locale) => CONTROL_LABELS[locale].highlights, min: -100, max: 100 },
    { key: "radius", label: (locale: Locale) => CONTROL_LABELS[locale].radius, min: 1, max: 32 },
  ],
};

export function AdjustmentPanel({ layer, locale, histogram, onChange }: Props): JSX.Element {
  const panelLabels = PANEL_LABELS[locale];
  const controlLabels = CONTROL_LABELS[locale];
  const adjustment = layer.adjustment;
  const parameters = adjustment.parameters;
  const patch = (key: string, value: number | string | boolean | number[] | Array<{ x: number; y: number }>) =>
    onChange({ ...adjustment, parameters: { ...parameters, [key]: value } }, `adjustment:${layer.id}:${key}`);
  return <div className="adjustment-properties">
    {(adjustment.kind === "levels" || adjustment.kind === "curves") && <label>{panelLabels.channel}<select value={String(parameters.channel ?? "rgb")} onChange={(event) => patch("channel", event.target.value)}>
      <option value="rgb">RGB</option><option value="r">R</option><option value="g">G</option><option value="b">B</option>
    </select></label>}
    {adjustment.kind === "levels" && histogram && <div className="adjustment-histogram" aria-label="Histogram">
      {histogram.map((value, index) => index % 4 === 0 && <i key={index} style={{ height: `${Math.max(1, value * 100)}%` }} />)}
    </div>}
    {adjustment.kind === "curves" && <label>{controlLabels.curveMidpoint}<output>{curveMidpoint(parameters.points)}</output>
      <input type="range" min="0" max="255" value={curveMidpoint(parameters.points)} onChange={(event) => patch("points", [{ x: 0, y: 0 }, { x: 128, y: Number(event.target.value) }, { x: 255, y: 255 }])} />
    </label>}
    {adjustment.kind === "lut" && <LutControl adjustment={adjustment} locale={locale} onChange={onChange} />}
    {adjustment.kind === "selective-color" && <SelectiveColorControl adjustment={adjustment} locale={locale} patch={patch} />}
    {(CONTROLS[adjustment.kind] ?? []).map((control) => <label key={control.key}>{control.label(locale)}<output>{Number(parameters[control.key] ?? 0)}</output>
      <input type="range" min={control.min} max={control.max} step={control.step ?? 1} value={Number(parameters[control.key] ?? 0)} onChange={(event) => patch(control.key, Number(event.target.value))} />
    </label>)}
    {adjustment.kind === "black-white" && <><label className="brush-check"><input type="checkbox" checked={parameters.tint === true} onChange={(event) => patch("tint", event.target.checked)} />{controlLabels.tint}</label>
      {parameters.tint === true && <label>{controlLabels.tintColor}<input type="color" value={String(parameters.tintColor ?? "#b9a27a")} onChange={(event) => patch("tintColor", event.target.value)} /></label>}</>}
    {adjustment.kind === "gradient-map" && <><label>{controlLabels.shadows}<input type="color" value={String(parameters.shadow ?? "#000000")} onChange={(event) => patch("shadow", event.target.value)} /></label>
      <label>{controlLabels.highlights}<input type="color" value={String(parameters.highlight ?? "#ffffff")} onChange={(event) => patch("highlight", event.target.value)} /></label>
      <label className="brush-check"><input type="checkbox" checked={parameters.reverse === true} onChange={(event) => patch("reverse", event.target.checked)} />{controlLabels.reverse}</label></>}
  </div>;
}

const COLOR_RANGES = ["red", "yellow", "green", "cyan", "blue", "magenta", "white", "neutral", "black"] as const;
const colorRangeLabelsEn = { red: "Reds", yellow: "Yellows", green: "Greens", cyan: "Cyans", blue: "Blues", magenta: "Magentas", white: "Whites", neutral: "Neutrals", black: "Blacks" };
type ColorRangeKey = keyof typeof colorRangeLabelsEn;
type ColorRangeLabels = { [Key in ColorRangeKey]: string };
export const COLOR_RANGE_LABELS: Record<Locale, ColorRangeLabels> = {
  en: colorRangeLabelsEn,
  ja: { red: "赤", yellow: "黄", green: "緑", cyan: "シアン", blue: "青", magenta: "マゼンタ", white: "白", neutral: "中間色", black: "黒" },
  "zh-CN": { red: "红色", yellow: "黄色", green: "绿色", cyan: "青色", blue: "蓝色", magenta: "洋红", white: "白色", neutral: "中性色", black: "黑色" },
  "zh-TW": { red: "紅色", yellow: "黃色", green: "綠色", cyan: "青色", blue: "藍色", magenta: "洋紅", white: "白色", neutral: "中性色", black: "黑色" },
};
function SelectiveColorControl({ adjustment, locale, patch }: { adjustment: AdjustmentDefinition; locale: Locale; patch: (key: string, value: number) => void }): JSX.Element {
  const [range, setRange] = useState<typeof COLOR_RANGES[number]>("red");
  const controlLabels = CONTROL_LABELS[locale];
  return <div className="selective-color-controls">
    <label>{controlLabels.range}<select value={range} onChange={(event) => setRange(event.target.value as typeof range)}>{COLOR_RANGES.map((value) => <option key={value} value={value}>{COLOR_RANGE_LABELS[locale][value]}</option>)}</select></label>
    {(["Cyan", "Magenta", "Yellow", "Black"] as const).map((axis) => { const key = `${range}${axis}`; return <label key={key}>{controlLabels[axis.toLowerCase() as "cyan" | "magenta" | "yellow" | "black"]}<output>{Number(adjustment.parameters[key] ?? 0)}</output><input type="range" min="-100" max="100" value={Number(adjustment.parameters[key] ?? 0)} onChange={(event) => patch(key, Number(event.target.value))} /></label>; })}
  </div>;
}

function LutControl({ adjustment, locale, onChange }: { adjustment: AdjustmentDefinition; locale: Locale; onChange: Props["onChange"] }): JSX.Element {
  const controlLabels = CONTROL_LABELS[locale];
  const [error, setError] = useState("");
  const parameters = adjustment.parameters;
  const load = async (file: File | undefined) => {
    if (!file) return;
    try {
      if (file.size > CUBE_LUT_MAX_BYTES) throw new Error("size");
      const lut = parseCubeLut(await file.text(), file.name.replace(/\.cube$/i, ""));
      onChange({ kind: "lut", parameters: { ...lut, strength: Number(parameters.strength ?? 100) } });
      setError("");
    } catch {
      setError(controlLabels.invalidLut);
    }
  };
  const patchStrength = (strength: number) => onChange({ ...adjustment, parameters: { ...parameters, strength } }, "adjustment:lut:strength");
  const dimension = parameters.dimension === "1d" ? "1D" : "3D";
  return <div className="lut-controls">
    <label className="lut-import">{controlLabels.importLut}<input type="file" accept=".cube,text/plain" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; void load(file); }} /></label>
    {parameters.name ? <><p className="lut-summary"><strong>{String(parameters.name)}</strong><span>{dimension} · {Number(parameters.size)}{parameters.dimension === "3d" ? "³" : ""}</span></p>
      <code className="lut-domain">{formatDomain(parameters.domainMin)} → {formatDomain(parameters.domainMax)}</code></> : <p className="panel-empty">{controlLabels.lutMissing}</p>}
    <label>{controlLabels.strength}<output>{Number(parameters.strength ?? 100)}%</output><input type="range" min="0" max="100" value={Number(parameters.strength ?? 100)} onChange={(event) => patchStrength(Number(event.target.value))} /></label>
    {error && <p className="adjustment-error" role="alert">{error}</p>}
  </div>;
}

function formatDomain(value: unknown): string {
  return Array.isArray(value) && value.length === 3
    ? value.map((item) => Number(item).toFixed(3).replace(/\.?0+$/, "") || "0").join(", ") : "—";
}

function curveMidpoint(value: unknown): number {
  if (!Array.isArray(value)) return 128;
  const point = value.find((candidate) => typeof candidate === "object" && candidate !== null && Math.round((candidate as any).x) === 128);
  return point ? Number((point as any).y) : 128;
}
