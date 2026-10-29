import { Fragment, useState } from "react";
import type { SectionComparison } from "../sectionCompare";
import { ResultsView } from "./Results";
import { buildSectionsTxt, downloadFile } from "../exportLog";
import { useLang } from "../i18n";

interface SectionResultsViewProps {
  sections: SectionComparison[];
  jmxName: string;
  /** Prefijo usado para asignar secciones ("auto" si fue detectado automáticamente). */
  prefixLabel: string;
}

/** CSV consolidado: una fila por request/cambio, con la sección como primera columna. */
function buildSectionsCsv(sections: SectionComparison[]): string {
  const esc = (v: string): string => `"${String(v).replace(/"/g, '""')}"`;
  const lines: string[] = [
    [
      esc("Sección (transacción JMX)"),
      esc("Archivo HAR"),
      esc("Estado"),
      esc("Método"),
      esc("Path"),
      esc("# Req JMX"),
      esc("# Req HAR"),
      esc("Campo"),
      esc("Valor base"),
      esc("Valor comparado"),
    ].join(","),
  ];

  for (const s of sections) {
    const r = s.result;
    for (const diff of r.matched) {
      const req = diff.base?.request ?? diff.compare?.request;
      if (!req) continue;
      const numBase = diff.base ? String(diff.base.request.order + 1) : "";
      const numCompare = diff.compare ? String(diff.compare.request.order + 1) : "";
      if (diff.kind === "modified" && diff.changes.length > 0) {
        for (const change of diff.changes) {
          lines.push(
            [
              esc(s.transaction),
              esc(s.harFileName),
              esc("Modificado"),
              esc(req.method),
              esc(req.path),
              esc(numBase),
              esc(numCompare),
              esc(`${change.kind}/${change.name}`),
              esc(change.before),
              esc(change.after),
            ].join(",")
          );
        }
      } else {
        const estado = diff.kind === "same" ? "Igual" : "Modificado";
        lines.push([esc(s.transaction), esc(s.harFileName), esc(estado), esc(req.method), esc(req.path), esc(numBase), esc(numCompare), "", "", ""].join(","));
      }
    }
    for (const e of r.added) {
      lines.push([esc(s.transaction), esc(s.harFileName), esc("Nuevo"), esc(e.request.method), esc(e.request.path), "", esc(String(e.request.order + 1)), "", "", ""].join(","));
    }
    for (const e of r.removed) {
      lines.push([esc(s.transaction), esc(s.harFileName), esc("Eliminado"), esc(e.request.method), esc(e.request.path), esc(String(e.request.order + 1)), "", "", "", ""].join(","));
    }
  }
  return lines.join("\r\n");
}

export function SectionResultsView({ sections, jmxName, prefixLabel }: SectionResultsViewProps) {
  const [selected, setSelected] = useState<string | null>(null);
  // Oculta secciones sin ninguna diferencia (todo igual).
  const [onlyDiffs, setOnlyDiffs] = useState(false);
  const { t } = useLang();

  const hasDiffs = (s: SectionComparison): boolean =>
    s.result.added.length > 0 || s.result.removed.length > 0 || s.result.matched.some((d) => d.kind === "modified");
  const visibleSections = onlyDiffs ? sections.filter(hasDiffs) : sections;

  return (
    <div className="results section-results">
      <div className="results-header">
        <h2>{t("Comparación por secciones (JMX vs múltiples HAR)")}</h2>
        <p className="results-sub">
          {t("Base:")} <strong>{jmxName}</strong> · {sections.length} {t("HAR(s) asignados por nombre a su transacción")}{" "}
          <strong>{prefixLabel}</strong>
        </p>
        <div className="export-buttons">
          <button
            className={`export-btn${onlyDiffs ? " active" : ""}`}
            onClick={() => setOnlyDiffs((v) => !v)}
          >
            {onlyDiffs ? t("🟡 Solo con diferencias") : t("⚪ Todas las secciones")}
          </button>
          <button
            className="export-btn"
            onClick={() => downloadFile(buildSectionsCsv(sections), "comparacion-por-secciones.csv", "text/csv;charset=utf-8")}
          >
            ⬇ {t("Exportar CSV consolidado")}
          </button>
          <button
            className="export-btn"
            onClick={() => downloadFile(buildSectionsTxt(sections, jmxName, prefixLabel), "comparacion-por-secciones.txt", "text/plain;charset=utf-8")}
          >
            ⬇ {t("Exportar TXT")}
          </button>
        </div>
      </div>

      <table className="results-table">
        <thead>
          <tr>
            <th>{t("Transacción JMX")}</th>
            <th>{t("HAR asignado")}</th>
            <th>JMX</th>
            <th>HAR</th>
            <th>✅ {t("Igual")}</th>
            <th>✏️ {t("Mod.")}</th>
            <th>➕ {t("Nuevos")}</th>
            <th>➖ {t("Eliminados")}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {visibleSections.map((s) => {
            const modified = s.result.matched.filter((d) => d.kind === "modified").length;
            const same = s.result.matched.filter((d) => d.kind === "same").length;
            const isSelected = selected === s.transaction;
            return (
              <Fragment key={s.transaction}>
                <tr>
                  <td>{s.transaction}</td>
                  <td className="path-cell">{s.harFileName}</td>
                  <td>{s.jmxCount}</td>
                  <td>{s.harCount}</td>
                  <td>{same}</td>
                  <td>{modified}</td>
                  <td>{s.result.added.length}</td>
                  <td>{s.result.removed.length}</td>
                  <td>
                    <button onClick={() => setSelected(isSelected ? null : s.transaction)}>
                      {isSelected ? t("▲ Ocultar") : t("▼ Ver detalle")}
                    </button>
                  </td>
                </tr>
                {isSelected && (
                  <tr className="section-detail-row">
                    <td colSpan={9}>
                      <div className="section-detail">
                        <h3>
                          {s.transaction} — {s.harFileName}
                        </h3>
                        <ResultsView
                          result={s.result}
                          baseName={`${t("JMX:")}${s.transaction}`}
                          compareName={s.harFileName}
                        />
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
