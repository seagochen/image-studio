import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";
import { ProductIcon } from "./ProductIcon";
import { hintTitle } from "./disabledReasons";

interface Props {
  disabled: boolean;
  /** Shown in the tooltip while the trigger is disabled. */
  disabledReason?: string;
  label: string;
  paintLabel: string;
  maskLabel: string;
  onCreatePaint: () => void;
  onCreateMask: () => void;
}

interface Position { left: number; top: number; }

const VIEWPORT_GAP = 8;
const ANCHOR_GAP = 6;

/** Lets the layer-panel plus button create either editable drawing content or a mask. */
export function NewLayerMenu({ disabled, disabledReason, label, paintLabel, maskLabel, onCreatePaint, onCreateMask }: Props): JSX.Element {
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
    const left = Math.max(VIEWPORT_GAP, Math.min(anchor.left, window.innerWidth - width - VIEWPORT_GAP));
    const above = anchor.top - height - ANCHOR_GAP;
    const below = anchor.bottom + ANCHOR_GAP;
    setPosition({ left, top: above >= VIEWPORT_GAP ? above : Math.max(VIEWPORT_GAP, Math.min(below, window.innerHeight - height - VIEWPORT_GAP)) });
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
  const choose = (create: () => void) => { create(); setOpen(false); };

  return <div className="layer-create-menu">
    <button ref={triggerRef} type="button" className="layer-create-trigger" disabled={disabled} title={hintTitle(label, disabled ? disabledReason : null)} aria-label={label}
      aria-haspopup="menu" aria-expanded={open} onClick={toggle}><ProductIcon name="plus" /></button>
    {open && createPortal(<div ref={menuRef} className="layer-create-popover" role="menu" aria-label={label}
      style={position ? { left: position.left, top: position.top } : { visibility: "hidden" }}>
      <button type="button" role="menuitem" onClick={() => choose(onCreatePaint)}>{paintLabel}</button>
      <button type="button" role="menuitem" onClick={() => choose(onCreateMask)}>{maskLabel}</button>
    </div>, window.document.body)}
  </div>;
}
