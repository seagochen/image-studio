import { useEffect, useState } from "react";
import { persistLocale, storedLocale, type Locale } from "../../shared/locale";
export type { Locale } from "../../shared/locale";

const coreLabelsEn = {
  title: "Image Studio", dashboard: "Dashboard", account: "Account", import: "Open image",
  select: "Select", hand: "Pan", brush: "Brush", eraser: "Eraser", eyedropper: "Eyedropper", undo: "Undo", redo: "Redo",
  fit: "Fit", reset: "100%", layers: "Layers", propertiesTab: "Properties", inspectorPanels: "Editing panels", layerActions: "Layer actions", newLayer: "New layer", paintLayer: "Paint", maskLayer: "Mask", annotationLayer: "Text & shapes", adjustLayer: "Adjustment layer",
  navigator: "Navigator", navigatorCollapse: "Collapse navigator", navigatorExpand: "Expand navigator",
  duplicate: "Duplicate", remove: "Delete", up: "Up", down: "Down", visible: "Visible", locked: "Locked", showLayer: "Show layer", hideLayer: "Hide layer", lockLayer: "Lock layer", unlockLayer: "Unlock layer",
  opacity: "Opacity", name: "Name", parameters: "Parameters", colorWheel: "Color wheel", pickColor: "Pick color", blendMode: "Blend mode", blendNormal: "Normal", blendMultiply: "Multiply", blendScreen: "Screen", blendOverlay: "Overlay", blendDarken: "Darken", blendLighten: "Lighten",
  saturation: "Saturation", lightness: "Lightness", colorScheme: "Color scheme", tolerance: "Tolerance", clearSelectedPixels: "Clear selected pixels", clearSelection: "Deselect", selectionReady: "Pixel selection active", selectionOperation: "Selection operation", selectionReplace: "Replace", selectionAdd: "Add", selectionSubtract: "Subtract", selectionIntersect: "Intersect", invertSelection: "Invert selection",
  schemeComplementary: "Complementary", schemeSplitComplementary: "Split-complementary", schemeMonochromatic: "Monochromatic", schemeAnalogous: "Analogous", schemeTriadic: "Triadic", schemeTetradic: "Tetradic",
  harmonyBase: "Base color", harmonyComplementary: "Complementary", harmonySplit1: "Split 1", harmonySplit2: "Split 2", harmonyAnalogous1: "Analogous 1", harmonyAnalogous2: "Analogous 2", harmonyTriadic2: "Triadic 2", harmonyTriadic3: "Triadic 3", harmonyTetradic2: "Tetradic 2", harmonyTetradic3: "Tetradic 3", harmonyTetradic4: "Tetradic 4",
  emptyTitle: "Open an image to start editing", emptyHint: "PNG, JPEG, or WebP (up to 40 megapixels)",
  unsupported: "Select a PNG, JPEG, or WebP image.", tooLarge: "The image is too large (40 megapixels, 16,384px per edge, or 50MiB maximum).", pixelTooLarge: "Direct pixel editing supports images up to 16 megapixels.",
  decodeFailed: "The image could not be decoded. Select another, uncorrupted image.", authFailed: "Your session could not be verified.",
  brushSize: "Size", maskValue: "Mask value", history: "History", selected: "Selected", noSelection: "Select a layer",
  filters: "Filters", annotate: "Text & shapes", pixelTools: "Pixel tools",
  adjust: "Adjust", aiEdit: "AI edit", editFailed: "The edited image could not be applied.", projects: "Projects", newProject: "New project", projectName: "Project name", save: "Save", saving: "Saving", saved: "Saved", saveConflict: "Conflict", submitTicket: "Submit a support ticket", projectRevision: "Revision",
  export: "Export", exportTitle: "Export image or project", exportFormat: "Format", exportWidth: "Width", exportHeight: "Height", exportQuality: "Quality", jpegBackground: "JPEG background", exportMemoryWarning: "This size uses substantial browser memory. Close other tabs before continuing.", exportingImage: "Exporting image…", exportingProject: "Packaging project…", exportProject: "Export project", downloadImage: "Download image", importProject: "Import project", packageFailed: "This file could not be opened as a safe Image Studio project.", close: "Close", cancel: "Cancel", tools: "Image tools", canvasLabel: "Image canvas", language: "Language", offline: "You are offline. The local draft is retained and can be saved after reconnecting.", draftFailed: "The browser storage quota prevented the local draft from being saved.", draftAvailable: "An unsaved local draft is available.", conflictDraft: "A newer server revision exists. This draft can be recovered as a copy.", restoreDraft: "Restore draft", restoreCopy: "Restore as copy", discardDraft: "Discard", openRemote: "Open server version",
  aiTitle: "AI edit", loadingModels: "Loading available models…", mode: "Mode", noModes: "No image editing mode is available.", status: "Status", stopWaiting: "Stop waiting", resume: "Resume", retry: "Retry", run: "Run", operationResume: "An unfinished AI operation can be resumed.", aiMaskActive: "The current selection or linked mask will be sent (white editable, black protected).", aiMaskRequired: "This mode requires a current selection or linked mask.",
  editorLoading: "Loading image editor…", saveSucceeded: "Project saved", saveFailed: "The project could not be saved", statusDraft: "Draft", statusSubmitting: "Submitting", statusRunning: "Running", statusResultReady: "Result ready to apply", statusSucceeded: "Completed", statusFailed: "Failed", statusDeliveryFailed: "Result delivery failed", statusCancelled: "Waiting stopped", statusStale: "Stale",
};

export type MessageKey = keyof typeof coreLabelsEn;
type CoreLabels = { [Key in MessageKey]: string };

export const CORE_LABELS: Record<Locale, CoreLabels> = {
  ja: {
    title: "画像スタジオ", dashboard: "ダッシュボード", account: "アカウント", import: "画像を開く",
    select: "選択", hand: "移動", brush: "ブラシ", eraser: "消しゴム", eyedropper: "スポイト", undo: "元に戻す", redo: "やり直す",
    fit: "全体表示", reset: "100%", layers: "レイヤー", propertiesTab: "プロパティ", inspectorPanels: "編集パネル", layerActions: "レイヤー操作", newLayer: "新規レイヤー", paintLayer: "ペイント", maskLayer: "マスク", annotationLayer: "文字と図形", adjustLayer: "調整レイヤー",
    navigator: "ナビゲーター", navigatorCollapse: "ナビゲーターを閉じる", navigatorExpand: "ナビゲーターを開く",
    duplicate: "複製", remove: "削除", up: "上へ", down: "下へ", visible: "表示", locked: "ロック", showLayer: "レイヤーを表示", hideLayer: "レイヤーを非表示", lockLayer: "レイヤーをロック", unlockLayer: "レイヤーのロックを解除",
    opacity: "不透明度", name: "名前", parameters: "パラメーター", colorWheel: "カラーホイール", pickColor: "色を取得", blendMode: "描画モード", blendNormal: "通常", blendMultiply: "乗算", blendScreen: "スクリーン", blendOverlay: "オーバーレイ", blendDarken: "比較（暗）", blendLighten: "比較（明）",
    saturation: "彩度", lightness: "明度", colorScheme: "配色スキーム", tolerance: "許容値", clearSelectedPixels: "選択範囲のピクセルを削除", clearSelection: "選択解除", selectionReady: "ピクセル範囲を選択中", selectionOperation: "選択操作", selectionReplace: "置き換え", selectionAdd: "追加", selectionSubtract: "削除", selectionIntersect: "共通部分", invertSelection: "選択範囲を反転",
    schemeComplementary: "補色", schemeSplitComplementary: "分割補色", schemeMonochromatic: "モノクロマティック", schemeAnalogous: "類似色", schemeTriadic: "トライアド", schemeTetradic: "テトラード",
    harmonyBase: "ベースカラー", harmonyComplementary: "補色", harmonySplit1: "分割補色 1", harmonySplit2: "分割補色 2", harmonyAnalogous1: "類似色 1", harmonyAnalogous2: "類似色 2", harmonyTriadic2: "トライアド 2", harmonyTriadic3: "トライアド 3", harmonyTetradic2: "テトラード 2", harmonyTetradic3: "テトラード 3", harmonyTetradic4: "テトラード 4",
    emptyTitle: "画像を開いて編集を始める", emptyHint: "PNG、JPEG、WebP（最大40メガピクセル）",
    unsupported: "PNG、JPEG、WebP画像を選択してください。", tooLarge: "画像が大きすぎます（最大40メガピクセル、1辺16,384px、50MiB）。", pixelTooLarge: "直接ピクセル編集は16メガピクセル以下の画像に対応しています。",
    decodeFailed: "画像を読み込めませんでした。破損していない別の画像を選択してください。",
    authFailed: "ログイン状態を確認できませんでした。", brushSize: "サイズ", maskValue: "マスク値", history: "履歴",
    filters: "フィルター", annotate: "文字と図形", pixelTools: "ピクセルツール",
    selected: "選択中", noSelection: "レイヤーを選択してください", adjust: "調整", aiEdit: "AI編集", editFailed: "編集結果を適用できませんでした。", projects: "プロジェクト", newProject: "新規プロジェクト", projectName: "プロジェクト名", save: "保存", saving: "保存中", saved: "保存済み", saveConflict: "競合", submitTicket: "サポートチケットを送信", projectRevision: "リビジョン",
    export: "書き出す", exportTitle: "画像またはプロジェクトを書き出す", exportFormat: "形式", exportWidth: "幅", exportHeight: "高さ", exportQuality: "品質", jpegBackground: "JPEG背景", exportMemoryWarning: "このサイズはブラウザのメモリを多く使用します。ほかのタブを閉じてください。", exportingImage: "画像を書き出しています…", exportingProject: "プロジェクトを梱包しています…", exportProject: "プロジェクトを書き出す", downloadImage: "画像をダウンロード", importProject: "プロジェクトを読み込む", packageFailed: "安全なImage Studioプロジェクトとして読み込めませんでした。", close: "閉じる", cancel: "キャンセル", tools: "画像ツール", canvasLabel: "画像キャンバス", language: "言語", offline: "オフラインです。ローカル下書きは保持され、接続回復後に保存できます。", draftFailed: "ブラウザの保存容量が不足しているため、ローカル下書きを保存できません。", draftAvailable: "未保存のローカル下書きがあります。", conflictDraft: "サーバーに新しい版があります。この下書きはコピーとして復元できます。", restoreDraft: "下書きを復元", restoreCopy: "コピーとして復元", discardDraft: "破棄", openRemote: "サーバー版を開く",
    aiTitle: "AI編集", loadingModels: "利用可能なモデルを読み込んでいます…", mode: "モード", noModes: "利用可能な画像編集モードがありません。", status: "状態", stopWaiting: "待機を停止", resume: "再開", retry: "再試行", run: "実行", operationResume: "未完了のAI操作を再開できます。", aiMaskActive: "現在の選択範囲またはリンク済みマスクを送信します（白＝編集、黒＝保護）。", aiMaskRequired: "このモードには現在の選択範囲またはリンク済みマスクが必要です。",
    editorLoading: "画像エディターを読み込んでいます…", saveSucceeded: "プロジェクトを保存しました", saveFailed: "プロジェクトを保存できませんでした", statusDraft: "下書き", statusSubmitting: "送信中", statusRunning: "実行中", statusResultReady: "結果を適用できます", statusSucceeded: "完了", statusFailed: "失敗", statusDeliveryFailed: "結果の取得に失敗", statusCancelled: "待機停止", statusStale: "期限切れ",
  },
  en: coreLabelsEn,
  "zh-CN": {
    title: "图片工作室", dashboard: "控制台", account: "账户", import: "打开图片",
    select: "选择", hand: "平移", brush: "画笔", eraser: "橡皮擦", eyedropper: "取色器", undo: "撤销", redo: "重做",
    fit: "适合画布", reset: "100%", layers: "图层", propertiesTab: "属性", inspectorPanels: "编辑面板", layerActions: "图层操作", newLayer: "新建图层", paintLayer: "绘画图层", maskLayer: "蒙版图层", annotationLayer: "文字与图形图层", adjustLayer: "调整图层",
    navigator: "导航器", navigatorCollapse: "收起导航器", navigatorExpand: "展开导航器",
    duplicate: "复制", remove: "删除", up: "上移", down: "下移", visible: "显示", locked: "锁定", showLayer: "显示图层", hideLayer: "隐藏图层", lockLayer: "锁定图层", unlockLayer: "解锁图层",
    opacity: "不透明度", name: "名称", parameters: "参数", colorWheel: "颜色轮盘", pickColor: "吸取颜色", blendMode: "混合模式", blendNormal: "正常", blendMultiply: "正片叠底", blendScreen: "滤色", blendOverlay: "叠加", blendDarken: "变暗", blendLighten: "变亮",
    saturation: "饱和度", lightness: "亮度", colorScheme: "配色方案", tolerance: "容差", clearSelectedPixels: "删除选区像素", clearSelection: "取消选区", selectionReady: "像素选区已激活", selectionOperation: "选区操作", selectionReplace: "替换", selectionAdd: "添加", selectionSubtract: "减去", selectionIntersect: "相交", invertSelection: "反选",
    schemeComplementary: "互补色", schemeSplitComplementary: "分裂互补色", schemeMonochromatic: "单色调", schemeAnalogous: "邻近色", schemeTriadic: "三色组", schemeTetradic: "四色组",
    harmonyBase: "基础色", harmonyComplementary: "互补色", harmonySplit1: "分裂色 1", harmonySplit2: "分裂色 2", harmonyAnalogous1: "邻近色 1", harmonyAnalogous2: "邻近色 2", harmonyTriadic2: "三色组 2", harmonyTriadic3: "三色组 3", harmonyTetradic2: "四色组 2", harmonyTetradic3: "四色组 3", harmonyTetradic4: "四色组 4",
    emptyTitle: "打开图片开始编辑", emptyHint: "支持 PNG、JPEG、WebP，最大 4000 万像素",
    unsupported: "请选择 PNG、JPEG 或 WebP 图片。", tooLarge: "图片过大（最多 4000 万像素、单边 16,384px、50MiB）。", pixelTooLarge: "直接像素编辑支持最大 1600 万像素的图片。",
    decodeFailed: "无法解码图片，请选择另一张未损坏的图片。", authFailed: "无法确认登录状态。",
    brushSize: "尺寸", maskValue: "蒙版灰度", history: "历史", selected: "已选择", noSelection: "请选择图层",
    filters: "滤镜", annotate: "文字与图形", pixelTools: "像素工具",
    adjust: "调整", aiEdit: "AI 编辑", editFailed: "无法应用编辑结果。", projects: "项目", newProject: "新项目", projectName: "项目名称", save: "保存", saving: "保存中", saved: "已保存", saveConflict: "保存冲突", submitTicket: "提交工单", projectRevision: "版本",
    export: "导出", exportTitle: "导出图片或项目", exportFormat: "格式", exportWidth: "宽度", exportHeight: "高度", exportQuality: "质量", jpegBackground: "JPEG 背景", exportMemoryWarning: "此尺寸将占用较多浏览器内存，建议关闭其他标签页后继续。", exportingImage: "正在导出图片…", exportingProject: "正在打包项目…", exportProject: "导出项目", downloadImage: "下载图片", importProject: "导入项目", packageFailed: "无法将此文件作为安全的 Image Studio 项目打开。", close: "关闭", cancel: "取消", tools: "图片工具", canvasLabel: "图片画布", language: "语言", offline: "当前离线。本地草稿已保留，恢复连接后可继续保存。", draftFailed: "浏览器存储空间不足，无法保存本地草稿。", draftAvailable: "发现未保存的本地草稿。", conflictDraft: "服务器已有更新版本，可将此草稿恢复为副本。", restoreDraft: "恢复草稿", restoreCopy: "恢复为副本", discardDraft: "丢弃", openRemote: "打开服务器版本",
    aiTitle: "AI 编辑", loadingModels: "正在加载可用模型…", mode: "模式", noModes: "当前没有可用的图片编辑模式。", status: "状态", stopWaiting: "停止等待", resume: "继续", retry: "重试", run: "运行", operationResume: "可以继续未完成的 AI 操作。", aiMaskActive: "将发送当前选区或已绑定蒙版（白色可编辑，黑色受保护）。", aiMaskRequired: "此模式需要当前选区或已绑定蒙版。",
    editorLoading: "正在加载图片编辑器…", saveSucceeded: "项目保存成功", saveFailed: "项目保存失败", statusDraft: "草稿", statusSubmitting: "正在提交", statusRunning: "运行中", statusResultReady: "结果待应用", statusSucceeded: "已完成", statusFailed: "失败", statusDeliveryFailed: "结果获取失败", statusCancelled: "已停止等待", statusStale: "已过期",
  },
  "zh-TW": {
    title: "圖片工作室", dashboard: "控制台", account: "帳戶", import: "開啟圖片",
    select: "選取", hand: "平移", brush: "畫筆", eraser: "橡皮擦", eyedropper: "取色器", undo: "復原", redo: "重做",
    fit: "適合畫布", reset: "100%", layers: "圖層", propertiesTab: "屬性", inspectorPanels: "編輯面板", layerActions: "圖層操作", newLayer: "新建圖層", paintLayer: "繪畫圖層", maskLayer: "遮罩圖層", annotationLayer: "文字與圖形圖層", adjustLayer: "調整圖層",
    navigator: "導覽器", navigatorCollapse: "收合導覽器", navigatorExpand: "展開導覽器",
    duplicate: "複製", remove: "刪除", up: "上移", down: "下移", visible: "顯示", locked: "鎖定", showLayer: "顯示圖層", hideLayer: "隱藏圖層", lockLayer: "鎖定圖層", unlockLayer: "解鎖圖層",
    opacity: "不透明度", name: "名稱", parameters: "參數", colorWheel: "顏色輪盤", pickColor: "吸取顏色", blendMode: "混合模式", blendNormal: "正常", blendMultiply: "色彩增值", blendScreen: "濾色", blendOverlay: "覆蓋", blendDarken: "變暗", blendLighten: "變亮",
    saturation: "飽和度", lightness: "亮度", colorScheme: "配色方案", tolerance: "容差", clearSelectedPixels: "刪除選取像素", clearSelection: "取消選取", selectionReady: "像素選取已啟用", selectionOperation: "選取操作", selectionReplace: "取代", selectionAdd: "新增", selectionSubtract: "減去", selectionIntersect: "交集", invertSelection: "反轉選取",
    schemeComplementary: "互補色", schemeSplitComplementary: "分裂互補色", schemeMonochromatic: "單色調", schemeAnalogous: "鄰近色", schemeTriadic: "三色組", schemeTetradic: "四色組",
    harmonyBase: "基礎色", harmonyComplementary: "互補色", harmonySplit1: "分裂色 1", harmonySplit2: "分裂色 2", harmonyAnalogous1: "鄰近色 1", harmonyAnalogous2: "鄰近色 2", harmonyTriadic2: "三色組 2", harmonyTriadic3: "三色組 3", harmonyTetradic2: "四色組 2", harmonyTetradic3: "四色組 3", harmonyTetradic4: "四色組 4",
    emptyTitle: "開啟圖片開始編輯", emptyHint: "支援 PNG、JPEG、WebP，最大 4000 萬像素",
    unsupported: "請選擇 PNG、JPEG 或 WebP 圖片。", tooLarge: "圖片過大（最多 4000 萬像素、單邊 16,384px、50MiB）。", pixelTooLarge: "直接像素編輯支援最大 1600 萬像素的圖片。",
    decodeFailed: "無法解碼圖片，請選擇另一張未損壞的圖片。", authFailed: "無法確認登入狀態。",
    brushSize: "尺寸", maskValue: "遮罩灰階", history: "歷史", selected: "已選取", noSelection: "請選擇圖層",
    filters: "濾鏡", annotate: "文字與圖形", pixelTools: "像素工具",
    adjust: "調整", aiEdit: "AI 編輯", editFailed: "無法套用編輯結果。", projects: "專案", newProject: "新專案", projectName: "專案名稱", save: "儲存", saving: "儲存中", saved: "已儲存", saveConflict: "儲存衝突", submitTicket: "提交工單", projectRevision: "版本",
    export: "匯出", exportTitle: "匯出圖片或專案", exportFormat: "格式", exportWidth: "寬度", exportHeight: "高度", exportQuality: "品質", jpegBackground: "JPEG 背景", exportMemoryWarning: "此尺寸將使用較多瀏覽器記憶體，建議關閉其他分頁後繼續。", exportingImage: "正在匯出圖片…", exportingProject: "正在封裝專案…", exportProject: "匯出專案", downloadImage: "下載圖片", importProject: "匯入專案", packageFailed: "無法將此檔案作為安全的 Image Studio 專案開啟。", close: "關閉", cancel: "取消", tools: "圖片工具", canvasLabel: "圖片畫布", language: "語言", offline: "目前離線。本機草稿已保留，恢復連線後可繼續儲存。", draftFailed: "瀏覽器儲存空間不足，無法儲存本機草稿。", draftAvailable: "發現未儲存的本機草稿。", conflictDraft: "伺服器已有更新版本，可將此草稿恢復為副本。", restoreDraft: "恢復草稿", restoreCopy: "恢復為副本", discardDraft: "捨棄", openRemote: "開啟伺服器版本",
    aiTitle: "AI 編輯", loadingModels: "正在載入可用模型…", mode: "模式", noModes: "目前沒有可用的圖片編輯模式。", status: "狀態", stopWaiting: "停止等待", resume: "繼續", retry: "重試", run: "執行", operationResume: "可以繼續未完成的 AI操作。", aiMaskActive: "將送出目前選取範圍或已連結遮罩（白色可編輯，黑色保護）。", aiMaskRequired: "此模式需要目前選取範圍或已連結遮罩。",
    editorLoading: "正在載入圖片編輯器…", saveSucceeded: "專案儲存成功", saveFailed: "專案儲存失敗", statusDraft: "草稿", statusSubmitting: "正在提交", statusRunning: "執行中", statusResultReady: "結果待套用", statusSucceeded: "已完成", statusFailed: "失敗", statusDeliveryFailed: "結果取得失敗", statusCancelled: "已停止等待", statusStale: "已過期",
  },
};

export function useI18n(): { locale: Locale; setLocale: (locale: Locale) => void; t: (key: MessageKey) => string } {
  const [locale, setCurrentLocale] = useState<Locale>(storedLocale);
  const setLocale = (next: Locale) => {
    persistLocale(next);
    setCurrentLocale(next);
  };
  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = `${CORE_LABELS[locale].title} · Skills Master`;
  }, [locale]);
  return { locale, setLocale, t: (key) => CORE_LABELS[locale][key] };
}
