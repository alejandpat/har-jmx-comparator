import type { ComparisonResult, ParsedFile } from "./types";
import { compareFiles } from "./diffEngine";
import { logWarn } from "./logger";
import type { CompareOptions } from "./normalize";

/**
 * Comparación por secciones: mapea cada HAR (por nombre de archivo) a su
 * transacción del JMX (controladores con un prefijo común, ej. ITL_*, NAV_*)
 * y compara cada HAR solo contra los samplers de esa sección, en lugar de
 * mezclar todos los HARs contra el JMX completo.
 */

/**
 * Detecta el prefijo de transacción usado en los controladores del JMX.
 * Busca segmentos de parentPath con formato "XXX_Nombre" y devuelve el prefijo
 * más frecuente (ej. "ITL_", "NAV_"). Devuelve null si no hay uno dominante.
 */
export function detectTransactionPrefix(jmx: ParsedFile): string | null {
  const counts = new Map<string, number>();
  for (const r of jmx.requests) {
    for (const seg of r.parentPath.split(" > ")) {
      const m = seg.trim().match(/^([A-Za-z][A-Za-z0-9]{1,9})_/);
      if (m) {
        const key = m[1].toUpperCase();
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
  }
  if (counts.size === 0) return null;
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const [top, topCount] = sorted[0];
  const total = sorted.reduce((acc, [, c]) => acc + c, 0);
  // Solo lo considera prefijo si domina claramente (evita falsos positivos con
  // nombres sueltos que casualmente llevan guion bajo).
  return topCount / total >= 0.5 ? `${top}_` : null;
}

/** Nombre corto del HAR: quita extensión y prefijos de script (ej. "OneLegale_Script_26.10.4_STG_"). */
function shortHarName(fileName: string): string {
  return fileName
    .replace(/\.har$/i, "")
    .replace(/^.*?_STG_/i, "");
}

/** Divide un nombre en tokens alfanuméricos, sin el prefijo de transacción (ej. "ITL_", "NAV_"). */
function tokenize(name: string, prefix?: string): string[] {
  let base = name.toLowerCase();
  if (prefix) {
    const p = prefix.toLowerCase();
    if (base.startsWith(p)) base = base.slice(p.length);
  } else {
    base = base.replace(/^[a-z0-9]+_/, "");
  }
  return base
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** Similitud Jaccard entre dos listas de tokens. */
function tokenScore(a: string[], b: string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  let inter = 0;
  for (const t of setA) if (setB.has(t)) inter++;
  return inter / (setA.size + setB.size - inter);
}

/** Extrae las transacciones con el prefijo dado presentes en el JMX (segmentos de parentPath).
 *  Si prefix es null, considera todos los segmentos de controlador como transacciones candidatas,
 *  excluyendo contenedores genéricos de JMeter (Thread Group, Test Plan, etc.). */
export function extractTransactions(jmx: ParsedFile, prefix: string | null): string[] {
  const names = new Set<string>();
  for (const r of jmx.requests) {
    for (const seg of r.parentPath.split(" > ")) {
      const t = seg.trim();
      if (GENERIC_CONTAINERS.has(t.toLowerCase())) continue;
      if (prefix === null || t.toUpperCase().startsWith(prefix.toUpperCase())) names.add(t);
    }
  }
  return [...names].sort();
}

/** Contenedores genéricos de JMeter que no representan transacciones de negocio. */
const GENERIC_CONTAINERS = new Set([
  "test plan",
  "thread group",
  "setup thread group",
  "post thread group",
  "test fragment",
  "user defined variables",
  "http request defaults",
  "http cookie manager",
  "http header manager",
  "workbench",
]);

/** Mapea un nombre corto de HAR a la transacción JMX más similar (null si no hay match razonable). */
export function matchHarToTransaction(shortName: string, transactions: string[], prefix?: string): string | null {
  const harTokens = tokenize(shortName, prefix);
  let bestTx: { name: string; score: number } | null = null;
  for (const tx of transactions) {
    const score = tokenScore(harTokens, tokenize(tx, prefix));
    if (!bestTx || score > bestTx.score) bestTx = { name: tx, score };
  }
  return bestTx && bestTx.score >= 0.3 ? bestTx.name : null;
}

/** Resultado de comparar un HAR contra su sección del JMX. */
export interface SectionComparison {
  /** Transacción JMX asignada (ej. "ITL_Login_Page"). */
  transaction: string;
  /** Nombre del archivo HAR asignado. */
  harFileName: string;
  /** Requests JMX en la sección. */
  jmxCount: number;
  /** Requests HAR (incluye 3xx; ver redirectsSkipped). */
  harCount: number;
  /** Redirecciones 3xx del HAR omitidas como nuevos. */
  redirectsSkipped: number;
  /** Resultado de comparación de la sección. */
  result: ComparisonResult;
}

/**
 * Compara un conjunto de HARs contra las secciones de transacción del JMX
 * (controladores con el prefijo detectado, ej. ITL_*, NAV_*).
 * Cada HAR se asigna a una transacción por similitud de nombre y se compara
 * solo contra los samplers de esa sección.
 */
export function compareBySections(
  jmx: ParsedFile,
  hars: ParsedFile[],
  options: CompareOptions,
  /** Prefijo manual (override). Si se omite, se detecta automáticamente. */
  manualPrefix?: string | null
): SectionComparison[] {
  const prefix = manualPrefix !== undefined ? manualPrefix : detectTransactionPrefix(jmx);
  const transactions = extractTransactions(jmx, prefix);
  const results: SectionComparison[] = [];

  for (const har of hars) {
    const short = shortHarName(har.fileName);
    const tx = matchHarToTransaction(short, transactions, prefix ?? undefined);
    if (!tx) {
      logWarn("secciones", `No se encontró transacción para "${har.fileName}"; se omite.`);
      continue;
    }
    const sectionRequests = jmx.requests.filter((r) =>
      r.parentPath.split(" > ").some((s) => s.trim() === tx)
    );
    if (sectionRequests.length === 0) {
      logWarn("secciones", `La transacción "${tx}" no tiene samplers en el JMX; se omite.`);
      continue;
    }
    const base: ParsedFile = { ...jmx, fileName: `JMX:${tx}`, requests: sectionRequests };
    const result = compareFiles(base, har, options);
    results.push({
      transaction: tx,
      harFileName: har.fileName,
      jmxCount: sectionRequests.length,
      harCount: har.requests.length,
      redirectsSkipped: result.redirectsSkipped,
      result,
    });
  }
  // Conserva el orden del script JMX: ordena por la primera aparición de cada
  // transacción en el flujo de requests (no alfabéticamente).
  const order = new Map<string, number>();
  for (const r of jmx.requests) {
    for (const seg of r.parentPath.split(" > ")) {
      const t = seg.trim();
      if ((prefix === null || t.toUpperCase().startsWith((prefix ?? "").toUpperCase())) && !order.has(t)) {
        order.set(t, order.size);
      }
    }
  }
  results.sort((a, b) => (order.get(a.transaction) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.transaction) ?? Number.MAX_SAFE_INTEGER));
  return results;
}
