import { useEffect, useRef } from "react";
import type { AnnotationElement } from "../domain/document";
import type { Locale } from "../i18n";
import { PROPERTY_LABELS } from "./propertyLabels";

interface Props {
  element: AnnotationElement;
  locale: Locale;
  disabled?: boolean;
  focusRequest?: number;
  template?: boolean;
  onChange: (element: AnnotationElement, field: string) => void;
}

export function AnnotationProperties({ element, locale, disabled, focusRequest = 0, template, onChange }: Props): JSX.Element {
  const labels = PROPERTY_LABELS[locale];
  const textRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (focusRequest && !disabled) {
      textRef.current?.focus();
      textRef.current?.select();
    }
  }, [focusRequest, disabled]);
  const number = (value: string, min: number, max: number, apply: (value: number) => void) => {
    if (value.trim() && Number.isFinite(Number(value))) apply(Math.min(max, Math.max(min, Number(value))));
  };
  return <fieldset className="annotation-properties tool-parameters" disabled={disabled}>
    {element.kind === "text" ? <>
      {!template && <label>{labels.text}<textarea ref={textRef} maxLength={5000} value={element.text}
        onChange={(event) => onChange({ ...element, text: event.target.value }, "text")} /></label>}
      <label>{labels.font}<select value={element.fontFamily} onChange={(event) => onChange({ ...element, fontFamily: event.target.value }, "fontFamily")}>
        {[...new Set([element.fontFamily, "Arial", "Verdana", "Georgia", "Times New Roman", "Courier New", "Noto Sans", "Noto Sans CJK SC", "Noto Sans CJK JP", "sans-serif", "serif", "monospace"])].map((font) => <option key={font} value={font}>{font}</option>)}
      </select></label>
      <label>{labels.size}<input type="number" min="1" max="400" value={element.fontSize}
        onChange={(event) => number(event.target.value, 1, 400, (fontSize) => onChange({ ...element, fontSize }, "fontSize"))} /></label>
      <label>{labels.weight}<select value={element.fontWeight ?? 400} onChange={event=>onChange({...element,fontWeight:Number(event.target.value)},"fontWeight")}>
        {[100,200,300,400,500,600,700,800,900].map(weight=><option key={weight} value={weight}>{weight}</option>)}
      </select></label>
      <label className="brush-check"><input type="checkbox" checked={element.italic ?? false} onChange={event=>onChange({...element,italic:event.target.checked},"italic")} />{labels.italic}</label>
      <label>{labels.spacing}<input type="number" min="-10" max="100" step=".1" value={element.letterSpacing ?? 0} onChange={event=>number(event.target.value,-10,100,letterSpacing=>onChange({...element,letterSpacing},"letterSpacing"))} /></label>
      <label>{labels.leading}<input type="number" min=".5" max="5" step=".1" value={element.lineHeight ?? 1.2} onChange={event=>number(event.target.value,.5,5,lineHeight=>onChange({...element,lineHeight},"lineHeight"))} /></label>
      <label>{labels.color}<input type="color" value={element.fill} onChange={(event) => onChange({ ...element, fill: event.target.value }, "fill")} /></label>
      <label>{labels.align}<select value={element.align} onChange={(event) => onChange({ ...element, align: event.target.value as "left" | "center" | "right" }, "align")}>
        {(["left", "center", "right"] as const).map((align) => <option key={align} value={align}>{labels[align]}</option>)}
      </select></label>
    </> : <>
      <label>{labels.stroke}<input type="color" value={element.stroke} onChange={(event) => onChange({ ...element, stroke: event.target.value }, "stroke")} /></label>
      <label>{labels.strokeWidth}<input type="number" min="1" max="200" value={element.strokeWidth}
        onChange={(event) => number(event.target.value, 1, 200, (strokeWidth) => onChange({ ...element, strokeWidth }, "strokeWidth"))} /></label>
      {"fill" in element && <>
        <label className="brush-check"><input type="checkbox" checked={element.fill !== "transparent"}
          onChange={(event) => onChange({ ...element, fill: event.target.checked ? element.stroke : "transparent" }, "fill")} />{labels.filled}</label>
        {element.fill !== "transparent" && <label>{labels.fill}<input type="color" value={element.fill}
          onChange={(event) => onChange({ ...element, fill: event.target.value }, "fill")} /></label>}
      </>}
      {element.kind === "rect" && <label>{labels.radius}<input type="number" min="0" max="2000" value={element.cornerRadius}
        onChange={(event) => number(event.target.value, 0, 2000, (cornerRadius) => onChange({ ...element, cornerRadius }, "cornerRadius"))} /></label>}
    </>}
    {!template && <>
      {"width" in element && <label>{labels.width}<input type="number" min="1" max="32000" value={element.width}
        onChange={(event) => number(event.target.value, 1, 32000, (width) => onChange({ ...element, width }, "width"))} /></label>}
      {element.kind === "rect" && <label>{labels.height}<input type="number" min="1" max="32000" value={element.height}
        onChange={(event) => number(event.target.value, 1, 32000, (height) => onChange({ ...element, height }, "height"))} /></label>}
      {element.kind === "ellipse" && <>
        <label>{labels.width}<input type="number" min="1" max="32000" value={element.radiusX * 2}
          onChange={(event) => number(event.target.value, 1, 32000, (width) => onChange({ ...element, radiusX: width / 2 }, "radiusX"))} /></label>
        <label>{labels.height}<input type="number" min="1" max="32000" value={element.radiusY * 2}
          onChange={(event) => number(event.target.value, 1, 32000, (height) => onChange({ ...element, radiusY: height / 2 }, "radiusY"))} /></label>
      </>}
      {element.kind === "polygon" && <>
        <label>{labels.radiusSize}<input type="number" min="1" max="16000" value={element.radius}
          onChange={(event) => number(event.target.value, 1, 16000, (radius) => onChange({ ...element, radius }, "radius"))} /></label>
        <label>{labels.sides}<input type="number" min="3" max="12" step="1" value={element.sides}
          onChange={(event) => number(event.target.value, 3, 12, (sides) => onChange({ ...element, sides: Math.round(sides) }, "sides"))} /></label>
      </>}
      {"rotation" in element && <label>{labels.rotation}<input type="number" min="-360" max="360" value={element.rotation}
        onChange={(event) => number(event.target.value, -360, 360, (rotation) => onChange({ ...element, rotation }, "rotation"))} /></label>}
    </>}
  </fieldset>;
}
