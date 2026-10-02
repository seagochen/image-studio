import { useEffect, useRef, useState } from "react";
import { deleteAiApiKey, fetchAiKeySettings, saveAiApiKey, type AiKeySettings } from "../ai/apiKeySettings";
import { trapDialogFocus } from "./dialogFocus";
import type { FileCopy } from "./fileCopy";
import { ProductIcon } from "./ProductIcon";

interface Props { copy: FileCopy; onClose: () => void }

/** Settings → API Key (standalone mode): stores a skillsmaster.jp key on the Image Studio server. */
export function ApiKeySettingsDialog({ copy: t, onClose }: Props): JSX.Element {
  const [settings, setSettings] = useState<AiKeySettings | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const root = useRef<HTMLElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    root.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => previous?.focus();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetchAiKeySettings(controller.signal).then(setSettings)
      .catch((reason) => { if (!controller.signal.aborted) setError((reason as Error).message); });
    return () => controller.abort();
  }, []);

  const run = async (action: () => Promise<AiKeySettings>, success: (result: AiKeySettings) => string) => {
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await action();
      setSettings(result);
      setApiKey("");
      setNotice(success(result));
    } catch (reason) {
      setError((reason as Error).message || t.apiKeyFailed);
    } finally {
      setBusy(false);
    }
  };
  const save = () => {
    if (!apiKey.trim() || busy) return;
    void run(() => saveAiApiKey(apiKey.trim()), (result) => result.verified ? t.apiKeySaved : t.apiKeyUnverified);
  };

  const hint = settings?.keyHint ?? "";
  const status = !settings ? t.apiKeyLoading
    : !settings.enabled ? t.apiKeyDisabled
      : settings.keySource === "config" ? t.apiKeyManaged.replace("{hint}", hint)
        : settings.keySource === "settings" ? t.apiKeySet.replace("{hint}", hint) : t.apiKeyNone;
  const editable = Boolean(settings?.enabled && settings.editable);

  return <div className="ai-dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="api-key-title">
    <section ref={root} className="ai-dialog api-key-settings" onKeyDown={(event) => {
      trapDialogFocus(event.nativeEvent, root.current);
      if (event.key === "Escape") { event.preventDefault(); onClose(); }
      event.stopPropagation();
    }}>
      <header><h2 id="api-key-title">{t.apiKeyTitle}</h2><button aria-label={t.close} onClick={onClose}><ProductIcon name="close" /></button></header>
      {settings?.enabled && <p>{t.apiKeyHint.replace("{baseUrl}", settings.baseUrl ?? "skillsmaster.jp")}</p>}
      <p className="api-key-status">{t.apiKeyStatus}: {status}</p>
      {editable && <label>{t.apiKeyInput}
        <input type="password" autoComplete="off" spellCheck={false} value={apiKey} placeholder={t.apiKeyPlaceholder} disabled={busy}
          onChange={(event) => setApiKey(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") save(); }} />
      </label>}
      {error && <p role="alert" className="ai-error">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <footer>
        {editable && settings?.keySource === "settings" && <button disabled={busy}
          onClick={() => void run(deleteAiApiKey, () => t.apiKeyRemoved)}>{t.apiKeyRemove}</button>}
        <button onClick={onClose}>{t.cancel}</button>
        {editable && <button className="primary" disabled={busy || !apiKey.trim()} onClick={save}>{t.save}</button>}
      </footer>
    </section>
  </div>;
}
