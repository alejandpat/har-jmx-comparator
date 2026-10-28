/** Nivel de severidad de una entrada de log. */
export type LogLevel = "info" | "warn" | "error";

/** Entrada del log de errores. */
export interface LogEntry {
  id: number;
  timestamp: string;
  level: LogLevel;
  /** Origen: "parser", "comparación", "runtime", etc. */
  source: string;
  message: string;
  /** Detalle opcional (stack, error completo). */
  detail?: string;
}

type Listener = (entries: LogEntry[]) => void;

let nextId = 1;
let entries: LogEntry[] = [];
const listeners = new Set<Listener>();

/** Registra una entrada en el log. */
export function logEvent(level: LogLevel, source: string, message: string, detail?: string): void {
  entries = [
    ...entries,
    {
      id: nextId++,
      timestamp: new Date().toLocaleTimeString(),
      level,
      source,
      message,
      ...(detail !== undefined && { detail }),
    },
  ];
  // Limita el log a 500 entradas para no crecer sin control.
  if (entries.length > 500) entries = entries.slice(-500);
  // Notifica de forma diferida: los listeners hacen setState en React y esta
  // función puede invocarse durante un render (useMemo de comparaciones).
  for (const listener of listeners) queueMicrotask(() => listener([...entries]));
}

/** Atajos por nivel. */
export function logInfo(source: string, message: string, detail?: string): void {
  logEvent("info", source, message, detail);
}
export function logWarn(source: string, message: string, detail?: string): void {
  logEvent("warn", source, message, detail);
}
export function logError(source: string, message: string, detail?: string): void {
  logErrorImpl(source, message, detail);
}

function logErrorImpl(source: string, message: string, detail?: string): void {
  logEvent("error", source, message, detail);
}

/** Limpia el log. */
export function clearLog(): void {
  entries = [];
  for (const listener of listeners) listener([]);
}

/** Suscripción para componentes React (retorna función de cleanup). */
export function subscribeToLog(listener: Listener): () => void {
  listeners.add(listener);
  listener([...entries]);
  return () => {
    listeners.delete(listener);
  };
}

/** Obtiene las entradas actuales (snapshot). */
export function getLogEntries(): LogEntry[] {
  return [...entries];
}

/** Genera el contenido TXT del log para descarga. */
export function buildLogTxt(): string {
  const out: string[] = [];
  out.push("=".repeat(70));
  out.push("LOG DE ERRORES Y EVENTOS — COMPARADOR JMX ↔ HAR");
  out.push(`Generado: ${new Date().toLocaleString()}`);
  out.push("=".repeat(70));
  for (const entry of entries) {
    out.push(`[${entry.timestamp}] [${entry.level.toUpperCase()}] [${entry.source}] ${entry.message}`);
    if (entry.detail) out.push(`    ${entry.detail}`);
  }
  if (entries.length === 0) out.push("(sin entradas)");
  return out.join("\r\n");
}

/** Descarga el log como archivo TXT. */
export function downloadLog(): void {
  const blob = new Blob([buildLogTxt()], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "log-errores.txt";
  anchor.click();
  URL.revokeObjectURL(url);
}
