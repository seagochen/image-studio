import type { PixelSelectionMask } from "../domain/pixelTools";
import type { ProductIconName } from "./ProductIcon";
import type { Locale } from "../../../shared/locale";

/**
 * Tool catalog shared between Studio.tsx's toolbar rendering and the pointer
 * session hook (useRasterToolSession) — kept in its own module so neither
 * has to import the other (Issue #163).
 */
export type Tool = "select" | "hand" | "marquee" | "ellipseMarquee" | "lasso" | "polygonLasso" | "magicWand" | "brush" | "eraser" | "text" | "shape" | "airbrush" | "smudge" | "clone" | "gradient" | "eyedropper";
export type ShapeTool = "line" | "rect" | "star" | "ellipse" | "triangle" | "pentagon" | "arrow";

export interface PixelSelection extends PixelSelectionMask { layerId: string; }
export interface MarqueeDraft { start: { x: number; y: number }; end: { x: number; y: number }; }

export const TOOL_ICONS: Record<Tool, ProductIconName> = { select: "select", hand: "hand", marquee: "marquee", ellipseMarquee: "marquee", lasso: "shape", polygonLasso: "polygon", magicWand: "magic-wand", brush: "brush", eraser: "eraser", text: "text", shape: "shape", airbrush: "airbrush", smudge: "smudge", clone: "clone-stamp", gradient: "gradient", eyedropper: "eyedropper" };
export const NAVIGATION_TOOLS: readonly Tool[] = ["select", "hand"];
export const BASIC_DRAWING_TOOLS: readonly Tool[] = ["brush", "eraser", "eyedropper", "text"];
export const SECONDARY_TOOLS: readonly Tool[] = ["airbrush", "smudge", "clone", "gradient"];
export const SELECTION_TOOLS: readonly Tool[] = ["marquee", "ellipseMarquee", "lasso", "polygonLasso", "magicWand"];
export const SHAPE_ICONS: Record<ShapeTool, ProductIconName> = { line: "line", rect: "rectangle", star: "star", ellipse: "ellipse", triangle: "triangle", pentagon: "polygon", arrow: "arrow" };
export const DIRECT_PIXEL_TOOLS: readonly Tool[] = ["brush", "eraser", "airbrush", "smudge", "clone", "gradient"];
export const PIXEL_CANVAS_TOOLS: readonly Tool[] = [...DIRECT_PIXEL_TOOLS, ...SELECTION_TOOLS];
export const SIZED_CURSOR_TOOLS: readonly Tool[] = ["brush", "eraser", "airbrush", "smudge", "clone"];
const toolLabelsEn = { text: "Text", shape: "Shapes", marquee: "Rectangular marquee", ellipseMarquee: "Elliptical marquee", lasso: "Lasso", polygonLasso: "Polygonal lasso", magicWand: "Magic wand", selection: "Pixel selection", airbrush: "Airbrush", smudge: "Smudge", clone: "Clone stamp", gradient: "Gradient", advanced: "Advanced edit", line: "Line", rect: "Rectangle", star: "Star", ellipse: "Ellipse", triangle: "Triangle", pentagon: "Pentagon", arrow: "Arrow" };

type ToolLabels = { [Key in keyof typeof toolLabelsEn]: string };

export const TOOL_LABELS = {
  en: toolLabelsEn,
  ja: { text: "テキスト", shape: "図形", marquee: "長方形選択", ellipseMarquee: "楕円形選択", lasso: "なげなわ選択", polygonLasso: "多角形選択", magicWand: "自動選択", selection: "範囲選択", airbrush: "エアブラシ", smudge: "ぼかし", clone: "スタンプ", gradient: "グラデーション", advanced: "高度な編集", line: "直線", rect: "四角形", star: "星", ellipse: "楕円", triangle: "三角形", pentagon: "五角形", arrow: "矢印" },
  "zh-CN": { text: "文字", shape: "形状", marquee: "矩形选区", ellipseMarquee: "椭圆选区", lasso: "套索", polygonLasso: "多边形套索", magicWand: "魔棒选区", selection: "像素选区", airbrush: "喷枪", smudge: "涂抹", clone: "仿制图章", gradient: "渐变", advanced: "高级编辑", line: "直线", rect: "矩形", star: "星形", ellipse: "圆形", triangle: "三角形", pentagon: "五边形", arrow: "箭头" },
  "zh-TW": { text: "文字", shape: "形狀", marquee: "矩形選取", magicWand: "魔術棒選取", selection: "像素選取", airbrush: "噴槍", smudge: "塗抹", clone: "仿製印章", gradient: "漸層", advanced: "進階編輯", line: "直線", rect: "矩形", star: "星形", ellipse: "圓形", triangle: "三角形", pentagon: "五邊形", arrow: "箭頭" },
} as Record<Locale, ToolLabels>;

Object.assign(TOOL_LABELS["zh-TW"], {
  ellipseMarquee: "橢圓選取", lasso: "套索", polygonLasso: "多邊形套索",
});
