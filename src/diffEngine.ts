import type {
  ComparisonResult,
  FieldDiff,
  HttpHeader,
  HttpRequest,
  ParsedFile,
  QueryParam,
  RequestDiff,
  RequestEntry,
} from "./types";
import { normalizeBody, normalizeValue, containsVariable, decodeParamValue, type CompareOptions, DEFAULT_OPTIONS } from "./normalize";

/** Clave de matching: método + path normalizado (sin query).
 *  Las variables ${...} del JMX se reemplazan por un placeholder ⟨var⟩ que en el
 *  matching actúa como comodín SOLO de la parte variable, conservando los
 *  literales del segmento (ej. Documents('⟨var⟩') no empareja con ContentTreeNodes(...)). */
function matchKey(r: HttpRequest): string {
  // El token de sesión en /as/<token>/resume/... cambia en cada ejecución
  // (en el JMX es ${pIdp}, en el HAR es un valor aleatorio): se colapsa a placeholder.
  const normalizedPath = r.path
    .replace(/\/as\/[^/]+\/resume\//, "/as/⟨var⟩/resume/")
    // Solo la parte ${...} dentro del segmento se vuelve placeholder; el resto
    // del segmento (ej. Documents('...')) se conserva como literal.
    .replace(/\$\{[^}]*\}/g, "⟨var⟩");
  return `${r.method} ${normalizedPath}`;
}

/** Indica si una clave de la base (JMX) equivale a una clave del comparado (HAR).
 *  El placeholder ⟨var⟩ (variables de JMeter) actúa como comodín de la parte
 *  variable dentro del segmento; los literales deben coincidir exactamente. */
function keysMatch(baseKey: string, compareKey: string): boolean {
  if (baseKey === compareKey) return true;
  if (!baseKey.includes("⟨var⟩")) return false;
  const spaceIdx = baseKey.indexOf(" ");
  const baseMethod = baseKey.slice(0, spaceIdx);
  const cmpSpace = compareKey.indexOf(" ");
  if (baseMethod !== compareKey.slice(0, cmpSpace)) return false;
  // Construye un regex a partir de la clave base: cada ⟨var⟩ coincide con
  // cualquier texto sin "/" (no cruza segmentos).
  const pattern = baseKey
    .slice(spaceIdx + 1)
    .split("/")
    .map((seg) => seg.split("⟨var⟩").map(escapeRegex).join("[^/]*"))
    .join("/");
  return new RegExp(`^${pattern}$`).test(compareKey.slice(cmpSpace + 1));
}

/** Escapa caracteres especiales de regex en un literal de path. */
function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Compara listas de query params: reporta añadidos, quitados y cambiados. */
function diffQuery(base: QueryParam[], compare: QueryParam[], options: CompareOptions): FieldDiff[] {
  const changes: FieldDiff[] = [];
  const volatile = new Set(options.volatileParams);
  const baseMap = new Map(base.map((q) => [decodeParamValue(q.name).toLowerCase(), decodeParamValue(q.value)]));
  const compareMap = new Map(compare.map((q) => [decodeParamValue(q.name).toLowerCase(), q.value]));

  for (const [name, value] of compareMap) {
    if (volatile.has(name)) continue;
    if (!baseMap.has(name)) {
      changes.push({ kind: "query", name, before: "", after: value });
    } else {
      const before = decodeParamValue(normalizeValue(baseMap.get(name) ?? "", options.ignoreVariables));
      const after = decodeParamValue(normalizeValue(value, options.ignoreVariables));
      // Si la base tiene una variable ${...}, el valor real del HAR es esperado.
      if (containsVariable(before)) continue;
      if (before !== after) {
        changes.push({ kind: "query", name, before: baseMap.get(name) ?? "", after: value });
      }
    }
  }
  for (const [name, value] of baseMap) {
    if (volatile.has(name)) continue;
    if (!compareMap.has(name)) {
      changes.push({ kind: "query", name, before: value, after: "" });
    }
  }
  return changes;
}

/** Compara headers por nombre (case-insensitive), ignorando los configurados. */
function diffHeaders(base: HttpHeader[], compare: HttpHeader[], options: CompareOptions): FieldDiff[] {
  const changes: FieldDiff[] = [];
  const ignored = new Set(options.ignoredHeaders);
  const norm = (h: HttpHeader) => h.name.toLowerCase();
  const baseMap = new Map(base.map((h) => [norm(h), h.value]));
  const compareMap = new Map(compare.map((h) => [norm(h), h.value]));

  for (const [name, value] of compareMap) {
    if (ignored.has(name)) continue;
    if (!baseMap.has(name)) {
      changes.push({ kind: "header", name, before: "", after: value });
    } else {
      const before = normalizeValue(baseMap.get(name) ?? "", options.ignoreVariables);
      const after = normalizeValue(value, options.ignoreVariables);
      if (containsVariable(before)) continue;
      if (before !== after) {
        changes.push({ kind: "header", name, before: baseMap.get(name) ?? "", after: value });
      }
    }
  }
  for (const [name, value] of baseMap) {
    if (ignored.has(name)) continue;
    if (!compareMap.has(name)) {
      changes.push({ kind: "header", name, before: value, after: "" });
    }
  }
  return changes;
}

/** Compara bodies: si difieren, un solo diff con ambos textos truncados. */
function diffBody(base: string, compare: string, options: CompareOptions): FieldDiff[] {
  const before = options.jsonBodies ? normalizeBody(base, options.ignoreVariables) : normalizeValue(base.trim(), options.ignoreVariables);
  const after = options.jsonBodies ? normalizeBody(compare, options.ignoreVariables) : normalizeValue(compare.trim(), options.ignoreVariables);
  if (before === after) return [];
  // Si la base contiene variables ${...}, el body real del HAR es esperado.
  if (containsVariable(before)) return [];
  // Sin truncado: la UI muestra los valores en celdas con scroll (max-height en CSS).
  // Para bodies JSON grandes se añade un resumen semántico (rutas que cambian).
  const summary = summarizeJsonDiff(before, after);
  return [{ kind: "body", name: "body", before, after, summary }];
}

/**
 * Calcula la subsecuencia común más larga (LCS) entre dos secuencias de claves
 * y devuelve los pares de índices emparejados (índice en base, índice en comparado).
 * Respeta el orden global del flujo: los requests se emparejan en el orden
 * en que aparecen en cada archivo.
 */
function lcsMatches(baseKeys: string[], compareKeys: string[]): Array<[number, number]> {
  const rows = baseKeys.length;
  const cols = compareKeys.length;
  // dp[i][j] = longitud LCS de baseKeys[i..] y compareKeys[j..]
  const dp: Uint32Array[] = [];
  for (let i = 0; i <= rows; i++) dp.push(new Uint32Array(cols + 1));
  for (let i = rows - 1; i >= 0; i--) {
    for (let j = cols - 1; j >= 0; j--) {
      dp[i][j] = keysMatch(baseKeys[i], compareKeys[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const pairs: Array<[number, number]> = [];
  let i = 0, j = 0;
  while (i < rows && j < cols) {
    if (keysMatch(baseKeys[i], compareKeys[j])) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }
  return pairs;
}

/** Compara dos archivos parseados y produce el reporte de diferencias. */
export function compareFiles(
  base: ParsedFile,
  compare: ParsedFile,
  options: CompareOptions = DEFAULT_OPTIONS
): ComparisonResult {
  // Alinea las dos secuencias de requests por orden de flujo (LCS sobre método+path).
  const baseKeys = base.requests.map(matchKey);
  const compareKeys = compare.requests.map(matchKey);
  const matches = lcsMatches(baseKeys, compareKeys);

  // Segunda pasada: el navegador puede emitir los requests en distinto orden que
  // el script JMX (llamadas en paralelo). Los sobrantes cuyo método+path sigue
  // siendo compatible se emparejan aunque el orden difiera, para no reportar el
  // mismo endpoint a la vez como "Eliminado" y "Nuevo".
  const usedBase = new Set(matches.map(([bi]) => bi));
  const usedCompare = new Set(matches.map(([, cj]) => cj));
  for (let j = 0; j < compareKeys.length; j++) {
    if (usedCompare.has(j)) continue;
    const idx = baseKeys.findIndex(
      (key, i) => !usedBase.has(i) && keysMatch(key, compareKeys[j])
    );
    if (idx >= 0) {
      matches.push([idx, j]);
      usedBase.add(idx);
      usedCompare.add(j);
    }
  }
  matches.sort((a, b) => a[0] - b[0]);

  const matchedBase = new Set<number>();
  const matchedCompare = new Set<number>();
  const matched: RequestDiff[] = [];

  for (const [baseIndex, compareIndex] of matches) {
    const baseReq = base.requests[baseIndex];
    const cmp = compare.requests[compareIndex];
    const baseEntry = { request: baseReq, label: baseReq.label || baseReq.path };
    const cmpEntry = { request: cmp, label: cmp.label || cmp.path };
    const changes = [
      ...diffQuery(baseEntry.request.query, cmpEntry.request.query, options),
      ...diffHeaders(baseEntry.request.headers, cmpEntry.request.headers, options),
      ...diffBody(baseReq.body, cmp.body, options),
    ];
    matched.push({ kind: changes.length ? "modified" : "same", base: baseEntry, compare: cmpEntry, changes });
    matchedBase.add(baseIndex);
    matchedCompare.add(compareIndex);
  }

  // Redirecciones del comparado (HAR): entries con status 3xx y sus destinos (Location).
  // JMeter con "Follow Redirects" activado registra una sola muestra por flujo, así que
  // los saltos de redirección del navegador no deben presentarse como requests nuevos.
  const baseFollowsRedirects = base.requests.some((r) => r.followRedirects !== false);
  const redirectedTargets = new Set<string>();
  for (const r of compare.requests) {
    if (r.statusCode !== undefined && r.statusCode >= 300 && r.statusCode < 400 && r.redirectTo) {
      redirectedTargets.add(`${r.method} ${r.redirectTo}`);
    }
  }
  const isRedirect = (r: HttpRequest): boolean => {
    if (r.statusCode !== undefined && r.statusCode >= 300 && r.statusCode < 400) return true;
    if (baseFollowsRedirects && r.redirectTo) return false; // Este request redirige a otro.
    return base.requests.some(
      (b) =>
        b.followRedirects !== false &&
        redirectedTargets.has(`${r.method} ${r.path}`)
    );
  };

  // Requests del comparado sin contraparte: nuevos (omitiendo redirecciones 3xx).
  const added: RequestEntry[] = [];
  const redirects: RequestEntry[] = [];
  let redirectsSkipped = 0;
  for (let j = 0; j < compare.requests.length; j++) {
    if (!matchedCompare.has(j)) {
      const r = compare.requests[j];
      if (baseFollowsRedirects && isRedirect(r)) {
        redirectsSkipped++;
        redirects.push({ request: r, label: r.label || r.path });
        continue;
      }
      added.push({ request: r, label: r.label || r.path });
    }
  }

  // Requests de la base sin contraparte en el comparado: eliminados.
  const removed: RequestEntry[] = [];
  for (let i = 0; i < base.requests.length; i++) {
    if (!matchedBase.has(i)) {
      const r = base.requests[i];
      removed.push({ request: r, label: r.label || r.path });
    }
  }

  return {
    removed,
    added,
    matched,
    totalBase: base.requests.length,
    totalCompare: compare.requests.length,
    redirectsSkipped,
    redirects,
  };
}

const SUMMARY_MAX_ENTRIES = 8;

/**
 * Resumen semántico de las diferencias entre dos bodies JSON: lista los valores
 * añadidos, eliminados o cambiados (con límite de entradas), sin mostrar la
 * ruta JSON (propia de la aplicación y no útil para el usuario).
 * Devuelve undefined si alguno de los dos no es JSON válido o no hay diferencias.
 */
function summarizeJsonDiff(before: string, after: string): string | undefined {
  let base: unknown;
  let comp: unknown;
  try {
    base = JSON.parse(before) as unknown;
    comp = JSON.parse(after) as unknown;
  } catch {
    return undefined;
  }
  const out: string[] = [];
  let truncated = false;

  const isObj = (v: unknown): v is Record<string, unknown> =>
    typeof v === "object" && v !== null && !Array.isArray(v);

  function walk(baseValue: unknown, compareValue: unknown, path: string): void {
    if (out.length >= SUMMARY_MAX_ENTRIES) { truncated = true; return; }
    if (baseValue === compareValue) return;
    if (JSON.stringify(baseValue) === JSON.stringify(compareValue)) return;

    if (Array.isArray(baseValue) && Array.isArray(compareValue)) {
      // Arrays que solo difieren en longitud (los items comunes son idénticos):
      // resumen compacto "N vs M" en vez de listar item por item.
      const minLen = Math.min(baseValue.length, compareValue.length);
      const commonEqual = baseValue
        .slice(0, minLen)
        .every((v, i) => JSON.stringify(v) === JSON.stringify(compareValue[i]));
      if (commonEqual) {
        out.push(`array con ${baseValue.length} items (HAR: ${compareValue.length}) — items comunes idénticos`);
        return;
      }
      const maxLen = Math.max(baseValue.length, compareValue.length);
      for (let i = 0; i < maxLen; i++) {
        if (out.length >= SUMMARY_MAX_ENTRIES) { truncated = true; return; }
        if (i >= baseValue.length) out.push(`añadido ${formatSummaryValue(compareValue[i])}`);
        else if (i >= compareValue.length) out.push(`eliminado (antes: ${formatSummaryValue(baseValue[i])})`);
        else walk(baseValue[i], compareValue[i], `${path}[${i}]`);
      }
      return;
    }
    if (isObj(baseValue) && isObj(compareValue)) {
      const keys = new Set([...Object.keys(baseValue), ...Object.keys(compareValue)]);
      for (const key of keys) {
        if (out.length >= SUMMARY_MAX_ENTRIES) { truncated = true; return; }
        if (!(key in baseValue)) out.push(`añadido ${formatSummaryValue(compareValue[key])}`);
        else if (!(key in compareValue)) out.push(`eliminado (antes: ${formatSummaryValue(baseValue[key])})`);
        else walk(baseValue[key], compareValue[key], `${path}.${key}`);
      }
      return;
    }
    const beforeText = JSON.stringify(baseValue) ?? String(baseValue);
    const afterText = JSON.stringify(compareValue) ?? String(compareValue);
    out.push(`${truncateSummaryValue(beforeText)} → ${truncateSummaryValue(afterText)}`);
  }

  walk(base, comp, "$");
  if (out.length === 0) return undefined;
  const lines = out.slice(0, SUMMARY_MAX_ENTRIES);
  if (truncated) lines.push(`… y más diferencias (ver body completo)`);
  return lines.join("\n");
}

function truncateSummaryValue(v: string): string {
  return v.length > 60 ? `${v.slice(0, 60)}…` : v;
}

/**
 * Serializa un valor para el resumen semántico: los primitivos se muestran tal
 * cual y los objetos/arrays se resumen con sus claves/longitud para no saturar
 * la salida con textos enormes.
 */
function formatSummaryValue(v: unknown): string {
  if (typeof v === "string") return `"${truncateSummaryValue(v)}"`;
  if (v === null || typeof v !== "object") return String(v);
  if (Array.isArray(v)) return `array de ${v.length} elemento${v.length === 1 ? "" : "s"}`;
  const keyCount = Object.keys(v).length;
  return keyCount > 0 ? `objeto con ${keyCount} clave${keyCount === 1 ? "" : "s"}` : "objeto vacío";
}
