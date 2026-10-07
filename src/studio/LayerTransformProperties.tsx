import type { Locale } from "../i18n";
import type { ImageStudioLayer, LayerTransform } from "../domain/document";
import { PROPERTY_LABELS } from "./propertyLabels";

export function LayerTransformProperties({ layer, locale, disabled, onChange }: {
  layer: ImageStudioLayer; locale: Locale; disabled: boolean;
  onChange: (transform: LayerTransform, mergeKey: string) => void;
}): JSX.Element {
  const labels = PROPERTY_LABELS[locale];
  return <div className="layer-transform-properties">
    <label>{labels.width}<output>{Math.round(layer.width * Math.abs(layer.transform.scaleX))} px</output></label>
    <label>{labels.height}<output>{Math.round(layer.height * Math.abs(layer.transform.scaleY))} px</output></label>
    {(["x", "y", "rotation"] as const).map((field) => <label key={field}>{field === "rotation" ? labels.rotation : field.toUpperCase()}
      <input type="number" aria-label={field === "rotation" ? labels.rotation : field.toUpperCase()} disabled={disabled} step={field === "rotation" ? 1 : .1}
        value={Math.round(layer.transform[field] * 100) / 100} onChange={(event) => {
          const value = event.target.valueAsNumber;
          if (!Number.isFinite(value)) return;
          onChange({ ...layer.transform, [field]: value }, `transform:${layer.id}:${field}`);
        }} />
    </label>)}
  </div>;
}
