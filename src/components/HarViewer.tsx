import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { HttpRequest, ParsedFile } from "../types";
import { parseHar } from "../harParser";
import { extractDomain, isStaticAsset, pathWithQuery } from "../urlFilter";
import { logError, logInfo, logWarn } from "../logger";
import { Collapsible } from "./Collapsible";
import { useLang } from "../i18n";

interface HarViewerProps {
  /** HAR activo (comparte el estado con la pestaña de comparación). */
  harFile: ParsedFile | null;
  /** Todos los HAR cargados en la app. */
  harFiles: ParsedFile[];
  /** Reemplaza la lista completa de HAR cargados en la app. */
  onFilesChange: (files: ParsedFile[]) => void;
  /** Marca un HAR como activo (se comparte con la comparación). */
  onSelectFile: (file: ParsedFile | null) => void;
}

/** Formatea bytes a texto legible (KB/MB). */
function formatBytes(bytes: number | undefined): string {
  if (!bytes || bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

/** Formatea milisegundos. */
function formatTime(ms: number | undefined): string {
  if (ms === undefined || ms === null) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

/** Deduce el tipo de recurso por la extensión de la URL. */
function resourceType(request: HttpRequest): string {
  const url = (request.rawUrl ?? request.path).toLowerCase().split("?")[0];
  const ext = url.slice(url.lastIndexOf(".") + 1);
  const known = new Set([
    "js", "mjs", "css", "map", "html", "htm",
    "png", "jpg", "jpeg", "gif", "svg", "webp", "ico",
    "woff", "woff2", "ttf", "otf",
    "json", "xml", "pdf", "mp4", "webm",
  ]);
  if (ext && known.has(ext)) return ext.toUpperCase();
  return request.body ? "xhr" : "doc";
}

/** Intenta formatear un texto como JSON con indentación. */
function tryPrettyJson(text: string): string {
  if (!text) return "";
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

/** Resalta las ocurrencias de `term` dentro de `text` (case-insensitive). */
function Highlight({ text, term }: { text: string; term: string }) {
  if (!term || !text) return <>{text}</>;
  const lower = text.toLowerCase();
  const needle = term.toLowerCase();
  const parts: ReactNode[] = [];
  let from = 0;
  let key = 0;
  while (true) {
    const idx = lower.indexOf(needle, from);
    if (idx === -1) {
      parts.push(text.slice(from));
      break;
    }
    if (idx > from) parts.push(text.slice(from, idx));
    parts.push(<mark key={key++}>{text.slice(idx, idx + needle.length)}</mark>);
    from = idx + needle.length;
  }
  return <>{parts}</>;
}

/** Tabla simple de pares nombre/valor (headers, query params), con toggle de decodificar/codificar URL. */
function PairTable({
  title,
  pairs,
  highlight,
  urlEncoded,
}: {
  title: string;
  pairs: { name: string; value: string }[];
  highlight?: string;
  /** Permite decodificar/codificar los valores (query params). */
  urlEncoded?: boolean;
}) {
  const [decoded, setDecoded] = useState(false);
  if (pairs.length === 0) return null;
  const transform = (value: string): string => {
    if (!urlEncoded || !decoded) return value;
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  };
  return (
    <div className="detail-pairs">
      <div className="detail-pairs-toolbar">
        {title ? <h4>{title}</h4> : <span />}
        {urlEncoded && (
          <button className="copy-button" onClick={() => setDecoded((v) => !v)}>
            {decoded ? "🔗 Codificar URL" : "🔓 Decodificar URL"}
          </button>
        )}
      </div>
      <table className="results-table">
        <tbody>
          {pairs.map((p, i) => (
            <tr key={`${p.name}-${i}`}>
              <td className="pair-name">{p.name}</td>
              <td className="pair-value">
                <Highlight text={transform(p.value)} term={highlight ?? ""} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Bloque de texto preformateado (bodies), con botón de copiar. */
function TextBlock({ text, mime, highlight }: { text: string; mime?: string; highlight?: string }) {
  const pretty = tryPrettyJson(text);
  const [copied, setCopied] = useState(false);
  // Evita resaltar en textos enormes (rendimiento).
  const canHighlight = pretty.length <= 200_000;
  const copyBody = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      logError("visor", "No se pudo copiar el body al portapapeles.");
    }
  };
  return (
    <pre className="detail-body">
      <div className="detail-body-toolbar">
        {mime ? <div className="detail-mime">{mime}</div> : <span />}
        <button className="copy-button" onClick={copyBody}>
          {copied ? "✅ Copiado" : "📋 Copiar body"}
        </button>
      </div>
      <code>
        {canHighlight && highlight ? <Highlight text={pretty} term={highlight} /> : pretty}
      </code>
    </pre>
  );
}

/** Un hallazgo individual dentro de un request. */
interface SearchHit {
  side: "request" | "response";
  field: "header" | "body";
  /** Nombre del header (solo cuando field = "header"). */
  headerName?: string;
  /** Fragmento de contexto alrededor del match. */
  snippet: string;
  /** Offset del match dentro del snippet. */
  snippetStart: number;
}

/** Ejecuta la búsqueda según las opciones y devuelve los requests con matches. */
function runSearch(requests: HttpRequest[], text: string, opts: SearchOptions): Map<number, SearchHit[]> {
  const results = new Map<number, SearchHit[]>();
  if (!text) return results;
  for (const r of requests) {
    const hits: SearchHit[] = [];
    if (opts.scopeRequest && opts.fieldHeaders) {
      for (const h of r.headers) {
        const hit = matchHeader(h, "request", text);
        if (hit) hits.push(hit);
      }
    }
    if (opts.scopeRequest && opts.fieldBody && r.body.toLowerCase().includes(text.toLowerCase())) {
      hits.push(buildBodyHit(r.body, "request", "body", text));
    }
    if (opts.scopeResponse && opts.fieldHeaders) {
      for (const h of r.responseHeaders ?? []) {
        const hit = matchHeader(h, "response", text);
        if (hit) hits.push(hit);
      }
    }
    if (opts.scopeResponse && opts.fieldBody && (r.responseBody ?? "").toLowerCase().includes(text.toLowerCase())) {
      hits.push(buildBodyHit(r.responseBody ?? "", "response", "body", text));
    }
    if (hits.length > 0) results.set(r.order, hits);
  }
  return results;
}

interface SearchOptions {
  scopeRequest: boolean;
  scopeResponse: boolean;
  fieldHeaders: boolean;
  fieldBody: boolean;
}

/** Busca el texto en el nombre o valor de un header. */
function matchHeader(
  header: { name: string; value: string },
  side: SearchHit["side"],
  text: string
): SearchHit | null {
  if (header.name.toLowerCase().includes(text.toLowerCase())) {
    return { side, field: "header", headerName: header.name, snippet: `${header.name}: ${header.value}`.slice(0, 140), snippetStart: 0 };
  }
  const idx = header.value.toLowerCase().indexOf(text.toLowerCase());
  if (idx === -1) return null;
  const context = 40;
  const start = Math.max(0, idx - context);
  const snippet = header.value.slice(start, Math.min(header.value.length, idx + text.length + context));
  return {
    side,
    field: "header",
    headerName: header.name,
    snippet: (start > 0 ? "…" : "") + snippet + (idx + text.length + context < header.value.length ? "…" : ""),
    snippetStart: idx - start,
  };
}

/** Crea un hit de body con snippet de contexto. */
function buildBodyHit(text: string, side: SearchHit["side"], field: "body", term: string): SearchHit {
  const idx = text.toLowerCase().indexOf(term.toLowerCase());
  const context = 60;
  const start = Math.max(0, idx - context);
  const end = Math.min(text.length, idx + term.length + context);
  return {
    side,
    field,
    snippet: (start > 0 ? "…" : "") + text.slice(start, end).replace(/\s+/g, " ") + (end < text.length ? "…" : ""),
    snippetStart: idx - start,
  };
}

/** Panel de detalle de un request, con secciones colapsables. */
function RequestDetail({
  request,
  highlight,
  onClose,
}: {
  request: HttpRequest;
  highlight?: string;
  onClose: () => void;
}) {
  const { t } = useLang();
  return (
    <div className="request-detail">
      <div className="detail-header">
        <h3>
          <span className={`status-code status-${request.statusCode ? Math.floor(request.statusCode / 100) : 0}xx`}>
            {request.statusCode ?? "—"}
          </span>{" "}
          {request.method} {request.rawUrl ?? request.path}
        </h3>
        <button className="options-toggle" onClick={onClose}>✕ {t("Cerrar")}</button>
      </div>

      <div className="detail-columns">
        <div className="detail-col">
          <h4>{t("Request")}</h4>
          <Collapsible title={t("Query params")} summary={`${request.query.length} ${t("params")}`}>
            <PairTable
              title=""
              pairs={request.query.map((q) => ({ name: q.name, value: q.value }))}
              highlight={highlight}
              urlEncoded
            />
          </Collapsible>
          <Collapsible title={t("Headers")} summary={`${request.headers.length} ${t("headers")}`}>
            <PairTable
              title=""
              pairs={request.headers.map((h) => ({ name: h.name, value: h.value }))}
              highlight={highlight}
            />
          </Collapsible>
          {request.body && (
            <Collapsible title={t("Body")} summary={`${request.body.length} ${t("caracteres")}`}>
              <TextBlock text={request.body} highlight={highlight} />
            </Collapsible>
          )}
        </div>

        <div className="detail-col">
          <h4>{t("Response")}</h4>
          <p className="detail-meta">
            {request.responseMimeType || "—"} · {formatBytes(request.responseSize)} · {formatTime(request.responseTime)}
          </p>
          <Collapsible title={t("Headers")} summary={`${(request.responseHeaders ?? []).length} ${t("headers")}`}>
            <PairTable
              title=""
              pairs={(request.responseHeaders ?? []).map((h) => ({ name: h.name, value: h.value }))}
              highlight={highlight}
            />
          </Collapsible>
          <Collapsible title={t("Body")} summary={request.responseBody ? `${request.responseBody.length} ${t("caracteres")}` : t("no capturado")}>
            {request.responseBody ? (
              <TextBlock text={request.responseBody} mime={request.responseMimeType} highlight={highlight} />
            ) : (
              <p className="detail-empty">{t("No capturado en el HAR.")}</p>
            )}
          </Collapsible>
        </div>
      </div>
    </div>
  );
}

/**
 * Visor de HAR: muestra todos los requests del archivo en su orden original,
 * con búsqueda y filtro por tipo. Al hacer clic en una fila muestra el detalle
 * completo del request y del response. Incluye buscador avanzado con opciones
 * de alcance (request/response) y campo (headers/body) que resalta los matches.
 */
export function HarViewer({ harFile, harFiles, onFilesChange, onSelectFile }: HarViewerProps) {
  const { t } = useLang();
  const [search, setSearch] = useState("");
  const [onlyApi, setOnlyApi] = useState(false);
  const [selected, setSelected] = useState<HttpRequest | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [scopeRequest, setScopeRequest] = useState(true);
  const [scopeResponse, setScopeResponse] = useState(true);
  const [fieldHeaders, setFieldHeaders] = useState(true);
  const [fieldBody, setFieldBody] = useState(true);
  const [activeSearch, setActiveSearch] = useState<string | null>(null);
  const [domainsOpen, setDomainsOpen] = useState(false);
  const [selectedDomains, setSelectedDomains] = useState<Set<string>>(new Set());
  const inputRef = useRef<HTMLInputElement>(null);

  // Dominios disponibles en todos los HAR cargados, ordenados por cantidad de requests.
  const availableDomains = useMemo(() => {
    const counts = new Map<string, number>();
    for (const file of harFiles) {
      for (const r of file.requests) {
        const domain = extractDomain(r.rawUrl);
        if (!domain) continue;
        counts.set(domain, (counts.get(domain) ?? 0) + 1);
      }
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [harFiles]);

  // Limpia la selección de dominios que ya no existen (ej. al quitar un HAR).
  useEffect(() => {
    setSelectedDomains((prev) => {
      const valid = new Set(availableDomains.map(([d]) => d));
      const next = new Set([...prev].filter((d) => valid.has(d)));
      return next.size === prev.size ? prev : next;
    });
  }, [availableDomains]);

  // Requests agrupados por archivo HAR, con el filtro de URL aplicado.
  const groupedRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return harFiles.map((file) => {
      const rows = file.requests
        .filter((r) => {
          if (onlyApi && isStaticAsset(r)) return false;
          if (selectedDomains.size > 0 && !selectedDomains.has(extractDomain(r.rawUrl))) return false;
          if (query && !`${r.method} ${r.rawUrl ?? r.path}`.toLowerCase().includes(query)) return false;
          return true;
        })
        .map((r) => ({
          request: r,
          order: r.order + 1,
          method: r.method,
          host: extractDomain(r.rawUrl) || "(sin host)",
          url: pathWithQuery(r.rawUrl) || r.rawUrl || r.path,
          status: r.statusCode,
          type: resourceType(r),
          size: formatBytes(r.responseSize),
          time: formatTime(r.responseTime),
        }));
      return { file: file, rows };
    });
  }, [harFiles, search, onlyApi, selectedDomains]);

  const totalRequests = groupedRows.reduce((acc, g) => acc + g.file.requests.length, 0);

  // Búsqueda avanzada a través de todos los HAR cargados.
  const searchResults = useMemo(() => {
    if (!activeSearch || harFiles.length === 0) return new Map<string, Map<number, SearchHit[]>>();
    const all = new Map<string, Map<number, SearchHit[]>>();
    for (const file of harFiles) {
      const hits = runSearch(file.requests, activeSearch, {
        scopeRequest,
        scopeResponse,
        fieldHeaders,
        fieldBody,
      });
      if (hits.size > 0) all.set(file.fileName, hits);
    }
    return all;
  }, [harFiles, activeSearch, scopeRequest, scopeResponse, fieldHeaders, fieldBody]);

  const totalSearchHits = useMemo(
    () => [...searchResults.values()].reduce((acc, m) => acc + m.size, 0),
    [searchResults]
  );

  const handleFiles = async (files: FileList): Promise<void> => {
    const parsedFiles: ParsedFile[] = [];
    for (const file of Array.from(files)) {
      try {
        const text = await file.text();
        const parsed = parseHar(text, file.name);
        if (parsed.requests.length === 0) {
          logWarn("visor", `No se encontraron requests HTTP en "${file.name}".`);
          continue;
        }
        logInfo("visor", `"${file.name}" cargado: ${parsed.requests.length} requests.`);
        parsedFiles.push(parsed);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logError("visor", `Error al cargar "${file.name}"`, message);
      }
    }
    if (parsedFiles.length === 0) return;
    // Acumula: conserva los ya cargados y agrega los nuevos (sin duplicar por nombre).
    const existing = new Set(harFiles.map((f) => f.fileName));
    const merged = [...harFiles, ...parsedFiles.filter((f) => !existing.has(f.fileName))];
    setSelected(null);
    setActiveSearch(null);
    onFilesChange(merged);
    // El último archivo cargado queda como activo (compartido con la comparación).
    onSelectFile(parsedFiles[parsedFiles.length - 1]);
  };

  const executeSearch = (): void => {
    const term = searchText.trim();
    if (!term) return;
    setActiveSearch(term);
    setSearchOpen(false);
    logInfo("visor", `Búsqueda "${term}": ${totalSearchHits} request(s) con coincidencias en ${searchResults.size} archivo(s).`);
  };

  const clearSearch = (): void => {
    setActiveSearch(null);
    setSearchText("");
    setSearchOpen(false);
  };

  /** Abre el detalle del request y hace scroll hasta su fila en la tabla. */
  const goToRequest = (fileName: string, order: number): void => {
    const file = harFiles.find((f) => f.fileName === fileName);
    if (!file) return;
    const req = file.requests.find((r) => r.order === order);
    if (!req) return;
    setSelected(req);
    // Espera al siguiente frame para que la fila (y el detalle) ya estén en el DOM.
    requestAnimationFrame(() => {
      const row = document.querySelector(`[data-request-row="${CSS.escape(`${fileName}#${order}`)}"]`);
      row?.scrollIntoView({ behavior: "smooth", block: "center" });
      // Destello breve para localizar la fila visualmente.
      row?.classList.add("row-flash");
      setTimeout(() => row?.classList.remove("row-flash"), 1600);
    });
  };

  return (
    <section className="har-viewer">
      <div className="results-header">
        <h2>{t("Visor HAR")}</h2>
        <p className="results-sub">
          {harFiles.length > 0
            ? <>{harFiles.length} {t("archivo(s) HAR —")} {totalRequests} {t("requests en total")}{harFile ? <> · {t("activo:")} <strong>{harFile.fileName}</strong></> : null}</>
            : t("Carga uno o varios archivos .har para inspeccionar sus requests en orden")}
        </p>
        <div className="filters">
          <input
            type="search"
            className="search-input"
            placeholder={t("Buscar método o URL…")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button className={onlyApi ? "active" : ""} onClick={() => setOnlyApi((v) => !v)}>
            🚫 {t("Sin assets")}
          </button>
          <button
            className={domainsOpen || selectedDomains.size > 0 ? "active" : ""}
            onClick={() => setDomainsOpen((v) => !v)}
            disabled={harFiles.length === 0}
          >
            🌐 {t("Dominios")}{selectedDomains.size > 0 ? `: ${selectedDomains.size}` : ""}
          </button>
          <button
            className={searchOpen || activeSearch ? "active" : ""}
            onClick={() => setSearchOpen((v) => !v)}
            disabled={harFiles.length === 0}
          >
            🔍 {t("Buscar en contenido")}{activeSearch ? `: "${activeSearch}"` : ""}
          </button>
          <label className="viewer-file-label">
            <input
              ref={inputRef}
              type="file"
              accept=".har,.json"
              multiple
              style={{ display: "none" }}
              onChange={(e) => {
                if (e.target.files && e.target.files.length > 0) void handleFiles(e.target.files);
                e.target.value = "";
              }}
            />
            📂 {t("Cargar HAR")}
          </label>
          {harFiles.length > 0 && (
            <button onClick={() => { onFilesChange([]); setSelected(null); setActiveSearch(null); }}>
              🗑 {t("Quitar todos")}
            </button>
          )}
        </div>
      </div>

      {domainsOpen && harFiles.length > 0 && (
        <div className="search-dialog domains-dialog">
          <h4>{t("Filtrar por dominio")}</h4>
          {availableDomains.length === 0 ? (
            <p className="detail-empty">{t("No se detectaron dominios en los HAR cargados.")}</p>
          ) : (
            <>
              <div className="domain-list">
                {availableDomains.map(([domain, count]) => (
                  <label key={domain} className="domain-option">
                    <input
                      type="checkbox"
                      checked={selectedDomains.has(domain)}
                      onChange={(e) => {
                        setSelectedDomains((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(domain);
                          else next.delete(domain);
                          return next;
                        });
                      }}
                    />
                    <span className="domain-name">{domain}</span>
                    <span className="domain-count">{count} req</span>
                  </label>
                ))}
              </div>
              <div className="search-option-group">
                <button
                  onClick={() => setSelectedDomains(new Set(availableDomains.map(([d]) => d)))}
                >
                  {t("Todos")}
                </button>
                <button onClick={() => setSelectedDomains(new Set())}>{t("Ninguno")}</button>
                <span className="search-option-label">
                  {selectedDomains.size === 0
                    ? t("Mostrando todos los dominios")
                    : `${t("Mostrando")} ${selectedDomains.size} ${t("dominio(s)")}`}
                </span>
              </div>
            </>
          )}
        </div>
      )}

      {searchOpen && harFiles.length > 0 && (
        <div className="search-dialog">
          <h4>{t("Opciones de búsqueda")}</h4>
          <div className="search-option-group">
            <span className="search-option-label">{t("1. Buscar en:")}</span>
            <label><input type="checkbox" checked={scopeRequest} onChange={(e) => setScopeRequest(e.target.checked)} /> {t("Request")}</label>
            <label><input type="checkbox" checked={scopeResponse} onChange={(e) => setScopeResponse(e.target.checked)} /> {t("Response")}</label>
          </div>
          <div className="search-option-group">
            <span className="search-option-label">{t("2. Campo:")}</span>
            <label><input type="checkbox" checked={fieldHeaders} onChange={(e) => setFieldHeaders(e.target.checked)} /> {t("Headers")}</label>
            <label><input type="checkbox" checked={fieldBody} onChange={(e) => setFieldBody(e.target.checked)} /> {t("Body")}</label>
          </div>
          <div className="search-option-group">
            <input
              type="search"
              className="search-input"
              placeholder={t("Texto a buscar…")}
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") executeSearch();
              }}
            />
            <button className="active" onClick={executeSearch}>{t("Buscar")}</button>
            <button onClick={clearSearch}>{t("Limpiar")}</button>
          </div>
        </div>
      )}

      {harFiles.length > 0 ? (
        <>
          {groupedRows.map(({ file, rows }) => (
            <div key={file.fileName} className="viewer-file-group">
              <div className="viewer-file-header">
                <h3
                  className={harFile?.fileName === file.fileName ? "active" : ""}
                  title={t("Marcar como HAR activo (se comparte con la comparación)")}
                  onClick={() => onSelectFile(harFile?.fileName === file.fileName ? null : file)}
                >
                  {harFile?.fileName === file.fileName ? "★ " : "☆ "}
                  {file.fileName}
                </h3>
                <span className="viewer-file-count">
                  {file.requests.length} {t("requests")} · {rows.length} {t("visibles")}
                </span>
                <button
                  className="options-toggle"
                  onClick={() => {
                    const rest = harFiles.filter((f) => f.fileName !== file.fileName);
                    onFilesChange(rest);
                    if (harFile?.fileName === file.fileName) onSelectFile(rest[rest.length - 1] ?? null);
                    if (selected && !rest.some((f) => f.requests.includes(selected))) setSelected(null);
                  }}
                >
                  ✕ {t("Quitar")}
                </button>
              </div>
              <table className="results-table viewer-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>{t("Estado")}</th>
                    <th>{t("Método")}</th>
                    <th>{t("Host")}</th>
                    <th>{t("URL")}</th>
                    <th>{t("Tipo")}</th>
                    <th>{t("Tamaño")}</th>
                    <th>{t("Tiempo")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={7} className="detail-empty">{t("Sin requests que coincidan con el filtro.")}</td>
                    </tr>
                  )}
                  {rows.map((row) => (
                    <Fragment key={`${file.fileName}-${row.order}`}>
                      <tr
                        data-request-row={`${file.fileName}#${row.request.order}`}
                        className={[
                          selected?.order === row.request.order ? "selected-row" : "",
                          searchResults.get(file.fileName)?.has(row.request.order) ? "has-match" : "",
                        ].join(" ").trim() || undefined}
                        onClick={() => setSelected((prev) => (prev?.order === row.request.order ? null : row.request))}
                      >
                        <td>{row.order}{searchResults.get(file.fileName)?.has(row.request.order) ? " 🔍" : ""}</td>
                        <td>
                          {row.status ? (
                            <span className={`status-code status-${Math.floor(row.status / 100)}xx`}>{row.status}</span>
                          ) : (
                            <span className="status-code status-none">—</span>
                          )}
                        </td>
                        <td>{row.method}</td>
                        <td className="host-cell">{row.host}</td>
                        <td className="path-cell">{row.url}</td>
                        <td>{row.type}</td>
                        <td>{row.size}</td>
                        <td>{row.time}</td>
                      </tr>
                      {selected?.order === row.request.order && (
                        <tr className="detail-row">
                          <td colSpan={7}>
                            <RequestDetail
                              request={selected}
                              highlight={activeSearch ?? undefined}
                              onClose={() => setSelected(null)}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          ))}

          {activeSearch && (
            <section className="search-results">
              <h3>
                {t("Resultados de")} "{activeSearch}" — {totalSearchHits} {t("request(s) con coincidencias en")} {searchResults.size} {t("archivo(s)")}
                <button className="options-toggle" onClick={() => setActiveSearch(null)}>✕ {t("Cerrar")}</button>
              </h3>
              {searchResults.size === 0 && (
                <p className="detail-empty">{t("Sin coincidencias con las opciones seleccionadas.")}</p>
              )}
              {[...searchResults.entries()].map(([fileName, hits]) => {
                const file = harFiles.find((f) => f.fileName === fileName);
                if (!file) return null;
                return (
                  <div key={fileName} className="search-result-file">
                    <h4 className="search-result-file-name">📄 {fileName} — {hits.size} request(s)</h4>
                    {[...hits.entries()].map(([order, hitList]) => (
                      <div
                        key={order}
                        className="search-result-item"
                        onClick={() => goToRequest(fileName, order)}
                      >
                        <span className="search-result-order">#{order + 1}</span>
                        <span className="search-result-url">
                          {(() => {
                            const r = file.requests.find((x) => x.order === order);
                            return r ? `${r.method} ${r.rawUrl ?? r.path}` : "";
                          })()}
                        </span>
                        <ul className="search-hit-list">
                          {hitList.map((hit, i) => (
                            <li key={i}>
                              <span className="search-hit-scope">
                                {hit.side === "request" ? "Request" : "Response"} · {hit.field === "header" ? `header ${hit.headerName}` : "body"}:
                              </span>{" "}
                              <Highlight text={hit.snippet} term={activeSearch} />
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                );
              })}
            </section>
          )}
        </>
      ) : (
        <div className="drop-zone viewer-drop" onClick={() => inputRef.current?.click()}>
          <div className="drop-icon">📄</div>
          <div className="drop-title">{t("Arrastra uno o varios HAR aquí o haz clic para seleccionar")}</div>
        </div>
      )}
    </section>
  );
}
