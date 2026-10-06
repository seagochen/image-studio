import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import type { FileCopy } from "./fileCopy";
import type { ProjectSummary } from "../projects/projectClient";
import { ProductIcon, type ProductIconName } from "./ProductIcon";

export type DeliveryFormat = "png" | "jpeg" | "webp" | "ora";
type MenuName = "file" | "edit" | "view" | "settings";
type SubmenuName = "projects" | "import" | "export";

interface Props {
  title: string;
  copy: FileCopy;
  projects: ProjectSummary[];
  busy: boolean;
  canExport: boolean;
  canSave: boolean;
  canUndo: boolean;
  canRedo: boolean;
  canDuplicate: boolean;
  canDelete: boolean;
  canPaste: boolean;
  canZoomIn: boolean;
  canZoomOut: boolean;
  navigatorVisible: boolean;
  shortcuts: { undo: string; redo: string; fit: string };
  onRename: (title: string) => Promise<boolean>;
  onNew: () => void;
  onOpen: (id: string) => void;
  onImport: (file: File) => void;
  onSave: () => void;
  onExport: (format: DeliveryFormat) => void;
  onSettings: () => void;
  /** Standalone mode only: Settings → API Key for skillsmaster.jp. */
  onApiKey?: () => void;
  onClearLocalCache: () => void;
  cacheStatus: string;
  onUndo: () => void;
  onRedo: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onCopy: () => void;
  onCut: () => void;
  onPaste: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onActualSize: () => void;
  onFit: () => void;
  onToggleNavigator: () => void;
}

const MENUS: MenuName[] = ["file", "edit", "view", "settings"];

export function FileMenu(props: Props): JSX.Element {
  const { title, copy: t, projects, busy } = props;
  const [name, setName] = useState(title);
  const [renaming, setRenaming] = useState(false);
  const [openMenu, setOpenMenu] = useState<MenuName | null>(null);
  const [openSubmenu, setOpenSubmenu] = useState<SubmenuName | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const openRasterInput = useRef<HTMLInputElement>(null);
  const triggers = useRef<Partial<Record<MenuName, HTMLButtonElement>>>({});

  useEffect(() => setName(title), [title]);
  useEffect(() => {
    if (!openMenu) return;
    const outside = (event: Event) => {
      if (!root.current?.contains(event.target as Node)) closeMenus();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
    };
  }, [openMenu]);

  const changed = name.trim() !== title;
  const valid = name.trim().length > 0 && name.trim().length <= 160;
  const closeMenus = (focus?: MenuName) => {
    setOpenMenu(null);
    setOpenSubmenu(null);
    if (focus) requestAnimationFrame(() => triggers.current[focus]?.focus());
  };
  const run = (action: () => void) => { closeMenus(); action(); };
  const rename = async () => {
    if (!valid || !changed || busy || renaming) return;
    setRenaming(true);
    try { await props.onRename(name.trim()); } finally { setRenaming(false); }
  };
  const firstEnabled = (menu: MenuName) => root.current?.querySelector<HTMLButtonElement>(`#studio-menu-${menu} [role="menuitem"]:not(:disabled)`);
  const open = (menu: MenuName, focusFirst = false) => {
    setOpenMenu(menu);
    setOpenSubmenu(null);
    if (focusFirst) requestAnimationFrame(() => firstEnabled(menu)?.focus());
  };
  const moveTopLevel = (current: MenuName, delta: number, keepOpen: boolean) => {
    const next = MENUS[(MENUS.indexOf(current) + delta + MENUS.length) % MENUS.length];
    if (keepOpen) open(next, true); else triggers.current[next]?.focus();
  };
  const triggerKey = (event: ReactKeyboardEvent, menu: MenuName) => {
    if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") { event.preventDefault(); open(menu, true); }
    else if (event.key === "ArrowRight") { event.preventDefault(); moveTopLevel(menu, 1, Boolean(openMenu)); }
    else if (event.key === "ArrowLeft") { event.preventDefault(); moveTopLevel(menu, -1, Boolean(openMenu)); }
    else if (event.key === "Escape") { event.preventDefault(); closeMenus(menu); }
  };
  const panelKey = (event: ReactKeyboardEvent, menu: MenuName) => {
    if (event.key === "Escape") { event.preventDefault(); closeMenus(menu); return; }
    if (event.key === "ArrowLeft" && openSubmenu) { event.preventDefault(); setOpenSubmenu(null); return; }
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault(); moveTopLevel(menu, event.key === "ArrowRight" ? 1 : -1, true); return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')];
    if (!items.length) return;
    event.preventDefault();
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const index = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
      : event.key === "ArrowDown" ? (current + 1) % items.length : (current - 1 + items.length) % items.length;
    items[index].focus();
  };

  const row = (icon: ProductIconName | null, label: string, action: () => void, options: { disabled?: boolean; shortcut?: string; checked?: boolean; key?: string } = {}) =>
    <button key={options.key} type="button" role="menuitem" className="studio-menu-row" disabled={options.disabled} onClick={() => run(action)}>
      <span className="menu-icon" aria-hidden="true">{(options.checked || icon) && <ProductIcon name={options.checked ? "check" : icon!} />}</span><span>{label}</span>
      {options.shortcut && <kbd>{formatShortcut(options.shortcut)}</kbd>}
    </button>;
  const submenu = (name: SubmenuName, icon: ProductIconName, label: string, children: ReactNode, disabled = false) =>
    <div className="studio-menu-submenu" onMouseEnter={() => !disabled && setOpenSubmenu(name)}>
      <button type="button" role="menuitem" className="studio-menu-row" disabled={disabled} aria-haspopup="menu" aria-expanded={openSubmenu === name}
        onClick={() => setOpenSubmenu((current) => current === name ? null : name)}
        onKeyDown={(event) => { if (event.key === "ArrowRight" && !disabled) { event.preventDefault(); setOpenSubmenu(name); requestAnimationFrame(() => root.current?.querySelector<HTMLButtonElement>(`.studio-menu-submenu-panel[data-submenu="${name}"] [role="menuitem"]:not(:disabled)`)?.focus()); } }}>
        <span className="menu-icon" aria-hidden="true"><ProductIcon name={icon} /></span><span>{label}</span><span className="menu-arrow" aria-hidden="true"><ProductIcon name="chevron-right" /></span>
      </button>
      {openSubmenu === name && <div className="studio-menu-submenu-panel" data-submenu={name} role="menu">{children}</div>}
    </div>;

  return <div ref={root} className="document-controls">
    <div className="studio-menu-bar" role="menubar" aria-label={t.menuBar}>
      {MENUS.map((menu) => <div className="studio-menu" key={menu} onMouseEnter={() => { if (openMenu && openMenu !== menu) open(menu); }}>
        <button ref={(node) => { if (node) triggers.current[menu] = node; }} type="button" role="menuitem"
          className="studio-menu-trigger" aria-haspopup="menu" aria-expanded={openMenu === menu}
          onClick={() => openMenu === menu ? closeMenus(menu) : open(menu)} onKeyDown={(event) => triggerKey(event, menu)}>
          {t[menu]}
        </button>
        {openMenu === menu && <div id={`studio-menu-${menu}`} className="studio-menu-panel" role="menu" onKeyDown={(event) => panelKey(event, menu)}>
          {menu === "file" && <>
            {row("new", t.new, props.onNew, { disabled: busy })}
            {submenu("projects", "folder", t.projects, projects.length
              ? projects.map((project) => row(null, project.title, () => props.onOpen(project.id), { disabled: busy, key: project.id }))
              : <button type="button" role="menuitem" className="studio-menu-row" disabled><span className="menu-icon" />{t.noProjects}</button>)}
            {submenu("import", "import", t.import, <>
              {row(null, t.importImage, () => imageInput.current?.click(), { disabled: busy })}
              {row(null, t.importOpenRaster, () => openRasterInput.current?.click(), { disabled: busy })}
            </>, busy)}
            <hr />
            {row("save", t.save, props.onSave, { disabled: busy || !props.canSave })}
            {submenu("export", "export", t.export, (["png", "jpeg", "webp", "ora"] as const).map((format) =>
              row(null, format === "ora" ? "OpenRaster (.ora)" : format === "jpeg" ? "JPG" : format.toUpperCase(), () => props.onExport(format), { key: format })), !props.canExport || busy)}
            <hr />
            {row("trash", t.clearLocalCache, props.onClearLocalCache)}
            <button type="button" role="menuitem" className="studio-menu-row" disabled><span className="menu-icon" />{props.cacheStatus}</button>
          </>}
          {menu === "edit" && <>
            {row("undo", t.undo, props.onUndo, { disabled: !props.canUndo, shortcut: props.shortcuts.undo })}
            {row("redo", t.redo, props.onRedo, { disabled: !props.canRedo, shortcut: props.shortcuts.redo })}
            <hr />
            {row("duplicate", t.duplicateLayer, props.onDuplicate, { disabled: !props.canDuplicate })}
            {row(null, t.copy, props.onCopy, { disabled: !props.canDuplicate, shortcut: "Mod+c" })}
            {row(null, t.cut, props.onCut, { disabled: !props.canDelete, shortcut: "Mod+x" })}
            {row(null, t.paste, props.onPaste, { disabled: !props.canPaste, shortcut: "Mod+v" })}
            {row("trash", t.deleteLayer, props.onDelete, { disabled: !props.canDelete, shortcut: "Del" })}
          </>}
          {menu === "view" && <>
            {row("minus", t.zoomOut, props.onZoomOut, { disabled: !props.canZoomOut })}
            {row("plus", t.zoomIn, props.onZoomIn, { disabled: !props.canZoomIn })}
            {row("image", t.actualSize, props.onActualSize)}
            {row("marquee", t.fit, props.onFit, { shortcut: props.shortcuts.fit })}
            <hr />
            {row("image", t.navigator, props.onToggleNavigator, { checked: props.navigatorVisible })}
          </>}
          {menu === "settings" && <>
            {row("settings", t.shortcuts, props.onSettings)}
            {props.onApiKey && row("key", t.apiKey, props.onApiKey)}
          </>}
        </div>}
      </div>)}
    </div>
    <div className="document-name"><input className="document-title-input" aria-label={t.rename} value={name} disabled={renaming || busy} aria-invalid={changed && !valid}
      onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void rename(); if (event.key === "Escape") setName(title); }}/>
      {changed && <button className="icon-button confirm-rename" aria-label={t.rename} title={t.rename} onClick={() => void rename()} disabled={!valid || renaming || busy}>
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L19 7" /></svg>
      </button>}
      {changed && !valid && <span role="alert">{t.invalidName}</span>}
    </div>
    <input ref={imageInput} type="file" hidden accept="image/png,image/jpeg,.png,.jpg,.jpeg" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) props.onImport(file); }}/>
    <input ref={openRasterInput} type="file" hidden accept=".ora,image/openraster" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) props.onImport(file); }}/>
  </div>;
}

function formatShortcut(value: string): string {
  return value.replace("Mod+", "Ctrl/⌘+").replace(/\+([a-z0-9])$/, (_, key: string) => `+${key.toUpperCase()}`).replace(/^([a-z0-9])$/, (_, key: string) => key.toUpperCase());
}
