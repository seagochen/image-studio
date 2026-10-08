/** Product scope is explicit: new platform models do not automatically enter the editor. */
export const AI_EDITOR_MODE_IDS = ["denoise", "deblur", "upscale", "background_remove", "old_photo_restore", "colorize", "object_remove"] as const;
export type AiEditorModeId = typeof AI_EDITOR_MODE_IDS[number];
export const AI_EDITOR_FIELDS: Record<AiEditorModeId, readonly string[]> = {
  denoise: [], deblur: ["strength"], upscale: ["scale", "long_edge"],
  background_remove: ["product_effect", "shadow_direction", "effect_strength"],
  old_photo_restore: ["strength", "restoration_scale"], colorize: ["model_name", "input_size"], object_remove: ["dilate"],
};
export function isAiEditorMode(id: string): id is AiEditorModeId {
  return (AI_EDITOR_MODE_IDS as readonly string[]).includes(id);
}

const en = {
  denoise: ["Denoise", "Inspect grain and fine texture at 100%. Noise removal runs automatically.", "Noise removal"],
  deblur: ["Deblur", "Adjust restoration strength and inspect edges and small details.", "Restoration strength"],
  upscale: ["Super-resolution", "Choose an enlargement factor and a maximum long edge. Inspect the result size before applying.", "Output size"],
  background_remove: ["Background removal", "Review edges against transparent, light and dark backgrounds. Preview backgrounds are not added to the image.", "Cutout settings"],
  old_photo_restore: ["Old photo restoration", "Restore faded, blurred or damaged old photos. Choose restoration strength and output scale.", "Photo restoration"],
  colorize: ["Colorization", "Choose the colorization model and compare skin tones and scene colors with the original.", "Colorization settings"],
  object_remove: ["Local repair", "Mark the area to remove or repair. Red areas will be filled; unmarked pixels are protected.", "Repair area"],
  adjust: "Adjust settings",
  unavailable: "This model is not currently available.",
  original: "Original", result: "Result", compare: "Compare", apply: "Apply as new layer", automatic: "Automatic — no adjustable model parameters.",
  fit: "Fit", detail: "100%", zoom: "Preview zoom", background: "Preview background", transparent: "Transparent", light: "Light", dark: "Dark",
  draw: "Mark area", erase: "Erase marks", clear: "Clear", reset: "Use current selection / mask", size: "Brush size", mask: "Repair mask", maskNeeded: "Mark a repair area before running.",
  maskLarge: "For images larger than 4096 px per edge, create a selection or linked mask in the workbench first.", output: "Expected output", actual: "Result size", unchanged: "Original size", layer: "Source layer", applyHint: "Review the result, then apply it as a new layer. The source layer is preserved.", stale: "The document changed. Run the edit again before applying.",
};
type Copy = { [K in keyof typeof en]: typeof en[K] extends string[] ? [string, string, string] : string };
const zh: Copy = {
  denoise: ["去噪", "在 100% 下检查颗粒和细节。模型自动去噪，无需设置强度。", "噪点处理"],
  deblur: ["去模糊", "调整修复强度，在原始尺寸下检查边缘和细节。", "清晰度修复"],
  upscale: ["超分辨率", "选择放大倍率和长边上限，应用前确认结果尺寸。", "输出尺寸"],
  background_remove: ["抠图", "切换透明、浅色和深色背景检查边缘。预览背景不会写入图片。", "抠图设置"],
  old_photo_restore: ["老照片修复", "修复褪色、模糊和受损的老照片，设置修复强度和输出倍率。", "照片修复"],
  colorize: ["上色", "选择上色模型，对照原图检查肤色和场景色彩。", "上色设置"],
  object_remove: ["局部修补", "标记需要移除或修复的区域。红色区域会被填补，未标记区域保留。", "修补区域"],
  adjust: "重新调整",
  unavailable: "此模型目前尚不可用。",
  original: "原图", result: "结果", compare: "对比", apply: "应用为新图层", automatic: "自动处理，无需调整模型参数。",
  fit: "适合窗口", detail: "100%", zoom: "预览缩放", background: "预览背景", transparent: "透明", light: "浅色", dark: "深色",
  draw: "标记区域", erase: "擦除标记", clear: "清空", reset: "使用当前选区 / 蒙版", size: "画笔尺寸", mask: "修补蒙版", maskNeeded: "请先标记需要修补的区域。",
  maskLarge: "单边超过 4096 像素的图片，请先在工作台创建选区或关联蒙版。", output: "预计输出", actual: "结果尺寸", unchanged: "保持原始尺寸", layer: "源图层", applyHint: "检查结果后应用为新图层，保留源图层。", stale: "文档已变化，请重新运行后再应用。",
};
const zhTW: Copy = {
  denoise: ["去噪", "在 100% 下檢查顆粒和細節。模型自動去噪，無需設定強度。", "雜訊處理"],
  deblur: ["去模糊", "調整修復強度，在原始尺寸下檢查邊緣和細節。", "清晰度修復"],
  upscale: ["超解析度", "選擇放大倍率和長邊上限，套用前確認結果尺寸。", "輸出尺寸"],
  background_remove: ["去背", "切換透明、淺色和深色背景檢查邊緣。預覽背景不會寫入圖片。", "去背設定"],
  old_photo_restore: ["老照片修復", "修復褪色、模糊和受損的老照片，設定修復強度和輸出倍率。", "照片修復"],
  colorize: ["上色", "選擇上色模型，對照原圖檢查膚色和場景色彩。", "上色設定"],
  object_remove: ["局部修補", "標記需要移除或修復的區域。紅色區域會被填補，未標記區域保留。", "修補區域"],
  adjust: "重新調整",
  unavailable: "此模型目前尚不可用。",
  original: "原圖", result: "結果", compare: "對比", apply: "套用為新圖層", automatic: "自動處理，無需調整模型參數。",
  fit: "適合視窗", detail: "100%", zoom: "預覽縮放", background: "預覽背景", transparent: "透明", light: "淺色", dark: "深色",
  draw: "標記區域", erase: "擦除標記", clear: "清空", reset: "使用目前選取範圍 / 遮罩", size: "筆刷尺寸", mask: "修補遮罩", maskNeeded: "請先標記需要修補的區域。",
  maskLarge: "單邊超過 4096 像素的圖片，請先在工作區建立選取範圍或關聯遮罩。", output: "預計輸出", actual: "結果尺寸", unchanged: "保持原始尺寸", layer: "來源圖層", applyHint: "檢查結果後套用為新圖層，保留來源圖層。", stale: "文件已變更，請重新執行後再套用。",
};
const ja: Copy = {
  ...en, denoise: ["ノイズ除去", "100%表示で粒状感と細部を確認します。自動でノイズを除去します。", "ノイズ処理"],
  deblur: ["ぼかし除去", "修復強度を調整し、輪郭と細部を確認します。", "鮮明化"],
  upscale: ["超解像度", "倍率または長辺を設定し、結果のサイズを確認します。", "出力サイズ"],
  background_remove: ["背景除去", "透明・明るい・暗い背景で輪郭を確認します。背景はプレビュー専用です。", "背景除去設定"],
  old_photo_restore: ["古写真の修復", "色褪せ・ぼけ・傷を修復します。強度と出力倍率を設定します。", "写真の修復"],
  colorize: ["カラー化", "モデルを選び、肌や風景の色を原画像と比較します。", "カラー化設定"],
  object_remove: ["部分修復", "修復範囲を塗ります。赤い範囲を補完し、他の部分を保護します。", "修復範囲"],
  adjust: "設定を調整",
  unavailable: "このモデルは現在利用できません。",
  original: "原画像", result: "結果", compare: "比較", apply: "新しいレイヤーとして適用", automatic: "自動処理：調整可能なパラメータはありません。",
  fit: "画面に合わせる", detail: "100%", zoom: "表示倍率", background: "プレビュー背景", transparent: "透明", light: "明るい", dark: "暗い",
  draw: "範囲を塗る", erase: "消す", clear: "クリア", reset: "現在の選択 / マスクを使用", size: "ブラシサイズ", mask: "修復マスク", maskNeeded: "修復範囲を指定してください。",
  maskLarge: "1辺が4096pxを超える画像は、先にワークスペースで選択範囲かマスクを作成してください。", output: "予定サイズ", actual: "結果サイズ", unchanged: "原画像のサイズ", layer: "元レイヤー", applyHint: "結果を確認してから、新しいレイヤーに適用します。", stale: "ドキュメントが変更されました。再実行してから適用してください。",
};
export function aiEditorCopy(language: string): Copy {
  if (language === "zh-TW") return zhTW;
  if (language.startsWith("zh")) return zh;
  return language === "ja" ? ja : en as Copy;
}
