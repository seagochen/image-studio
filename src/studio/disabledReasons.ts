import { layerAncestors } from "../domain/layerHierarchy";
import type { ImageStudioLayer } from "../domain/document";
import type { Locale } from "../i18n";

// Hover text explaining why a control is disabled. Shown through the native `title`
// tooltip, which browsers still display on disabled buttons.
const en = {
  noDocument: "Open an image first.",
  noLayer: "Select a layer first.",
  rasterOnly: "Only available for image layers.",
  selectionUnsupported: "Selections are not available on this layer type.",
  layerLocked: "The layer or its group is locked.",
  layerHidden: "The layer or its group is hidden.",
  projectUnsaved: "Save the project first.",
  unsavedChanges: "Save your latest changes first.",
  saving: "The project is being saved…",
  saveConflict: "Resolve the save conflict first.",
  saveFailed: "The last save failed. Save again first.",
  fileBusy: "A file is being processed…",
  nothingToUndo: "Nothing to undo.",
  nothingToRedo: "Nothing to redo.",
  alignUnsupported: "Select visible, unlocked layers in the same group (not masks or adjustment layers). Inside a group, select at least 2 layers.",
  distributeNeedsThree: "Shift-click or Ctrl/⌘-click to select at least 3 layers.",
  notGrouped: "Only groups, or layers inside a group, can be ungrouped.",
  maxFilters: "A layer can have up to 8 filters.",
  needsSelection: "Make a selection on this layer first.",
  selectionOnOtherLayer: "The current selection belongs to another layer.",
  nothingToLift: "This layer has no strokes or objects to separate.",
  maxSelections: "Up to 32 selections can be stored.",
  noStoredSelection: "Choose a stored selection first.",
  noAnchor: "Select an anchor point first.",
  pathTooShort: "Add at least 2 anchor points.",
  resultPending: "Apply or readjust the current result first.",
};
type Copy = { [Key in keyof typeof en]: string };
export type DisabledReason = keyof Copy;

export const disabledReasonCopy: Record<Locale, Copy> = {
  en,
  ja: {
    noDocument: "先に画像を開いてください。",
    noLayer: "先にレイヤーを選択してください。",
    rasterOnly: "画像レイヤーでのみ使用できます。",
    selectionUnsupported: "この種類のレイヤーでは範囲選択を使用できません。",
    layerLocked: "レイヤーまたは所属グループがロックされています。",
    layerHidden: "レイヤーまたは所属グループが非表示です。",
    projectUnsaved: "先にプロジェクトを保存してください。",
    unsavedChanges: "先に最新の変更を保存してください。",
    saving: "プロジェクトを保存しています…",
    saveConflict: "先に保存の競合を解決してください。",
    saveFailed: "前回の保存に失敗しました。もう一度保存してください。",
    fileBusy: "ファイルを処理しています…",
    nothingToUndo: "元に戻せる操作がありません。",
    nothingToRedo: "やり直せる操作がありません。",
    alignUnsupported: "同じグループ内の表示中でロックされていないレイヤーを選択してください（マスク・調整レイヤーを除く）。グループ内では2つ以上選択してください。",
    distributeNeedsThree: "Shift または Ctrl/⌘ を押しながらクリックして、3つ以上のレイヤーを選択してください。",
    notGrouped: "グループ解除できるのは、グループまたはグループ内のレイヤーのみです。",
    maxFilters: "1つのレイヤーに追加できるフィルターは8個までです。",
    needsSelection: "先にこのレイヤーで範囲を選択してください。",
    selectionOnOtherLayer: "現在の選択範囲は別のレイヤーにあります。",
    nothingToLift: "このレイヤーには分離できる描画やオブジェクトがありません。",
    maxSelections: "保存できる選択範囲は32個までです。",
    noStoredSelection: "先に保存済みの選択範囲を選んでください。",
    noAnchor: "先にアンカーポイントを選択してください。",
    pathTooShort: "アンカーポイントを2つ以上追加してください。",
    resultPending: "先に現在の結果を適用するか、設定を調整してください。",
  },
  "zh-CN": {
    noDocument: "请先打开图片。",
    noLayer: "请先选择一个图层。",
    rasterOnly: "仅适用于图片图层。",
    selectionUnsupported: "此类图层不支持选区。",
    layerLocked: "图层或其所在组已锁定。",
    layerHidden: "图层或其所在组已隐藏。",
    projectUnsaved: "请先保存项目。",
    unsavedChanges: "请先保存最新的修改。",
    saving: "正在保存项目…",
    saveConflict: "请先解决保存冲突。",
    saveFailed: "上次保存失败，请重新保存。",
    fileBusy: "正在处理文件…",
    nothingToUndo: "没有可撤销的操作。",
    nothingToRedo: "没有可重做的操作。",
    alignUnsupported: "请选择同一组内可见且未锁定的图层（蒙版和调整图层除外）；在组内须至少选择 2 个图层。",
    distributeNeedsThree: "按住 Shift 或 Ctrl/⌘ 点选，至少选择 3 个图层。",
    notGrouped: "只有图层组或组内的图层可以取消编组。",
    maxFilters: "每个图层最多添加 8 个滤镜。",
    needsSelection: "请先在此图层上建立选区。",
    selectionOnOtherLayer: "当前选区属于其他图层。",
    nothingToLift: "此图层没有可分离的笔画或对象。",
    maxSelections: "最多可存档 32 个选区。",
    noStoredSelection: "请先选择一个已存档的选区。",
    noAnchor: "请先选择一个锚点。",
    pathTooShort: "请至少添加 2 个锚点。",
    resultPending: "请先应用或重新调整当前结果。",
  },
  "zh-TW": {
    noDocument: "請先開啟圖片。",
    noLayer: "請先選取一個圖層。",
    rasterOnly: "僅適用於圖片圖層。",
    selectionUnsupported: "此類圖層不支援選取。",
    layerLocked: "圖層或其所在群組已鎖定。",
    layerHidden: "圖層或其所在群組已隱藏。",
    projectUnsaved: "請先儲存專案。",
    unsavedChanges: "請先儲存最新的修改。",
    saving: "正在儲存專案…",
    saveConflict: "請先解決儲存衝突。",
    saveFailed: "上次儲存失敗，請重新儲存。",
    fileBusy: "正在處理檔案…",
    nothingToUndo: "沒有可復原的操作。",
    nothingToRedo: "沒有可重做的操作。",
    alignUnsupported: "請選取同一群組內可見且未鎖定的圖層（遮罩與調整圖層除外）；在群組內須至少選取 2 個圖層。",
    distributeNeedsThree: "按住 Shift 或 Ctrl/⌘ 點選，至少選取 3 個圖層。",
    notGrouped: "只有群組或群組內的圖層可以取消群組。",
    maxFilters: "每個圖層最多新增 8 個濾鏡。",
    needsSelection: "請先在此圖層上建立選取範圍。",
    selectionOnOtherLayer: "目前的選取範圍屬於其他圖層。",
    nothingToLift: "此圖層沒有可分離的筆畫或物件。",
    maxSelections: "最多可儲存 32 個選取範圍。",
    noStoredSelection: "請先選擇一個已儲存的選取範圍。",
    noAnchor: "請先選取一個錨點。",
    pathTooShort: "請至少新增 2 個錨點。",
    resultPending: "請先套用或重新調整目前結果。",
  },
};

/** Tooltip for a control: its label, followed by the reason on a new line when it is disabled. */
export function hintTitle(label: string, reason?: string | null): string {
  return reason ? `${label}\n${reason}` : label;
}

/** Why the selected layer cannot be edited, or null when it is editable. Mirrors layerIsEditable. */
export function layerEditBlocker(layers: ImageStudioLayer[], layer: ImageStudioLayer): DisabledReason | null {
  const chain = [layer, ...layerAncestors(layers, layer.id)];
  if (chain.some((candidate) => candidate.locked)) return "layerLocked";
  if (chain.some((candidate) => !candidate.visible)) return "layerHidden";
  return null;
}
