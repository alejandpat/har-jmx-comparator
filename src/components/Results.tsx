import { Fragment, useMemo, useState } from "react";
import type { ComparisonResult, DiffKind, FieldDiff, RequestDiff, RequestEntry } from "../types";
import { RequestCompare, PairList } from "./RequestCompare";
import { buildCsv, buildTxt, downloadFile } from "../exportLog";
import { decodeParamValue } from "../normalize";
import { useLang } from "../i18n";

/** Construye el resumen del tooltip para la columna Cambios. */
function changesTooltip(changes: FieldDiff[], t: (text: string) => string): string {
  const counts = { query: 0, header: 0, body: 0 };
  for (const c of changes) counts[c.kind] += 1;
  const parts: string[] = [];
  if (counts.header > 0) parts.push(`${counts.header} ${t("en headers")}`);
  if (counts.query > 0) parts.push(`${counts.query} ${t("en parámetros")}`);
  if (counts.body > 0) parts.push(`${counts.body} ${t("en body")}`);
  return parts.length > 0 ? `${t("Diferencias:")} ${parts.join(", ")}` : t("Sin diferencias");
}

interface ResultsViewProps {
  result: ComparisonResult;
  baseName: string;
  compareName: string;
}

type Filter = "all" | DiffKind;

const KIND_LABEL_KEY: Record<DiffKind, string> = {
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

interface Row {
  key: string;
  kind: DiffKind;
  method: string;
  path: string;
  parentPath: string;
  /** Código de respuesta HTTP (solo disponible en requests del HAR). */
  statusCode?: number;
  /** Path destino si es una redirección (header Location). */
  redirectTo?: string;
  diff?: RequestDiff;
  entry?: RequestEntry;
}

function buildRows(result: ComparisonResult): Row[] {
  const rows: Row[] = [];
  for (const diff of result.matched) {
    // Prioriza el request de la base para conservar la sección (parentPath) del JMX,
    // pero toma el statusCode del HAR si está disponible (el JMX no lo tiene).
    const req = diff.base?.request ?? diff.compare?.request;
    if (!req) continue;
    const statusCode = diff.compare?.request.statusCode ?? diff.base?.request.statusCode;
    rows.push({ key: `m-${req.order}-${req.path}`, kind: diff.kind, method: req.method, path: req.path, parentPath: req.parentPath, statusCode, diff });
  }
  for (const entry of result.added) {
    rows.push({ key: `a-${entry.request.order}-${entry.request.path}`, kind: "new", method: entry.request.method, path: entry.request.path, parentPath: entry.request.parentPath, statusCode: entry.request.statusCode, entry });
  }
  for (const entry of result.removed) {
    rows.push({ key: `r-${entry.request.order}-${entry.request.path}`, kind: "removed", method: entry.request.method, path: entry.request.path, parentPath: entry.request.parentPath, statusCode: entry.request.statusCode, entry });
  }
  // Ordena por orden de flujo para que las secciones aparezcan en secuencia.
  // Los requests "nuevos" (del HAR, sin sección) se envían al final.
  rows.sort((a, b) => {
    const orderA = a.kind === "new" ? Number.MAX_SAFE_INTEGER : (a.diff?.base?.request ?? a.entry?.request)?.order ?? 0;
    const orderB = b.kind === "new" ? Number.MAX_SAFE_INTEGER : (b.diff?.base?.request ?? b.entry?.request)?.order ?? 0;
    return orderA - orderB;
  });
  // Redirecciones 3xx omitidas: filas informativas al final (no cuentan como nuevos).
  for (const entry of result.redirects) {
    rows.push({
      key: `rd-${entry.request.order}-${entry.request.path}`,
      kind: "new",
      method: entry.request.method,
      path: entry.request.path,
      parentPath: "",
      statusCode: entry.request.statusCode,
      redirectTo: entry.request.redirectTo,
    });
  }
  return rows;
}

export function ResultsView({ result, baseName, compareName }: ResultsViewProps) {
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const { t } = useLang();
  // Secciones colapsadas por defecto; Set de parentPath visibles.
  const [openSections, setOpenSections] = useState<Set<string>>(new Set());

  const rows = useMemo(() => buildRows(result), [result]);
  const counts = useMemo(
    () => ({
      new: result.added.length,
      removed: result.removed.length,
      modified: result.matched.filter((d) => d.kind === "modified").length,
      same: result.matched.filter((d) => d.kind === "same").length,
    }),
    [result]
  );

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter !== "all" && (r.kind !== filter || r.redirectTo)) return false;
      if (query && !`${r.method} ${r.path}`.toLowerCase().includes(query)) return false;
      return true;
    });
  }, [rows, filter, search]);

  // Agrupa las filas visibles por sección (parentPath) para poder colapsarlas.
  const sectionGroups = useMemo(() => {
    const groups: Array<{ name: string; rows: Row[] }> = [];
    for (const row of visible) {
      const name = row.parentPath || "Sin controlador padre";
      const last = groups[groups.length - 1];
      if (last && last.name === name) {
        last.rows.push(row);
      } else {
        groups.push({ name, rows: [row] });
      }
    }
    return groups;
  }, [visible]);

  const allOpen = sectionGroups.length > 0 && sectionGroups.every((g) => openSections.has(g.name));
  const toggleSection = (name: string): void =>
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  const toggleAll = (): void =>
    setOpenSections(allOpen ? new Set() : new Set(sectionGroups.map((g) => g.name)));

  return (
    <div className="results">
      <div className="results-header">
        <h2>{t("Resultados de la comparación")}</h2>
        <p className="results-sub">
          {t("Base:")} <strong>{baseName}</strong> · {t("Comparado:")} <strong>{compareName}</strong>
        </p>
        <div className="filters">
          <input
            type="search"
            className="search-input"
            placeholder={t("Buscar método o path…")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>
            {t("Todos")} ({rows.length})
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
        </div>
        <div className="export-buttons">
          <button className="export-btn" onClick={toggleAll}>
            {allOpen ? t("▲ Colapsar todo") : t("▼ Expandir todo")}
          </button>
          <button
            className="export-btn"
            onClick={() => downloadFile(buildCsv(result, baseName, compareName), "comparacion-jmx-har.csv", "text/csv;charset=utf-8")}
          >
            ⬇ {t("Exportar CSV")}
          </button>
          <button
            className="export-btn"
            onClick={() => downloadFile(buildTxt(result, baseName, compareName), "comparacion-jmx-har.txt", "text/plain;charset=utf-8")}
          >
            ⬇ {t("Exportar TXT")}
          </button>
        </div>
      </div>
      <table className="results-table">
        <thead>
          <tr>
            <th>{t("Estado")}</th>
            <th>{t("Método")}</th>
            <th>{t("Path")}</th>
            <th>{t("Cambios")}</th>
            <th>{t("Código")}</th>
            <th>{t("Detalle")}</th>
          </tr>
        </thead>
        <tbody>
          {sectionGroups.map((group, gi) => {
            const isOpen = openSections.has(group.name);
            return (
              <Fragment key={`${group.name}#${gi}`}>
                <tr className="section-row" onClick={() => toggleSection(group.name)}>
                  <td colSpan={6}>
                    <span className="section-toggle">{isOpen ? "▼" : "▶"}</span>{" "}
                    {group.name === "Sin controlador padre" ? t("Sin controlador padre") : group.name}{" "}
                    <span className="section-count">({group.rows.length})</span>
                  </td>
                </tr>
                {isOpen &&
                  group.rows.map((row) => (
                    <Fragment key={row.key}>
                      <tr className={expanded === row.key ? "expanded" : ""}>
                        <td>
                          {row.redirectTo ? (
                            <span className="badge badge-redirect">3xx →</span>
                          ) : (
                            <span className={`badge ${KIND_CLASS[row.kind]}`}>{t(KIND_LABEL_KEY[row.kind])}</span>
                          )}
                        </td>
                        <td>{row.method}</td>
                        <td className="path-cell">
                          {decodeParamValue(row.path)}
                          {row.redirectTo && <span className="redirect-target"> → {decodeParamValue(row.redirectTo)}</span>}
                        </td>
                        <td>
                          {row.diff && row.diff.changes.length > 0 ? (
                            <span className="changes-badge" title={changesTooltip(row.diff.changes, t)}>
                              {row.diff.changes.length}
                            </span>
                          ) : (
                            row.diff?.changes.length ?? 0
                          )}
                        </td>
                        <td>
                          {row.statusCode ? (
                            <span className={`status-code status-${Math.floor(row.statusCode / 100)}xx`}>{row.statusCode}</span>
                          ) : (
                            <span className="status-code status-none">—</span>
                          )}
                        </td>
                        <td>
                          <button
                            className="detail-btn"
                            onClick={() => setExpanded(expanded === row.key ? null : row.key)}
                          >
                            {expanded === row.key ? t("▲ Ocultar") : t("▼ Ver detalle")}
                          </button>
                        </td>
                      </tr>
                      {expanded === row.key && (
                        <tr className="detail-row">
                          <td colSpan={6}>
                            <div className="detail-panel">
                              {row.diff ? (
                                <RequestCompare
                                  diff={row.diff}
                                  baseLabel={baseName}
                                  compareLabel={compareName}
                                />
                              ) : (
                                (() => {
                                  const entry = row.entry;
                                  if (!entry) return null;
                                  return (
                                    <div className="compare-grid single">
                                      <div className="compare-side">
                                        <div className="compare-side-title">
                                          <strong>{row.kind === "new" ? compareName : baseName}</strong>
                                          <span className={`badge ${KIND_CLASS[row.kind]}`}>{t(KIND_LABEL_KEY[row.kind])}</span>
                                        </div>
                                        <p className="compare-method">{entry.request.method} {decodeParamValue(entry.request.path)}</p>
                                        {entry.request.label && <p className="compare-sampler-name">{t("Sampler:")} {entry.request.label}</p>}
                                        <PairList title={t("Query params")} pairs={entry.request.query} emptyText={t("Sin query params")} />
                                        <PairList title={t("Headers")} pairs={entry.request.headers} emptyText={t("Sin headers")} />
                                        <div className="pair-section">
                                          <h4>{t("Body")}</h4>
                                          {entry.request.body ? <pre className="body-pre">{entry.request.body}</pre> : <p className="pair-empty">{t("Sin body")}</p>}
                                        </div>
                                      </div>
                                    </div>
                                  );
                                })()
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
