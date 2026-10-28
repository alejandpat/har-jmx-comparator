import { useEffect, useState } from "react";
import { clearLog, downloadLog, subscribeToLog, type LogEntry, type LogLevel } from "../logger";
import { useLang } from "../i18n";

const LEVEL_CLASS: Record<LogLevel, string> = {
  info: "log-info",
  warn: "log-warn",
  error: "log-error",
};

const LEVEL_ICON: Record<LogLevel, string> = {
  info: "ℹ️",
  warn: "⚠️",
  error: "❌",
};

/** Panel flotante que muestra el log de errores y eventos en vivo. */
export function LogPanel() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [open, setOpen] = useState(false);
  const { t } = useLang();

  useEffect(() => subscribeToLog(setEntries), []);

  const errorCount = entries.filter((e) => e.level === "error").length;
  const warnCount = entries.filter((e) => e.level === "warn").length;

  return (
    <div className="log-widget">
      <button className="log-toggle" onClick={() => setOpen(!open)}>
        📋 Log {errorCount > 0 && <span className="log-badge log-badge-error">{errorCount}</span>}
        {warnCount > 0 && <span className="log-badge log-badge-warn">{warnCount}</span>}
      </button>
      {open && (
        <div className="log-panel">
          <div className="log-panel-header">
            <strong>{t("Log de errores y eventos")}</strong>
            <div className="log-panel-actions">
              <button onClick={downloadLog}>{t("⬇ Descargar")}</button>
              <button onClick={clearLog}>{t("🗑 Limpiar")}</button>
              <button onClick={() => setOpen(false)}>✕</button>
            </div>
          </div>
          <div className="log-entries">
            {entries.length === 0 && <p className="log-empty">{t("Sin entradas todavía.")}</p>}
            {[...entries].reverse().map((entry) => (
              <div key={entry.id} className={`log-entry ${LEVEL_CLASS[entry.level]}`}>
                <span className="log-entry-meta">
                  {LEVEL_ICON[entry.level]} [{entry.timestamp}] [{entry.source}]
                </span>
                <span className="log-message">{entry.message}</span>
                {entry.detail && <pre className="log-detail">{entry.detail}</pre>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
