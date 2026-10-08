import type { Locale } from "../i18n";
import type { BrushPresetId } from "../domain/brushEngine";

const brushUiEn = { preset: "Brush tip", hardness: "Hardness", spacing: "Spacing", opacity: "Opacity", flow: "Flow", smoothing: "Smoothing", pressureSize: "Pressure sizes", pressureOpacity: "Pressure opacity", pressureFlow: "Pressure flow", tiltAngle: "Tilt / rotation", speedTaper: "Speed taper" };
type BrushUiLabels = { [Key in keyof typeof brushUiEn]: string };
export const BRUSH_UI: Record<Locale, BrushUiLabels> = {
  en: brushUiEn,
  ja: { preset: "ブラシ", hardness: "硬さ", spacing: "間隔", opacity: "不透明度", flow: "流量", smoothing: "滑らかさ", pressureSize: "筆圧でサイズ", pressureOpacity: "筆圧で不透明度", pressureFlow: "筆圧で流量", tiltAngle: "傾き・回転", speedTaper: "速度で先細り" },
  "zh-CN": { preset: "笔刷", hardness: "硬度", spacing: "间距", opacity: "不透明度", flow: "流量", smoothing: "轨迹平滑", pressureSize: "压感控制尺寸", pressureOpacity: "压感控制透明度", pressureFlow: "压感控制流量", tiltAngle: "倾斜与旋转", speedTaper: "速度控制收笔" },
  "zh-TW": { preset: "筆刷", hardness: "硬度", spacing: "間距", opacity: "不透明度", flow: "流量", smoothing: "軌跡平滑", pressureSize: "壓感控制尺寸", pressureOpacity: "壓感控制不透明度", pressureFlow: "壓感控制流量", tiltAngle: "傾斜與旋轉", speedTaper: "速度控制收筆" },
};

export const BRUSH_PRESET_LABELS: Record<Locale, Record<BrushPresetId, string>> = {
  ja: { "hard-round": "ハード円形", "soft-round": "ソフト円形", pencil: "鉛筆", marker: "マーカー", texture: "テクスチャ", scatter: "散布" },
  en: { "hard-round": "Hard round", "soft-round": "Soft round", pencil: "Pencil", marker: "Marker", texture: "Texture", scatter: "Scatter" },
  "zh-CN": { "hard-round": "硬边圆形", "soft-round": "柔边圆形", pencil: "铅笔", marker: "马克笔", texture: "纹理", scatter: "散点" },
  "zh-TW": { "hard-round": "硬邊圓形", "soft-round": "柔邊圓形", pencil: "鉛筆", marker: "麥克筆", texture: "紋理", scatter: "散點" },
};

const layerUiEn = { mergeHelp: "Visible unlocked normal layers only. Adjustments require the bottom layer.", menu: "Layer actions", mergeUp: "Merge up", mergeDown: "Merge down", group: "Group", groupHelp: "Shift-click or Ctrl/Cmd-click layers to choose what to group, or make sure there's an adjacent layer to group with.", ungroup: "Ungroup", rename: "Rename", groupName: "Group" };
type LayerUiLabels = { [Key in keyof typeof layerUiEn]: string };
export const LAYER_UI: Record<Locale, LayerUiLabels> = {
  en: layerUiEn,
  ja: { mergeHelp: "通常合成の隣接レイヤーのみ。調整は最下層との結合に対応。", menu: "レイヤー操作", mergeUp: "上と結合", mergeDown: "下と結合", group: "グループ化", groupHelp: "Shift または Ctrl/⌘ を押しながらクリックしてグループ化するレイヤーを選択するか、隣接するレイヤーがあることを確認してください。", ungroup: "グループ解除", rename: "名前を変更", groupName: "グループ" },
  "zh-CN": { mergeHelp: "仅合并可见、未锁定的正常混合图层；调整层须与最底层合并。", menu: "图层操作", mergeUp: "向上合并", mergeDown: "向下合并", group: "编组", groupHelp: "按住 Shift 或 Ctrl/⌘ 点选要编组的图层，或确保存在可编组的相邻图层。", ungroup: "取消编组", rename: "重命名", groupName: "图层组" },
  "zh-TW": { mergeHelp: "僅合併可見、未鎖定的正常混合圖層；調整層須與最底層合併。", menu: "圖層操作", mergeUp: "向上合併", mergeDown: "向下合併", group: "群組", groupHelp: "按住 Shift 或 Ctrl/⌘ 點選要建立群組的圖層，或確保存在可建立群組的相鄰圖層。", ungroup: "取消群組", rename: "重新命名", groupName: "圖層群組" },
};
