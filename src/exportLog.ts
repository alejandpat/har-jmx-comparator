import type { ComparisonResult, DiffKind } from "./types";
import type { SectionComparison } from "./sectionCompare";

/** Fila plana para exportación. */
interface LogRow {
  kind: DiffKind;
  method: string;
  path: string;
  parentPath: string;
  sampler: string;
  field: string;
  before: string;
  after: string;
}

const KIND_LABEL: Record<DiffKind, string> = {
  new: "Nuevo",
  removed: "Eliminado",
  modified: "Modificado",
  same: "Igual",
};

/** Escapa un valor para CSV (comillas dobles escapadas y envuelto en comillas). */
function csvEscape(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

/** Recolecta todas las filas del reporte en formato plano. */
function collectRows(result: ComparisonResult): LogRow[] {
  const rows: LogRow[] = [];

  for (const diff of result.matched) {
    const req = diff.base?.request ?? diff.compare?.request;
    if (!req) continue;
    const sampler = diff.base?.label || req.label || "";
    if (diff.kind === "modified" && diff.changes.length > 0) {
      for (const change of diff.changes) {
        rows.push({
          kind: diff.kind,
          method: req.method,
          path: req.path,
          parentPath: req.parentPath,
          sampler,
          field: `${change.kind}/${change.name}`,
          before: change.before,
          after: change.after,
        });
      }
    } else {
      rows.push({ kind: diff.kind, method: req.method, path: req.path, parentPath: req.parentPath, sampler, field: "", before: "", after: "" });
    }
  }
  for (const entry of result.added) {
    const req = entry.request;
    rows.push({ kind: "new", method: req.method, path: req.path, parentPath: req.parentPath, sampler: entry.label || req.label || "", field: "", before: "", after: "" });
  }
  for (const entry of result.removed) {
    const req = entry.request;
    rows.push({ kind: "removed", method: req.method, path: req.path, parentPath: req.parentPath, sampler: entry.label || req.label || "", field: "", before: "", after: "" });
  }
  return rows;
}

/** Genera el contenido CSV del reporte. */
export function buildCsv(result: ComparisonResult, baseName: string, compareName: string): string {
  const lines: string[] = [
    [
      csvEscape("Estado"),
      csvEscape("Método"),
      csvEscape("Path"),
      csvEscape("Sección (controlador padre)"),
      csvEscape("Sampler"),
      csvEscape("Campo"),
      csvEscape("Valor base"),
      csvEscape("Valor comparado"),
    ].join(","),
  ];

  for (const row of collectRows(result)) {
    lines.push(
      [
        csvEscape(KIND_LABEL[row.kind]),
        csvEscape(row.method),
        csvEscape(row.path),
        csvEscape(row.parentPath),
        csvEscape(row.sampler),
        csvEscape(row.field),
        csvEscape(row.before),
        csvEscape(row.after),
      ].join(",")
    );
  }
  lines.push("");
  lines.push(`${csvEscape("Total base")},${csvEscape(String(result.totalBase))}`);
  lines.push(`${csvEscape("Total comparado")},${csvEscape(String(result.totalCompare))}`);
  lines.push(`${csvEscape("Archivo base")},${csvEscape(baseName)}`);
  lines.push(`${csvEscape("Archivo comparado")},${csvEscape(compareName)}`);
  return lines.join("\r\n");
}

/** Genera el contenido TXT (legible) del reporte. */
export function buildTxt(result: ComparisonResult, baseName: string, compareName: string): string {
  const out: string[] = [];
  const bar = "=".repeat(70);
  out.push(bar);
  out.push("REPORTE DE COMPARACIÓN JMX vs HAR");
  out.push(bar);
  out.push(`Base:      ${baseName} (${result.totalBase} requests)`);
  out.push(`Comparado: ${compareName} (${result.totalCompare} requests)`);
  out.push("");

  const section = (title: string, entries: { label: string; line: string }[]) => {
    out.push(`--- ${title} (${entries.length}) ---`);
    for (const e of entries) out.push(e.line);
    out.push("");
  };

  const lineOf = (method: string, path: string, parentPath: string, sampler: string) => {
    const sec = parentPath ? ` [${parentPath}]` : "";
    const sam = sampler ? ` (Sampler: ${sampler})` : "";
    return `  ${method} ${path}${sec}${sam}`;
  };

  section(
    "NUEVOS",
    result.added.map((e) => ({
      label: e.label,
      line: lineOf(e.request.method, e.request.path, e.request.parentPath, e.label || e.request.label),
    }))
  );
  section(
    "ELIMINADOS",
    result.removed.map((e) => ({
      label: e.label,
      line: lineOf(e.request.method, e.request.path, e.request.parentPath, e.label || e.request.label),
    }))
  );

  const modified = result.matched.filter((d) => d.kind === "modified");
  out.push(`--- MODIFICADOS (${modified.length}) ---`);
  for (const diff of modified) {
    const req = diff.base?.request ?? diff.compare?.request;
    if (!req) continue;
    const sampler = diff.base?.label || req.label || "";
    out.push(lineOf(req.method, req.path, req.parentPath, sampler));
    for (const change of diff.changes) {
      const before = truncate(change.before, 120);
      const after = truncate(change.after, 120);
      out.push(`     ${change.kind}/${change.name}: "${before}" -> "${after}"`);
    }
  }
  out.push("");

  const same = result.matched.filter((d) => d.kind === "same");
  out.push(`--- SIN CAMBIOS (${same.length}) ---`);
  for (const diff of same) {
    const req = diff.base?.request ?? diff.compare?.request;
    if (!req) continue;
    out.push(`  ${req.method} ${req.path}`);
  }
  out.push(bar);
  return out.join("\r\n");
}

/** Trunca un texto largo para el log TXT. */
function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

/**
 * Genera el contenido TXT (legible) del reporte por secciones:
 * un bloque por transacción JMX con su HAR asignado y el resumen de diferencias.
 */
export function buildSectionsTxt(sections: SectionComparison[], jmxName: string, prefixLabel: string): string {
  const out: string[] = [];
  const bar = "=".repeat(70);
  out.push(bar);
  out.push("REPORTE DE COMPARACIÓN POR SECCIONES (JMX vs HARs)");
  out.push(bar);
  out.push(`Base:            ${jmxName}`);
  out.push(`Prefijo:         ${prefixLabel}`);
  out.push(`Secciones:       ${sections.length}`);
  out.push("");

  const totals = { same: 0, modified: 0, added: 0, removed: 0 };
  for (const s of sections) {
    totals.same += s.result.matched.filter((d) => d.kind === "same").length;
    totals.modified += s.result.matched.filter((d) => d.kind === "modified").length;
    totals.added += s.result.added.length;
    totals.removed += s.result.removed.length;
  }
  out.push(`TOTALES: ✅ ${totals.same} iguales · ✏️ ${totals.modified} modificados · ➕ ${totals.added} nuevos · ➖ ${totals.removed} eliminados`);
  out.push("");

  for (const s of sections) {
    const same = s.result.matched.filter((d) => d.kind === "same").length;
    const modified = s.result.matched.filter((d) => d.kind === "modified").length;
    out.push(bar);
    out.push(`SECCIÓN: ${s.transaction}`);
    out.push(bar);
    out.push(`HAR asignado: ${s.harFileName}`);
    out.push(`Requests:     JMX ${s.jmxCount} · HAR ${s.harCount} (3xx omitidos: ${s.redirectsSkipped})`);
    out.push(`Resultado:    ✅ ${same} iguales · ✏️ ${modified} modificados · ➕ ${s.result.added.length} nuevos · ➖ ${s.result.removed.length} eliminados`);
    out.push("");

    const lineOf = (method: string, path: string, status?: number): string => {
      const st = status ? ` [${status}]` : "";
      return `  ${method} ${path}${st}`;
    };

    if (s.result.added.length > 0) {
      out.push(`  --- NUEVOS (${s.result.added.length}) ---`);
      for (const e of s.result.added) out.push(`    ${e.request.method} ${e.request.path}`);
      out.push("");
    }
    if (s.result.removed.length > 0) {
      out.push(`  --- ELIMINADOS (${s.result.removed.length}) ---`);
      for (const e of s.result.removed) out.push(`    ${e.request.method} ${e.request.path}`);
      out.push("");
    }
    const modifiedDiffs = s.result.matched.filter((d) => d.kind === "modified");
    if (modified > 0) {
      out.push(`  --- MODIFICADOS (${modified}) ---`);
      for (const diff of modifiedDiffs) {
        const req = diff.base?.request ?? diff.compare?.request;
        if (!req) continue;
        out.push(lineOf(req.method, req.path, req.statusCode));
        for (const change of diff.changes) {
          const before = truncate(change.before, 120);
          const after = truncate(change.after, 120);
          out.push(`       ${change.kind}/${change.name}: "${before}" -> "${after}"`);
        }
      }
      out.push("");
    }
    if (modified === 0 && s.result.added.length === 0 && s.result.removed.length === 0) {
      out.push("  (sin diferencias)");
      out.push("");
    }
  }
  out.push(bar);
  return out.join("\r\n");
}

/** Descarga un contenido como archivo en el navegador. */
export function downloadFile(content: string, fileName: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}
