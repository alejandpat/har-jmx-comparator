/** Representación normalizada de un request HTTP, común a JMX y HAR. */
export interface HttpHeader {
  name: string;
  value: string;
}

export interface QueryParam {
  name: string;
  value: string;
}

export interface HttpRequest {
  /** Método HTTP en mayúsculas (GET, POST, ...). */
  method: string;
  /** Path/URL sin query string, normalizada (sin host, sin query). */
  path: string;
  /** URL cruda original (con host y query, si el formato la trae; undefined en JMX sin host). */
  rawUrl?: string;
  /** Query params parseados. */
  query: QueryParam[];
  /** Headers como lista (puede haber duplicados). */
  headers: HttpHeader[];
  /** Cuerpo de la petición (string vacío si no hay). */
  body: string;
  /** Origen del request, para trazabilidad. */
  source: "jmx" | "har";
  /** Índice/orden dentro del archivo original. */
  order: number;
  /** Nombre del sampler en JMX (testname) o resourceType en HAR. */
  label: string;
  /** Cadena de controladores padres en JMX (ej. "Grupo de hilos > Controlador transacción"). */
  parentPath: string;
  /** Código de estado HTTP de la respuesta (solo HAR; undefined en JMX). */
  statusCode?: number;
  /** Tamaño del body de la respuesta en bytes (solo HAR). */
  responseSize?: number;
  /** Duración total de la respuesta en milisegundos (solo HAR). */
  responseTime?: number;
  /** Headers de la respuesta (solo HAR). */
  responseHeaders?: HttpHeader[];
  /** Body de la respuesta (solo HAR; string vacío si no hay o no fue capturado). */
  responseBody?: string;
  /** MIME type del body de la respuesta (solo HAR). */
  responseMimeType?: string;
  /** Path destino si la respuesta fue una redirección (header Location normalizado). */
  redirectTo?: string;
  /** JMeter: "Follow Redirects" activado (true = comportamiento por defecto de JMeter). */
  followRedirects?: boolean;
}

export type DiffKind = "new" | "removed" | "modified" | "same";

export type FieldKind = "query" | "header" | "body";

export interface FieldDiff {
  kind: FieldKind;
  /** Nombre del param/header; para body es "body". */
  name: string;
  before: string;
  after: string;
  /** Resumen semántico de las diferencias (rutas de claves que cambian); solo para bodies JSON grandes. */
  summary?: string;
}

export interface RequestDiff {
  kind: DiffKind;
  /** Request en la base (undefined si kind === "har"). */
  base?: RequestEntry;
  /** Request en el comparado (undefined si kind === "removed"). */
  compare?: RequestEntry;
  /** Detalle de cambios cuando kind === "modified". */
  changes: FieldDiff[];
}

export interface RequestEntry {
  request: HttpRequest;
  /** Etiqueta del sampler en JMX o _resourceType en HAR. */
  label: string;
}

export interface ComparisonResult {
  /** Requests en la base pero no en el comparado. */
  removed: RequestEntry[];
  /** Requests en el comparado pero no en la base. */
  added: RequestEntry[];
  /** Requests presentes en ambos, con o sin cambios. */
  matched: RequestDiff[];
  /** Total de requests parseados en cada lado. */
  totalBase: number;
  totalCompare: number;
  /** Redirecciones (3xx) del comparado omitidas como "nuevos" para evitar falsos positivos. */
  redirectsSkipped: number;
  /** Redirecciones (3xx) del comparado omitidas como nuevos, listadas para transparencia. */
  redirects: RequestEntry[];
}

export interface ParsedFile {
  /** "jmx" | "har" */
  kind: "jmx" | "har";
  /** Nombre del archivo cargado. */
  fileName: string;
  /** Contenido parseado. */
  requests: HttpRequest[];
  /** Metadatos adicionales (ej. hostname en JMX, creator en HAR). */
  meta: Record<string, string>;
}
