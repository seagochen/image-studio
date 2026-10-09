import type { Locale } from "../i18n";

const en = {
  foreground: "Foreground color", commands: "Commands", search: "Search commands, tools and panels…", noResults: "No matching commands",
  hint: "↑↓ Navigate · Enter Run · Esc Close", history: "History", current: "Current state",
  earlier: "Earlier states", later: "Redo states", initial: "Oldest retained state", empty: "No edits yet",
  tools: "Tools", panels: "Panels", file: "File", edit: "Edit", view: "View", adjustments: "Adjustments",
  transformHint: "Drag a handle to resize freely · Hold Shift to keep proportions", eyedropperHint: "Click to sample a color · Esc to cancel", pickScreen: "Pick from screen",
};
type Copy = { [K in keyof typeof en]: string };
export const selectionCommandCopy = { en: { all: "Select all" }, ja: { all: "すべてを選択" }, "zh-CN": { all: "全选" }, "zh-TW": { all: "全選" } };
export const workbenchCopy: Record<Locale, Copy> = {
  en,
  ja: { foreground: "描画色", commands: "コマンド", search: "コマンド・ツール・パネルを検索…", noResults: "一致するコマンドがありません", hint: "↑↓ 選択 · Enter 実行 · Esc 閉じる", history: "履歴", current: "現在の状態", earlier: "以前の状態", later: "やり直し可能な状態", initial: "保持された最初の状態", empty: "編集履歴はありません", tools: "ツール", panels: "パネル", file: "ファイル", edit: "編集", view: "表示", adjustments: "色調補正", transformHint: "ハンドルをドラッグで自由に変形 · Shift キーで縦横比を固定", eyedropperHint: "クリックで色を取得 · Esc でキャンセル", pickScreen: "画面から取得" },
  "zh-CN": { foreground: "前景色", commands: "命令", search: "搜索命令、工具与面板…", noResults: "没有匹配的命令", hint: "↑↓ 选择 · Enter 执行 · Esc 关闭", history: "历史记录", current: "当前状态", earlier: "之前的状态", later: "可重做的状态", initial: "最早保留的状态", empty: "暂无编辑记录", tools: "工具", panels: "面板", file: "文件", edit: "编辑", view: "视图", adjustments: "调整", transformHint: "拖动手柄自由缩放 · 按住 Shift 等比缩放", eyedropperHint: "点击取色 · Esc 取消", pickScreen: "从屏幕取色" },
  "zh-TW": { foreground: "前景色", commands: "命令", search: "搜尋命令、工具與面板…", noResults: "沒有符合的命令", hint: "↑↓ 選擇 · Enter 執行 · Esc 關閉", history: "歷史紀錄", current: "目前狀態", earlier: "之前的狀態", later: "可重做的狀態", initial: "最早保留的狀態", empty: "尚無編輯記錄", tools: "工具", panels: "面板", file: "檔案", edit: "編輯", view: "檢視", adjustments: "調整", transformHint: "拖曳控點自由縮放 · 按住 Shift 等比縮放", eyedropperHint: "點擊取色 · Esc 取消", pickScreen: "從螢幕取色" },
};

export const quickTransformCopy = {
  en: { "rotate-left": "Rotate 90° counterclockwise", "rotate-right": "Rotate 90° clockwise", "flip-horizontal": "Flip horizontal", "flip-vertical": "Flip vertical" },
  ja: { "rotate-left": "反時計回りに90°回転", "rotate-right": "時計回りに90°回転", "flip-horizontal": "水平方向に反転", "flip-vertical": "垂直方向に反転" },
  "zh-CN": { "rotate-left": "逆时针旋转 90°", "rotate-right": "顺时针旋转 90°", "flip-horizontal": "水平翻转", "flip-vertical": "垂直翻转" },
  "zh-TW": { "rotate-left": "逆時針旋轉 90°", "rotate-right": "順時針旋轉 90°", "flip-horizontal": "水平翻轉", "flip-vertical": "垂直翻轉" },
};
