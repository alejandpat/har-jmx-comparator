import type { HttpHeader, HttpRequest, ParsedFile, QueryParam } from "./types";
import { normalizePath, parseQueryString } from "./jmxParser";

interface HarQueryParam {
  name?: string;
  value?: string;
}

interface HarHeader {
  name?: string;
  value?: string;
}

interface HarPostData {
  mimeType?: string;
  text?: string;
  params?: HarQueryParam[];
}

interface HarEntryRequest {
  method?: string;
  url?: string;
  headers?: HarHeader[];
  queryString?: HarQueryParam[];
  postData?: HarPostData;
}

interface HarEntry {
  request?: HarEntryRequest;
  response?: {
    status?: number;
    headers?: HarHeader[];
    content?: {
      size?: number;
      mimeType?: string;
      text?: string;
    };
  };
  /** Duración total del entry en ms. */
  time?: number;
  _resourceType?: string;
  pageref?: string;
}

interface HarLog {
  creator?: { name?: string; version?: string };
  pages?: { id?: string; title?: string }[];
}

/** Parsea el contenido de un archivo .har y extrae los HTTP requests. */
export function parseHar(content: string, fileName: string): ParsedFile {
  // Algunos exportadores (ej. Fiddler) anteponen un BOM UTF-8 que rompe JSON.parse.
  if (content.charCodeAt(0) === 0xfeff) content = content.slice(1);
  const doc = JSON.parse(content) as { log?: HarLog & { entries?: HarEntry[] } };
  const log = doc?.log ?? {};
  const entries = log.entries ?? [];

  // Filtra entries de comentario de Fiddler (Shift+M): se exportan como pseudo-requests
  // con host "COMMENT" (ej. "GET http://COMMENT/_ITL_Marker HTTP/1.1") y no son requests reales.
  const realEntries = entries.filter((entry) => {
    const url = entry.request?.url ?? "";
    const hostMatch = url.match(/^https?:\/\/([^/?#]+)/i);
    return (hostMatch?.[1] ?? "").trim().toLowerCase() !== "comment";
  });

  const requests: HttpRequest[] = realEntries.map((entry, i) => {
    const req = entry.request ?? {};
    const method = (req.method ?? "GET").toUpperCase();
    const rawUrl = req.url ?? "/";
    const qIndex = rawUrl.indexOf("?");
    const rawQuery = qIndex === -1 ? "" : rawUrl.slice(qIndex + 1);

    // Query params: usa queryString del HAR; si viene vacío, parsea la URL cruda.
    let query: QueryParam[] = (req.queryString ?? []).map((q) => ({
      name: q.name ?? "",
      value: q.value ?? "",
    }));
    if (query.length === 0 && rawQuery) {
      query = parseQueryString(rawQuery);
    }

    // Filtra pseudo-headers de comentario que algunos exportadores insertan (ej. "Host: COMMENT").
    const headers: HttpHeader[] = (req.headers ?? [])
      .filter((h) => (h.value ?? "").trim().toUpperCase() !== "COMMENT")
      .map((h) => ({
        name: h.name ?? "",
        value: h.value ?? "",
      }));

    // Body: postData.text, o params serializados si el body venía como form.
    let body = req.postData?.text ?? "";
    if (!body && req.postData?.params?.length) {
      body = req.postData.params
        .map((p) => `${encodeURIComponent(p.name ?? "")}=${encodeURIComponent(p.value ?? "")}`)
        .join("&");
    }

    // Estado de la respuesta y redirección (header Location) para evaluar 3xx.
    const statusCode = entry.response?.status;
    const responseSize = entry.response?.content?.size;
    const responseTime = entry.time;
    const responseHeaders: HttpHeader[] = (entry.response?.headers ?? [])
      .map((h) => ({ name: (h.name ?? "").trim(), value: h.value ?? "" }))
      .filter((h) => h.name !== "");
    const responseBody = entry.response?.content?.text ?? "";
    const responseMimeType = entry.response?.content?.mimeType ?? "";
    const locationHeader = (entry.response?.headers ?? []).find(
      (h) => (h.name ?? "").trim().toLowerCase() === "location"
    );

    return {
      method,
      path: normalizePath(rawUrl),
      rawUrl,
      query,
      headers,
      body,
      source: "har" as const,
      order: i,
      label: "",
      parentPath: "",
      statusCode,
      responseSize,
      responseTime,
      responseHeaders,
      responseBody,
      responseMimeType,
      redirectTo: locationHeader ? normalizePath(locationHeader.value ?? "") : undefined,
    };
  });

  return {
    kind: "har",
    fileName,
    requests,
    meta: {
      creator: log.creator?.name ? `${log.creator.name} ${log.creator.version ?? ""}`.trim() : "",
      entries: String(entries.length),
    },
  };
}
