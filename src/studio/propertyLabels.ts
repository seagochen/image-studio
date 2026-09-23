import type { Locale } from "../../../shared/locale";

const en = { width: "Width", height: "Height", radiusSize: "Radius", sides: "Sides", rotation: "Rotation", text: "Text content", font: "Font family", size: "Font size", color: "Text color", align: "Alignment", left: "Left", center: "Center", right: "Right", stroke: "Stroke color", strokeWidth: "Stroke width", fill: "Fill color", filled: "Fill shape", radius: "Corner radius", element: "Object", strength: "Smudge strength", opacity: "Opacity", endColor: "End color", transparent: "Transparent end", cloneHelp: "Alt-click the canvas to choose a clone source.", edit: "Edit object" };

type PropertyLabels = { [Key in keyof typeof en]: string };

export const PROPERTY_LABELS: Record<Locale, PropertyLabels> = {
  en,
  ja: { width: "幅", height: "高さ", radiusSize: "半径", sides: "辺の数", rotation: "回転", text: "テキスト内容", font: "フォント", size: "文字サイズ", color: "文字色", align: "文字揃え", left: "左", center: "中央", right: "右", stroke: "線の色", strokeWidth: "線の太さ", fill: "塗りつぶし色", filled: "塗りつぶし", radius: "角の丸み", element: "オブジェクト", strength: "ぼかしの強さ", opacity: "不透明度", endColor: "終点の色", transparent: "終点を透明に", cloneHelp: "Alt キーを押しながら画布をクリックして複製元を指定します。", edit: "オブジェクトを編集" },
  "zh-CN": { width: "宽度", height: "高度", radiusSize: "半径", sides: "边数", rotation: "旋转", text: "文字内容", font: "字体", size: "字号", color: "文字颜色", align: "对齐", left: "左对齐", center: "居中", right: "右对齐", stroke: "描边颜色", strokeWidth: "描边宽度", fill: "填充颜色", filled: "填充图形", radius: "圆角半径", element: "对象", strength: "涂抹强度", opacity: "不透明度", endColor: "终点颜色", transparent: "透明终点", cloneHelp: "按住 Alt 点击画布，设置仿制源。", edit: "编辑对象" },
  "zh-TW": { width: "寬度", height: "高度", radiusSize: "半徑", sides: "邊數", rotation: "旋轉", text: "文字內容", font: "字型", size: "字號", color: "文字顏色", align: "對齊", left: "靠左", center: "置中", right: "靠右", stroke: "描邊顏色", strokeWidth: "描邊寬度", fill: "填色", filled: "填滿圖形", radius: "圓角半徑", element: "物件", strength: "塗抹強度", opacity: "不透明度", endColor: "終點顏色", transparent: "透明終點", cloneHelp: "按住 Alt 點擊畫布，設定仿製來源。", edit: "編輯物件" },
};
