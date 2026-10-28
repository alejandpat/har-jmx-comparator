import { useMemo, useState } from "react";
import type { DiffKind } from "../types";
import { useLang } from "../i18n";

export interface LoadedField {
  kind: string;
  name: string;
  before: string;
  after: string;
}

export interface LoadedRequest {
  kind: DiffKind;
  method: string;
  path: string;
  parentPath: string;
  sampler: string;
  changes: LoadedField[];
}

export interface LoadedReportData {
  fileName: string;
  baseName: string;
  compareName: string;
  totalBase: number;
  totalCompare: number;
  requests: LoadedRequest[];
}

const STATE_TO_KIND: Record<string, DiffKind> = {
  "Nuevo": "new",
  "Eliminado": "removed",
  "Modificado": "modified",
  "Igual": "same",
};

const KIND_LABEL: Record<DiffKind, string> = {
  new: "Nuevo",
  removed: "Eliminado",
  modified: "Modificado",
  same: "Igual",
};

const KIND_CLASS: Record<DiffKind, string> = {
  new: "badge-new",
  removed: "badge-removed",
  modified: "badge-modified",
  same: "badge-same",
};

/** Parsea una línea CSV con comillas dobladas ("") y separador coma. */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

/** Parsea el contenido de un reporte CSV exportado por la app. */
function parseCsvReport(content: string): LoadedReportData {
  const lines = content.split(/\r?\n/);
  const requests = new Map<string, LoadedRequest>();
  let baseName = "";
  let compareName = "";
  let totalBase = 0;
  let totalCompare = 0;

  for (const line of lines) {
    if (!line.trim()) continue;
    const cols = parseCsvLine(line);
    if (cols[0] === "Total base") { totalBase = Number(cols[1]) || 0; continue; }
    if (cols[0] === "Total comparado") { totalCompare = Number(cols[1]) || 0; continue; }
    if (cols[0] === "Archivo base") { baseName = cols[1] ?? ""; continue; }
    if (cols[0] === "Archivo comparado") { compareName = cols[1] ?? ""; continue; }
    if (cols[0] === "Estado") continue; // header

    const [state, method, path, parentPath, sampler, field, before, after] = cols;
    const kind = STATE_TO_KIND[state];
    if (!kind || !method || !path) continue;
    const key = `${kind}|${method}|${path}|${parentPath ?? ""}`;
    let req = requests.get(key);
    if (!req) {
      req = { kind, method, path, parentPath: parentPath ?? "", sampler: sampler ?? "", changes: [] };
      requests.set(key, req);
    }
    if (field && field !== "—") {
      req.changes.push({ kind: field.split("/")[0] ?? field, name: field.split("/")[1] ?? field, before: before ?? "", after: after ?? "" });
    }
  }

  return { fileName: "", baseName, compareName, totalBase, totalCompare, requests: [...requests.values()] };
}

/** Parsea el contenido de un reporte TXT exportado por la app. */
function parseTxtReport(content: string): LoadedReportData {
  const lines = content.split(/\r?\n/);
  const requests: LoadedRequest[] = [];
  let currentSection: DiffKind | null = null;
  let current: LoadedRequest | null = null;
  let baseName = "";
  let compareName = "";
  let totalBase = 0;
  let totalCompare = 0;

  const SECTION_MAP: Record<string, DiffKind> = {
    "NUEVOS": "new",
    "ELIMINADOS": "removed",
    "MODIFICADOS": "modified",
    "SIN CAMBIOS": "same",
  };

  for (const line of lines) {
    const sectionMatch = line.match(/^--- (.+?) \((\d+)\) ---$/);
    if (sectionMatch) {
      const title = sectionMatch[1];
      currentSection = SECTION_MAP[title] ?? null;
      current = null;
      continue;
    }
    const totalsMatch = line.match(/^Base:\s+(.+?) \((\d+) requests\)$/);
    if (totalsMatch) { baseName = totalsMatch[1]; totalBase = Number(totalsMatch[2]) || 0; continue; }
    const compMatch = line.match(/^Comparado:\s+(.+?) \((\d+) requests\)$/);
    if (compMatch) { compareName = compMatch[1]; totalCompare = Number(compMatch[2]) || 0; continue; }

    if (!currentSection) continue;
    // Línea de request: "  METHOD path [sección] (Sampler: x)"
    const reqMatch = line.match(/^  (\S+) (\S+)(?: \[(.+?)\])?(?: \(Sampler: (.+?)\))?$/);
    if (reqMatch) {
      current = {
        kind: currentSection,
        method: reqMatch[1],
        path: reqMatch[2],
        parentPath: reqMatch[3] ?? "",
        sampler: reqMatch[4] ?? "",
        changes: [],
      };
      requests.push(current);
      continue;
    }
    // Línea de cambio (solo en MODIFICADOS): "     kind/name: "before" -> "after""
    const changeMatch = line.match(/^     (\w+)\/(.+?): "(.*)" -> "(.*)"$/);
    if (changeMatch && current) {
      current.changes.push({ kind: changeMatch[1], name: changeMatch[2], before: changeMatch[3], after: changeMatch[4] });
    }
  }

  return { fileName: "", baseName, compareName, totalBase, totalCompare, requests };
}

/** Detecta el formato y parsea el reporte cargado. */
export function parseReport(content: string, fileName: string): LoadedReportData {
  const data = content.includes('"Estado"') || content.includes("Estado,Método,Path") || content.includes("Estado,Metodo,Path")
    ? parseCsvReport(content)
    : content.includes("REPORTE DE COMPARACIÓN")
      ? parseTxtReport(content)
      : null;
  if (!data) throw new Error("Formato de reporte no reconocido. Usa un CSV o TXT exportado por esta app.");
  data.fileName = fileName;
  return data;
}

interface LoadedReportProps {
  data: LoadedReportData;
  onClose: () => void;
}

type Filter = "all" | DiffKind;

/** Vista de solo lectura de un reporte previamente exportado (CSV/TXT). */
export function LoadedReportView({ data, onClose }: LoadedReportProps) {
  const [filter, setFilter] = useState<Filter>("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const { t } = useLang();

  const counts = useMemo(() => {
    const c = { new: 0, removed: 0, modified: 0, same: 0 };
    for (const r of data.requests) c[r.kind]++;
    return c;
  }, [data]);

  const visible = useMemo(
    () => (filter === "all" ? data.requests : data.requests.filter((r) => r.kind === filter)),
    [data, filter]
  );

  return (
    <div className="results">
      <div className="results-header">
        <h2>{t("Reporte cargado")}</h2>
        <p className="results-sub">
          {t("Archivo:")} <strong>{data.fileName}</strong>
          {data.baseName && <> · {t("Base:")} <strong>{data.baseName}</strong></>}
          {data.compareName && <> · {t("Comparado:")} <strong>{data.compareName}</strong></>}
        </p>
        <div className="filters">
          <button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>
            {t("Todos")} ({data.requests.length})
          </button>
          <button className={filter === "new" ? "active" : ""} onClick={() => setFilter("new")}>
            🟢 {t("Nuevos")} ({counts.new})
          </button>
          <button className={filter === "removed" ? "active" : ""} onClick={() => setFilter("removed")}>
            🔴 {t("Eliminados")} ({counts.removed})
          </button>
          <button className={filter === "modified" ? "active" : ""} onClick={() => setFilter("modified")}>
            🟡 {t("Modificados")} ({counts.modified})
          </button>
          <button className={filter === "same" ? "active" : ""} onClick={() => setFilter("same")}>
            ⚪ {t("Igual")} ({counts.same})
          </button>
          <button className="export-btn" onClick={onClose}>✕ {t("Cerrar reporte")}</button>
        </div>
      </div>

      <div className="results-list">
        {visible.map((req) => {
          const key = `${req.kind}-${req.method}-${req.path}`;
          const isOpen = expanded === key;
          return (
            <div key={key} className="result-row">
              <button className="result-row-header" onClick={() => setExpanded(isOpen ? null : key)}>
                <span className={`badge ${KIND_CLASS[req.kind]}`}>{t(KIND_LABEL[req.kind])}</span>
                <span className="req-method">{req.method}</span>
                <span className="req-path">{req.path}</span>
                {req.parentPath && <span className="req-section">[{req.parentPath}]</span>}
              </button>
              {isOpen && req.changes.length > 0 && (
                <table className="changes-table">
                  <thead>
                    <tr><th>{t("Tipo")}</th><th>{t("Nombre")}</th><th>{t("Base")}</th><th>{t("Comparado")}</th></tr>
                  </thead>
                  <tbody>
                    {req.changes.map((c, i) => (
                      <tr key={i}>
                        <td>{c.kind}</td>
                        <td>{c.name}</td>
                        <td className="diff-before">{c.before || "—"}</td>
                        <td className="diff-after">{c.after || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
