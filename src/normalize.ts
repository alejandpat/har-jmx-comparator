/**
 * Utilidades de normalización para reducir falsos positivos al comparar
 * requests entre un JMX (con variables de JMeter) y un HAR (valores reales).
 */

/** Headers que estructuralmente difieren entre un JMX y un HAR del navegador. */
export const DEFAULT_IGNORED_HEADERS = [
  "host",
  "content-length",
  "user-agent",
  "cookie",
  "set-cookie",
  "authorization",
  "origin",
  "referer",
  "accept",
  "accept-encoding",
  "accept-language",
  "connection",
  "cache-control",
  "pragma",
  "sec-ch-ua",
  "sec-ch-ua-mobile",
  "sec-ch-ua-platform",
  "sec-fetch-site",
  "sec-fetch-mode",
  "sec-fetch-dest",
  "sec-fetch-user",
  "sec-fetch-dest",
  "upgrade-insecure-requests",
  "dnt",
  "origin",
  "content-type",
  "correlationid",
  "x-app-version",
  "priority",
  "x-csrf-token",
];

/** Query params que cambian en cada ejecución (sesión, cache, timestamps). */
export const DEFAULT_VOLATILE_PARAMS = [
  "token",
  "sessionid",
  "session_id",
  "sid",
  "jsessionid",
  "phpsessid",
  "timestamp",
  "_",
  "t",
  "nonce",
  "csrf",
  "_csrf",
  "authenticity_token",
  "cachebuster",
  "_t",
  "v",
  "cache",
  "nocache",
];

/**
 * Normaliza un valor para comparación:
 * - Reemplaza variables de JMeter ${...} por un placeholder.
 * - Opcionalmente colapsa espacios en blanco.
 */
export function normalizeValue(value: string, ignoreVariables: boolean): string {
  if (!ignoreVariables) return value;
  // ${var} y ${var} con espacios → placeholder uniforme.
  return value.replace(/\$\{[^}]*\}/g, "⟨var⟩");
}

/** Indica si el valor normalizado contiene una variable de JMeter (no comparable). */
export function containsVariable(normalized: string): boolean {
  return normalized.includes("⟨var⟩");
}

/** Compara dos valores ya normalizados; un valor con variable nunca es "cambio". */
export function valuesDiffer(baseNormalized: string, compareNormalized: string): boolean {
  if (baseNormalized === "") return false;
  if (baseNormalized === compareNormalized) return false;
  return true;
}

/**
 * Decodifica un valor percent-encoded (query param o form param) para comparación.
 * Convierte "+" en espacio y decodifica %XX. Si no es decodificable, lo devuelve tal cual.
 * Esto hace irrelevante la casilla "URL Encode?" del JMeter: el JMX guarda el valor
 * sin encode y el HAR lo trae con encode; ambos se normalizan al valor decodificado.
 */
export function decodeParamValue(value: string): string {
  if (!value.includes("%") && !value.includes("+")) return value;
  try {
    return decodeURIComponent(value.replace(/\+/g, "%20"));
  } catch {
    return value;
  }
}

/**
 * Decodifica un body form-urlencoded para visualización. Si el body parece JSON
 * (empieza con { o [) o no contiene %XX, se devuelve tal cual para no corromperlo.
 */
export function decodeFormBody(body: string): string {
  const trimmed = body.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return body;
  if (!body.includes("%")) return body;
  try {
    return decodeURIComponent(body.replace(/\+/g, "%20"));
  } catch {
    return body;
  }
}

/**
 * Normaliza un body: si es JSON válido, lo serializa con claves ordenadas
 * y sin espacios (comparación semántica). Si es form-urlencoded, decodifica
 * los valores y los ordena. Si no, devuelve el texto normalizado.
 */
export function normalizeBody(body: string, ignoreVariables: boolean): string {
  let base = normalizeValue(body.trim(), ignoreVariables);
  // Los args de JMeter con nombre vacío serializan el body como "=valor" (ej. "=[]").
  // Se elimina el "=" inicial para comparar solo el valor real.
  if (base.startsWith("=")) base = base.slice(1);
  if (!base) return "";
  // 1) JSON directo.
  const direct = trySortJson(base);
  if (direct !== null) return direct;
  // 2) Body URL-encoded (ej. "%5B%5D" = "[]"): JMeter guarda los bodies de samplers
  //    URL-encoded mientras el HAR los trae decodificados. Decodifica y reintenta.
  if (/%[0-9A-Fa-f]{2}/.test(base)) {
    try {
      const decodedJson = trySortJson(decodeURIComponent(base));
      if (decodedJson !== null) return decodedJson;
    } catch {
      // Secuencia %XX malformada: sigue con el texto crudo.
    }
  }
  // 3) No es JSON: si parece form-urlencoded (a=1&b=2), decodifica y ordena los pares.
  if (looksLikeFormBody(base)) {
    return serializeFormBody(base);
  }
  return base;
}

/** Intenta parsear JSON y devolverlo con claves ordenadas; null si no es JSON válido. */
function trySortJson(text: string): string | null {
  try {
    return JSON.stringify(sortDeep(JSON.parse(text) as unknown));
  } catch {
    return null;
  }
}

/** Detecta un body form-urlencoded: pares clave=valor separados por &. */
function looksLikeFormBody(body: string): boolean {
  if (!body.includes("=")) return false;
  return body.split("&").every((pair) => /^[^=&]*=[^&]*$/.test(pair) || /^[^=&]*$/.test(pair));
}

/** Parsea un body form-urlencoded, decodifica y ordena los pares para comparación semántica. */
function serializeFormBody(body: string): string {
  const pairs = body
    .split("&")
    .filter(Boolean)
    .map((pair) => {
      const eq = pair.indexOf("=");
      const name = eq === -1 ? pair : pair.slice(0, eq);
      const value = eq === -1 ? "" : pair.slice(eq + 1);
      return `${decodeParamValue(name)}=${decodeParamValue(value)}`;
    })
    .sort();
  return pairs.join("&");
}

/** Ordena recursivamente las claves de un objeto para comparación semántica. */
function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value !== null && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = sortDeep((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

/** Opciones de comparación configurables desde la UI. */
export interface CompareOptions {
  /** Headers a ignorar (nombres en minúsculas). */
  ignoredHeaders: string[];
  /** Query params a ignorar (nombres en minúsculas). */
  volatileParams: string[];
  /** Reemplazar variables ${...} de JMeter por un placeholder. */
  ignoreVariables: boolean;
  /** Comparar bodies JSON semánticamente (claves ordenadas, sin espacios). */
  jsonBodies: boolean;
}

export const DEFAULT_OPTIONS: CompareOptions = {
  ignoredHeaders: DEFAULT_IGNORED_HEADERS,
  volatileParams: DEFAULT_VOLATILE_PARAMS,
  ignoreVariables: true,
  jsonBodies: true,
};
