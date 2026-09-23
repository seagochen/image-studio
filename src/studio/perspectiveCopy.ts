import type { Locale } from "../../../shared/locale";

const en = { title: "Perspective correction", hint: "Drag corners in order: top left, top right, bottom right, bottom left. Output is added as a new layer.", source: "Source corners", preview: "Corrected preview", width: "Width", height: "Height", reset: "Reset", cancel: "Cancel", apply: "Add corrected layer", loading: "Loading…", working: "Processing", invalid: "Choose a convex, non-crossing quadrilateral and integer output dimensions (up to 40 MP / 16,384 px per edge).", failed: "Could not process this image. Try a smaller output or reopen the tool.", corner: "Corner" };

type PerspectiveCopy = { [Key in keyof typeof en]: string };

export const perspectiveCopy: Record<Locale, PerspectiveCopy> = {
  en,
  ja: { title: "遠近補正", hint: "左上・右上・右下・左下の順で頂点を動かしてください。結果は新しいレイヤーに追加されます。", source: "元画像の頂点", preview: "補正プレビュー", width: "幅", height: "高さ", reset: "リセット", cancel: "キャンセル", apply: "補正レイヤーを追加", loading: "読み込み中…", working: "処理中", invalid: "交差しない凸四角形と整数の出力サイズを指定してください（最大40MP・1辺16,384px）。", failed: "処理できませんでした。出力を小さくするか、ツールを開き直してください。", corner: "頂点" },
  "zh-CN": { title: "透视校正", hint: "按左上、右上、右下、左下顺序拖动四角。校正结果将添加为新图层。", source: "原图四角", preview: "校正预览", width: "宽度", height: "高度", reset: "重置", cancel: "取消", apply: "添加校正图层", loading: "正在加载…", working: "正在处理", invalid: "请选择不交叉的凸四边形，输出宽高须为整数（最多 4000 万像素、单边 16,384px）。", failed: "无法处理图片，请减小输出尺寸或重新打开工具。", corner: "角点" },
  "zh-TW": { title: "透視校正", hint: "按左上、右上、右下、左下順序拖動四角。校正結果將新增為圖層。", source: "原圖四角", preview: "校正預覽", width: "寬度", height: "高度", reset: "重設", cancel: "取消", apply: "新增校正圖層", loading: "正在載入…", working: "正在處理", invalid: "請選擇不交叉的凸四邊形，輸出寬高須為整數（最多 4000 萬像素、單邊 16,384px）。", failed: "無法處理圖片，請縮小輸出尺寸或重新開啟工具。", corner: "頂點" },
};
