import type { ImageStudioLayer, LayerEffects } from "../domain/document";
import type { Locale } from "../i18n";
import { editingCopy } from "./editingCopy";
export function LayerEffectsPanel({ layer, locale, disabled, onChange }: {
    layer: ImageStudioLayer;
    locale: Locale;
    disabled: boolean;
    onChange: (effects: LayerEffects) => void;
}): JSX.Element | null {
    if (!["raster", "paint", "annotation"].includes(layer.type))
        return null;
    const copy = editingCopy[locale], effects = layer.effects ?? {};
    const defaults = { shadow: { color: "#000000", opacity: .35, blur: 8, offsetX: 6, offsetY: 6 }, stroke: { color: "#ffffff", opacity: 1, width: 2 } };
    return <fieldset className="layer-effects-panel" disabled={disabled}><legend>{copy.effects}</legend>
 {(["shadow", "stroke"] as const).map(kind => {
            const effect = effects[kind];
            return <div key={kind}>
  <label><input type="checkbox" checked={Boolean(effect)} onChange={event => { const next = { ...effects }; if (event.target.checked)
                Object.assign(next, { [kind]: defaults[kind] });
            else
                delete next[kind]; onChange(next); }}/>{kind === "shadow" ? copy.shadow : copy.outline}</label>
  {effect && <><label>{copy.color}<input type="color" value={effect.color} onChange={event => onChange({ ...effects, [kind]: { ...effect, color: event.target.value } })}/></label>
  <label>{copy.opacity}<input type="range" min="0" max="1" step=".01" value={effect.opacity} onChange={event => onChange({ ...effects, [kind]: { ...effect, opacity: Number(event.target.value) } })}/></label>
  {(kind === "shadow" ? ["blur", "offsetX", "offsetY"] : ["width"]).map(field => <label key={field}>{field === "blur" ? copy.radius : field === "width" ? copy.width : field === "offsetX" ? "X" : "Y"}<input type="number" value={Number((effect as unknown as Record<string, unknown>)[field])} min={field.startsWith("offset") ? -256 : 0} max={field.startsWith("offset") ? 256 : field === "width" ? 16 : 64} onChange={event => { const n = event.target.valueAsNumber, min = field.startsWith("offset") ? -256 : 0, max = field.startsWith("offset") ? 256 : field === "width" ? 16 : 64; if (Number.isFinite(n))
                    onChange({ ...effects, [kind]: { ...effect, [field]: Math.max(min, Math.min(max, n)) } }); }}/></label>)}
  </>}
 </div>;
        })}</fieldset>;
}
