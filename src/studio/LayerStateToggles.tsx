import type { MouseEvent } from "react";
import type { MessageKey } from "../i18n";
import { ProductIcon } from "./ProductIcon";

interface Props {
  visible: boolean;
  locked: boolean;
  t: (key: MessageKey) => string;
  onVisibilityChange: () => void;
  onLockChange: () => void;
  variant?: "controls" | "row";
}

export function LayerStateToggles({
  visible, locked, t, onVisibilityChange, onLockChange, variant = "controls",
}: Props): JSX.Element {
  const activate = (event: MouseEvent<HTMLButtonElement>, callback: () => void) => {
    if (variant === "row") event.stopPropagation();
    callback();
  };
  return <>
    <button className={variant === "row" ? "layer-visibility-toggle" : undefined}
      aria-pressed={visible} title={t(visible ? "hideLayer" : "showLayer")} aria-label={t("visible")}
      onClick={(event) => activate(event, onVisibilityChange)}>
      <ProductIcon name={visible ? "eye" : "eye-closed"} />
    </button>
    <button className={variant === "row" ? "layer-lock-toggle" : undefined}
      aria-pressed={locked} title={t(locked ? "unlockLayer" : "lockLayer")} aria-label={t("locked")}
      onClick={(event) => activate(event, onLockChange)}>
      <ProductIcon name={locked ? "lock" : "lock-open"} />
    </button>
  </>;
}
