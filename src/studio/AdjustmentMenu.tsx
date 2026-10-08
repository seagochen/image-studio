import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";
import { ADJUSTMENT_KINDS, type AdjustmentKind } from "../domain/document";
import { ProductIcon } from "./ProductIcon";
import { hintTitle } from "./disabledReasons";

interface Props {
  disabled: boolean;
  /** Shown in the tooltip while the trigger is disabled. */
  disabledReason?: string;
  label: string;
  labels: Record<AdjustmentKind, string>;
  onSelect: (kind: AdjustmentKind) => void;
}

interface Position { left: number; top: number; }

const VIEWPORT_GAP = 8;
const ANCHOR_GAP = 6;

/** Creates a non-destructive adjustment layer from the layer panel. */
export function AdjustmentMenu({ disabled, disabledReason, label, labels, onSelect }: Props): JSX.Element {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<Position | null>(null);

  const placeMenu = () => {
    const trigger = triggerRef.current;
    const menu = menuRef.current;
    if (!trigger || !menu) return;
    const anchor = trigger.getBoundingClientRect();
    const width = menu.offsetWidth;
    const height = menu.offsetHeight;
    const left = Math.max(VIEWPORT_GAP, Math.min(anchor.right - width, window.innerWidth - width - VIEWPORT_GAP));
    const above = anchor.top - height - ANCHOR_GAP;
    const below = anchor.bottom + ANCHOR_GAP;
    const top = above >= VIEWPORT_GAP ? above
      : Math.max(VIEWPORT_GAP, Math.min(below, window.innerHeight - height - VIEWPORT_GAP));
    setPosition({ left, top });
  };

  useLayoutEffect(() => {
    if (!open) { setPosition(null); return; }
    placeMenu();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("resize", placeMenu);
    window.addEventListener("scroll", placeMenu, true);
    window.document.addEventListener("pointerdown", closeOutside);
    window.document.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("resize", placeMenu);
      window.removeEventListener("scroll", placeMenu, true);
      window.document.removeEventListener("pointerdown", closeOutside);
      window.document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const toggle = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (!disabled) setOpen((value) => !value);
  };

  return <div className="layer-create-menu">
    <button ref={triggerRef} type="button" className="layer-create-trigger" disabled={disabled} title={hintTitle(label, disabled ? disabledReason : null)} aria-label={label}
      aria-haspopup="menu" aria-expanded={open} onClick={toggle}><ProductIcon name="adjust" /></button>
    {open && createPortal(<div ref={menuRef} className="layer-create-popover" role="menu" aria-label={label}
      style={position ? { left: position.left, top: position.top } : { visibility: "hidden" }}>
      {ADJUSTMENT_KINDS.map((kind) => <button key={kind} type="button" role="menuitem" onClick={() => {
        onSelect(kind);
        setOpen(false);
      }}>{labels[kind]}</button>)}
    </div>, window.document.body)}
  </div>;
}
