import { useMemo, type KeyboardEvent, type PointerEvent } from "react";
import { hexToHsv, hsvToHex } from "../domain/color";

interface Props {
  value: string;
  label: string;
  onChange: (value: string) => void;
}

export function ColorWheel({ value, label, onChange }: Props): JSX.Element {
  const hsv = useMemo(() => hexToHsv(value), [value]);

  const updateFromPointer = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const radius = Math.min(rect.width, rect.height) / 2;
    const x = event.clientX - rect.left - rect.width / 2;
    const y = event.clientY - rect.top - rect.height / 2;
    const hue = (Math.atan2(y, x) * 180 / Math.PI + 450) % 360;
    const saturation = Math.min(1, Math.hypot(x, y) / radius);
    onChange(hsvToHex(hue, saturation, hsv.value));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const direction = event.key === "ArrowLeft" || event.key === "ArrowDown" ? -1 : 1;
    onChange(hsvToHex((hsv.hue + direction + 360) % 360, hsv.saturation, hsv.value));
  };

  const angle = (hsv.hue - 90) * Math.PI / 180;
  const distance = hsv.saturation * 50;
  return <div className="color-wheel" role="slider" tabIndex={0} aria-label={label} aria-valuemin={0} aria-valuemax={359}
    aria-valuenow={Math.round(hsv.hue)} aria-valuetext={value} onKeyDown={onKeyDown}
    onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); updateFromPointer(event); }}
    onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) updateFromPointer(event); }}>
    <span className="color-wheel-cursor" style={{ left: `${50 + Math.cos(angle) * distance}%`, top: `${50 + Math.sin(angle) * distance}%` }} />
  </div>;
}
