import type { HttpRequest } from "./types";

/** Escapa un valor para uso seguro entre comillas simples en shell. */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/**
 * Genera un comando cURL ejecutable a partir de un request normalizado.
 * Usa rawUrl (host + query reales) si está disponible (HAR); si no, reconstruye
 * la URL desde el path + query params (JMX, con variables ${...} intactas).
 */
export function buildCurl(request: HttpRequest): string {
  const parts: string[] = ["curl", "-X", request.method];

  for (const header of request.headers) {
    if (!header.name) continue;
    parts.push("-H", shellQuote(`${header.name}: ${header.value}`));
  }

  if (request.body) {
    parts.push("--data", shellQuote(request.body));
  }

  // URL: prefiere la cruda del HAR; en JMX reconstruye path + query.
  let url: string;
  if (request.rawUrl) {
    url = request.rawUrl;
  } else {
    const qs = request.query
      .map((q) => `${encodeURIComponent(q.name)}=${encodeURIComponent(q.value)}`)
      .join("&");
    url = qs ? `${request.path}?${qs}` : request.path;
  }
  parts.push(shellQuote(url));

  return parts.join(" ");
}
