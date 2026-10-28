import type { HttpRequest, ParsedFile } from "./types";

/** Extensiones de assets estáticos del front (scripts, estilos, imágenes, fuentes, media). */
export const DEFAULT_ASSET_EXTENSIONS = [
  "js", "mjs", "cjs", "css", "map",
  "png", "jpg", "jpeg", "gif", "svg", "webp", "avif", "ico", "bmp",
  "woff", "woff2", "ttf", "otf", "eot",
  "mp4", "webm", "mp3", "ogg", "wav",
];

/** Detecta si un request es un asset estático del front por su extensión. */
export function isStaticAsset(request: HttpRequest): boolean {
  const url = (request.rawUrl ?? request.path).toLowerCase().split("?")[0];
  return DEFAULT_ASSET_EXTENSIONS.some((ext) => url.endsWith(`.${ext}`));
}

/** Extrae el dominio (host) de una URL cruda; "" si no se puede deducir. */
export function extractDomain(rawUrl: string | undefined): string {
  if (!rawUrl) return "";
  const match = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i.exec(rawUrl);
  if (!match) return "";
  // Quita usuario:contraseña y puerto.
  return rawUrl
    .slice(rawUrl.indexOf("://") + 3, rawUrl.indexOf("/", rawUrl.indexOf("://") + 3))
    .split("@")
    .pop()!
    .split(":")[0]
    .toLowerCase();
}

/** Devuelve el path + query de una URL cruda (todo lo que sigue al host); "" si no hay. */
export function pathWithQuery(rawUrl: string | undefined): string {
  if (!rawUrl) return "";
  const schemeIndex = rawUrl.indexOf("://");
  if (schemeIndex === -1) return rawUrl;
  const pathIndex = rawUrl.indexOf("/", schemeIndex + 3);
  return pathIndex === -1 ? "/" : rawUrl.slice(pathIndex);
}

/**
 * Filtra los requests de un archivo parseado:
 * - `includePatterns`: si hay alguno, solo pasan los requests cuyo método+URL
 *   contiene alguno de los patrones (subcadena, case-insensitive).
 * - `excludePatterns`: descarta los requests cuya URL contiene alguno.
 * - `excludeAssets`: descarta assets estáticos del front (js, css, imágenes, fuentes).
 *
 * Devuelve el mismo archivo con solo los requests que pasan el filtro y el orden
 * reindexado. Si no hay ningún filtro activo, devuelve el archivo sin cambios.
 */
export function filterParsedFile(
  file: ParsedFile,
  includePatterns: string[],
  excludePatterns: string[] = [],
  excludeAssets = false,
  allowedDomains: ReadonlySet<string> = new Set()
): ParsedFile {
  const include = includePatterns.map((p) => p.trim().toLowerCase()).filter(Boolean);
  const exclude = excludePatterns.map((p) => p.trim().toLowerCase()).filter(Boolean);
  if (include.length === 0 && exclude.length === 0 && !excludeAssets && allowedDomains.size === 0) return file;

  const requests: HttpRequest[] = [];
  for (const request of file.requests) {
    if (excludeAssets && isStaticAsset(request)) continue;
    if (allowedDomains.size > 0 && !allowedDomains.has(extractDomain(request.rawUrl))) continue;
    const haystack = `${request.method} ${request.rawUrl ?? request.path} ${request.path}`.toLowerCase();
    if (include.length > 0 && !include.some((pattern) => haystack.includes(pattern))) continue;
    if (exclude.some((pattern) => haystack.includes(pattern))) continue;
    requests.push({ ...request, order: requests.length });
  }

  return {
    ...file,
    requests,
    meta: { ...file.meta, entries: String(requests.length) },
  };
}

/** Parsea el texto del input de filtro: separa por coma o salto de línea. */
export function parseFilterInput(value: string): string[] {
  return value
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}
