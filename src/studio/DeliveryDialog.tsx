import { useEffect, useRef, useState } from "react";
import { exportFilename, exportImage, planExport } from "../domain/exportImage";
import type { ImageStudioDocument } from "../domain/document";
import { exportOpenRaster } from "../projects/openRaster";
import type { DeliveryFormat } from "./FileMenu";
import { MAX_CANVAS_EDGE } from "../shared/imageStudioDomain";
import type { FileCopy } from "./fileCopy";
import type { MessageKey } from "../i18n";
import { trapDialogFocus } from "./dialogFocus";
import { ProductIcon } from "./ProductIcon";

interface Props {
  document: ImageStudioDocument;
  t: (key: MessageKey) => string;
  onClose: () => void;
  initialFormat: DeliveryFormat;
  copy: FileCopy;
}

export function DeliveryDialog({ document, t, onClose, initialFormat, copy }: Props): JSX.Element {
  const [format, setFormat] = useState<DeliveryFormat>(initialFormat);
  const [width, setWidth] = useState(document.canvas.width);
  const [height, setHeight] = useState(document.canvas.height);
  const [quality, setQuality] = useState(0.92);
  const [background, setBackground] = useState("#ffffff");
  const [busy, setBusy] = useState<"image" | "package" | null>(null);
  const [error, setError] = useState("");
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const plan = (() => { try { if (format === "ora") return null; return planExport({ format, width, height, quality, jpegBackground: background }, document); } catch { return null; } })();

  useEffect(() => {
    const previousFocus = window.document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", escape);
    return () => { window.removeEventListener("keydown", escape); previousFocus?.focus(); };
  }, [busy, onClose]);

  const exportRaster = async () => {
    setBusy("image"); setError("");
    const controller = new AbortController(); abortRef.current = controller;
    try {
      if (format === "ora") return;
      const blob = await exportImage(document, { format, width, height, quality, jpegBackground: background }, { signal: controller.signal });
      controller.signal.throwIfAborted();
      download(blob, exportFilename(document.title, format));
    } catch (reason) {
      if (!controller.signal.aborted) setError((reason as Error).message);
    } finally { abortRef.current = null; setBusy(null); }
  };

  const exportProject = async () => {
    setBusy("package"); setError("");
    const controller = new AbortController(); abortRef.current = controller;
    try {
      const blob = await exportOpenRaster(document, {signal:controller.signal}); controller.signal.throwIfAborted();
      download(blob, exportFilename(document.title, "png").replace(/\.png$/, ".ora"));
    } catch { if (!controller.signal.aborted) setError(copy.failed); }
    finally { abortRef.current = null; setBusy(null); }
  };

  return <div className="ai-dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="delivery-title">
    <section ref={dialogRef} className="ai-dialog delivery-dialog" onKeyDown={(event) => trapDialogFocus(event.nativeEvent, dialogRef.current)}>
      <header><h2 id="delivery-title">{t("exportTitle")}</h2><button ref={closeRef} aria-label={t("close")} onClick={onClose} disabled={Boolean(busy)}><ProductIcon name="close" /></button></header>
      <div className="export-grid">
        <label>{t("exportFormat")}<select value={format} disabled={Boolean(busy)} onChange={(event) => setFormat(event.target.value as DeliveryFormat)}>
          <option value="ora">OpenRaster (.ora)</option><option value="png">PNG</option><option value="jpeg">JPEG</option><option value="webp">WebP</option>
        </select></label>
        {format !== "ora" && <><label>{t("exportWidth")}<input type="number" min="1" max={MAX_CANVAS_EDGE} value={width} disabled={Boolean(busy)} onChange={(event) => setWidth(Number(event.target.value))} /></label>
        <label>{t("exportHeight")}<input type="number" min="1" max={MAX_CANVAS_EDGE} value={height} disabled={Boolean(busy)} onChange={(event) => setHeight(Number(event.target.value))} /></label>
        {format !== "png" && <label>{t("exportQuality")}<input type="range" min="0.1" max="1" step="0.01" value={quality} disabled={Boolean(busy)} onChange={(event) => setQuality(Number(event.target.value))} /></label>}
        {format === "jpeg" && <label>{t("jpegBackground")}<input type="color" value={background} disabled={Boolean(busy)} onChange={(event) => setBackground(event.target.value)} /></label>}
        </>}
      </div>
      {format === "ora" && <p>{copy.oraHint}</p>}
      {plan?.memoryRisk && <p className="memory-warning" role="status">{t("exportMemoryWarning")}</p>}
      {busy && <p role="status" aria-live="polite">{t(busy === "image" ? "exportingImage" : "exportingProject")}</p>}
      {error && <p className="ai-error" role="alert">{error}</p>}
      <footer className="delivery-actions">
        {busy ? <button className="danger" onClick={() => abortRef.current?.abort()}>{t("cancel")}</button>
          : <button className="primary" disabled={(format !== "ora" && !plan) || !document.layers.length} onClick={() => void (format === "ora" ? exportProject() : exportRaster())}>{format === "ora" ? t("exportProject") : t("downloadImage")}</button>}
      </footer>
    </section>
  </div>;
}

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = window.document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
