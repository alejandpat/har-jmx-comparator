import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

/** Idiomas soportados por la aplicación. */
export type Lang = "es" | "en";

const STORAGE_KEY = "har-jmx-comparator.lang";

/** Diccionario español → inglés. Si un texto no está, se muestra en español. */
const EN: Record<string, string> = {
  // Header / pestañas
  "Comparador JMX ↔ HAR": "JMX ↔ HAR Comparator",
  "Compara un plan de pruebas de JMeter (.jmx) contra una captura HAR":
    "Compare a JMeter test plan (.jmx) against a HAR capture",
  "⚖️ Comparar": "⚖️ Compare",
  "👁️ Visor HAR": "👁️ HAR Viewer",
  "ℹ️ Acerca de": "ℹ️ About",
  "JMX ↔ HAR": "JMX ↔ HAR",
  "JMX vs JMX": "JMX vs JMX",
  "HAR vs HAR": "HAR vs HAR",
  "⚙️ Configuración": "⚙️ Settings",

  // About
  "¿Qué puede hacer esta aplicación?": "What can this application do?",  "Comparar JMX ↔ HAR:": "Compare JMX ↔ HAR:",
  "cruza un plan de pruebas de JMeter (.jmx) contra una captura HAR (o viceversa) y reporta requests nuevos, eliminados y modificados, con diff de query params, headers y bodies.":
    "cross-checks a JMeter test plan (.jmx) against a HAR capture (or vice versa) and reports new, removed and modified requests, with query params, headers and bodies diff.",
  "Comparar JMX vs JMX / HAR vs HAR:": "Compare JMX vs JMX / HAR vs HAR:",
  "compara dos archivos del mismo tipo para detectar diferencias entre versiones de un script o entre dos capturas.":
    "compares two files of the same type to detect differences between script versions or between two captures.",
  "Comparación por secciones:": "Section comparison:",
  "empareja cada HAR con la transacción del JMX (controladores con prefijo, ej. ITL_*, NAV_*) por similitud de nombre.":
    "pairs each HAR with the JMX transaction (prefixed controllers, e.g. ITL_*, NAV_*) by name similarity.",
  "Visor HAR:": "HAR viewer:",
  "explora una o varias capturas HAR request por request, con sus headers, params y bodies.":
    "explore one or several HAR captures request by request, with their headers, params and bodies.",
  "Filtros y opciones:": "Filters and options:",
  "filtrar/excluir URLs, elegir dominios, excluir assets del front, ignorar variables de JMeter, headers y params volátiles, y comparar bodies JSON semánticamente.":
    "filter/exclude URLs, choose domains, exclude front-end assets, ignore JMeter variables, volatile headers and params, and compare JSON bodies semantically.",
  "Exportar e importar:": "Export and import:",
  "descarga el reporte en CSV o TXT y vuelve a cargar un reporte previo para revisarlo sin re-comparar.":
    "download the report as CSV or TXT and reload a previous report to review it without re-comparing.",
  "Extras:": "Extras:",
  "copia requests como cURL, globito con resumen de diferencias por fila, paths y params decodificados, y log de errores exportable.":
    "copy requests as cURL, tooltip with per-row diff summary, decoded paths and params, and exportable error log.",
  "Todo se procesa localmente en tu navegador: ningún archivo sale de tu equipo.":
    "Everything is processed locally in your browser: no file ever leaves your computer.",

  // Configuración
  "Configuración": "Settings",
  "Idioma de la aplicación": "Application language",
  "Español": "Spanish",
  "Inglés": "English",
  "El idioma se guarda en tu navegador y se aplica al recargar. Algunas secciones pueden seguir en español.":
    "The language is stored in your browser and applied after reloading. Some sections may remain in Spanish.",

  // FileDrop
  "Archivo JMX (JMeter)": "JMX file (JMeter)",
  "Archivo(s) HAR": "HAR file(s)",
  "JMX base (flujo esperado)": "Base JMX (expected flow)",
  "JMX a comparar": "JMX to compare",
  "HAR base (flujo esperado)": "Base HAR (expected flow)",
  "HAR a comparar": "HAR to compare",
  "Arrastra un archivo aquí o haz clic para seleccionarlo": "Drag a file here or click to select it",
  "Arrastra archivos aquí o haz clic para seleccionarlos": "Drag files here or click to select them",

  "📬 Contact me": "📬 Contact me",
  "¿Dudas, sugerencias o bugs? Escríbeme:": "Questions, suggestions or bugs? Write to me:",
  "¿Dudas, sugerencias o bugs? Abre un issue en GitHub:": "Questions, suggestions or bugs? Open an issue on GitHub:",
  "Reportar en GitHub Issues": "Report on GitHub Issues",

  // Visor HAR
  "Visor HAR": "HAR Viewer",
  "archivo(s) HAR —": "HAR file(s) —",
  "requests en total": "requests in total",
  "activo:": "active:",
  "Carga uno o varios archivos .har para inspeccionar sus requests en orden":
    "Load one or more .har files to inspect their requests in order",
  "Buscar método o URL…": "Search method or URL…",
  "Sin assets": "No assets",
  "Dominios": "Domains",
  "Buscar en contenido": "Search in content",
  "Cargar HAR": "Load HAR",
  "Quitar todos": "Remove all",
  "Filtrar por dominio": "Filter by domain",
  "No se detectaron dominios en los HAR cargados.": "No domains detected in the loaded HARs.",
  "Ninguno": "None",
  "Mostrando todos los dominios": "Showing all domains",
  "Mostrando": "Showing",
  "dominio(s)": "domain(s)",
  "Opciones de búsqueda": "Search options",
  "1. Buscar en:": "1. Search in:",
  "2. Campo:": "2. Field:",
  "Texto a buscar…": "Text to search for…",
  "Buscar": "Search",
  "Limpiar": "Clear",
  "Marcar como HAR activo (se comparte con la comparación)": "Set as active HAR (shared with the comparison)",
  "requests": "requests",
  "visibles": "visible",
  "Quitar": "Remove",
  "Host": "Host",
  "URL": "URL",
  "Tamaño": "Size",
  "Tiempo": "Time",
  "Sin requests que coincidan con el filtro.": "No requests match the filter.",
  "Resultados de": "Results for",
  "request(s) con coincidencias en": "request(s) with matches in",
  "archivo(s)": "file(s)",
  "Cerrar": "Close",
  "Sin coincidencias con las opciones seleccionadas.": "No matches with the selected options.",
  "params": "params",
  "no capturado": "not captured",
  "No capturado en el HAR.": "Not captured in the HAR.",

  // Comparación principal
  "Archivo base (flujo esperado):": "Base file (expected flow):",
  "⚙️ Opciones de comparación": "⚙️ Comparison options",
  "📂 Cargar reporte (CSV/TXT)": "📂 Load report (CSV/TXT)",
  "Ignorar variables de JMeter": "Ignore JMeter variables",
  "Comparar bodies JSON semánticamente (ignora formato y orden de claves)":
    "Compare JSON bodies semantically (ignores formatting and key order)",
  "Excluir assets del front (js, css, imágenes, fuentes, media)":
    "Exclude front-end assets (js, css, images, fonts, media)",
  "🔍 Comparación completa JMX vs HAR": "🔍 Full JMX vs HAR comparison",
  "Prefijo de transacción (vacío = automático, ej. \"ITL_\", \"NAV_\"):": "Transaction prefix (empty = automatic, e.g. \"ITL_\", \"NAV_\"):",
  "Automático": "Automatic",
  "Headers a ignorar (separados por coma):": "Headers to ignore (comma-separated):",
  "Query params volátiles a ignorar (separados por coma):": "Volatile query params to ignore (comma-separated):",
  "Filtro de URLs del HAR (solo se comparan requests cuya URL contiene alguno de estos textos, separados por coma):":
    "HAR URL filter (only requests whose URL contains any of these texts are compared, comma-separated):",
  "Ej. __remoteService, /Resource.svc (vacío = comparar todo)": "e.g. __remoteService, /Resource.svc (empty = compare all)",
  "Excluir URLs del HAR que contengan (separados por coma):": "Exclude HAR URLs containing (comma-separated):",
  "Ej. favicon, analytics, /assets/ (vacío = no excluir nada)": "e.g. favicon, analytics, /assets/ (empty = exclude nothing)",

  // Avisos de secciones
  "No hay comparación por secciones.": "No section comparison.",
  "La tabla por secciones empareja cada archivo HAR con una transacción del JMX (controladores con prefijo, ej. ITL_*, NAV_*) por similitud de nombre. Tu HAR no coincide con ninguna transacción del script, así que se omite.":
    "The section table pairs each HAR file with a JMX transaction (prefixed controllers, e.g. ITL_*, NAV_*) by name similarity. Your HAR does not match any script transaction, so it is skipped.",
  "Causas habituales: (1) cargaste un HAR completo de la sesión en lugar de un HAR por transacción (ej. _Login_Page.har); (2) el prefijo de transacción detectado no corresponde — ajústalo en Opciones de comparación → Prefijo de transacción.":
    "Common causes: (1) you loaded a full session HAR instead of a per-transaction HAR (e.g. _Login_Page.har); (2) the detected transaction prefix is wrong — adjust it in Comparison options → Transaction prefix.",
  "Los resultados completos están en «Comparación completa JMX vs HAR» más abajo.":
    "Full results are in \"Full JMX vs HAR comparison\" below.",

  // Results
  "Resultados de la comparación": "Comparison results",
  "Base:": "Base:",
  "Comparado:": "Compared:",
  "Base": "Base",
  "Comparado": "Compared",
  "Archivo:": "File:",
  "Reporte cargado": "Loaded report",
  "Cerrar reporte": "Close report",
  "Buscar método o path…": "Search method or path…",
  "Todos": "All",
  "Nuevos": "New",
  "Eliminados": "Removed",
  "Modificados": "Modified",
  "Igual": "Same",
  "▲ Colapsar todo": "▲ Collapse all",
  "▼ Expandir todo": "▼ Expand all",
  "Exportar CSV": "Export CSV",
  "Exportar TXT": "Export TXT",
  "Exportar CSV consolidado": "Export consolidated CSV",
  "Estado": "Status",
  "Método": "Method",
  "Path": "Path",
  "Cambios": "Changes",
  "Código": "Code",
  "Detalle": "Detail",
  "Nuevo": "New",
  "Eliminado": "Removed",
  "Modificado": "Modified",
  "en headers": "in headers",
  "en parámetros": "in params",
  "en body": "in body",
  "Diferencias:": "Differences:",
  "Sin diferencias": "No differences",
  "▼ Ver detalle": "▼ View detail",
  "▲ Ocultar": "▲ Hide",
  "Solo en la base": "Only in base",
  "Solo en el comparado": "Only in compared",
  "Sampler:": "Sampler:",
  "Request #": "Request #",
  "del HAR": "of the HAR",
  "headers": "headers",
  "caracteres": "characters",
  "sin body": "no body",
  "Query params": "Query params",
  "Sin query params": "No query params",
  "Sin headers": "No headers",
  "Sin body": "No body",
  "Body": "Body",
  "Resumen de diferencias": "Differences summary",
  "Tipo": "Type",
  "Nombre": "Name",
  "Diferencia": "Difference",
  "Por qué difiere:": "Why it differs:",
  "Sin controlador padre": "No parent controller",
  "Query param": "Query param",
  "Header": "Header",
  "Copiar cURL de este request": "Copy this request's cURL",
  "✅ Copiado": "✅ Copied",

  // Secciones
  "Comparación por secciones (JMX vs múltiples HAR)": "Section comparison (JMX vs multiple HARs)",
  "HAR(s) asignados por nombre a su transacción": "HAR(s) assigned by name to their transaction",
  "🟡 Solo con diferencias": "🟡 Only with differences",
  "⚪ Todas las secciones": "⚪ All sections",
  "Transacción JMX": "JMX transaction",
  "HAR asignado": "Assigned HAR",
  "Mod.": "Mod.",

  // Log
  "Log de errores y eventos": "Error and event log",
  "⬇ Descargar": "⬇ Download",
  "🗑 Limpiar": "🗑 Clear",
  "Sin entradas todavía.": "No entries yet.",

  // FileDrop
  "Ningún archivo pudo parsearse.": "No file could be parsed.",
  "Arrastra uno o varios HAR aquí o haz clic para seleccionar": "Drag one or more HARs here or click to select",
  "Arrastra el archivo aquí o haz clic para seleccionar": "Drag the file here or click to select",

  // Comparación por secciones / dominios (App.tsx)
  "JMX:": "JMX: ",
  "Comparando todos los dominios": "Comparing all domains",
  "Comparando X dominio(s)": "Comparing X domain(s)",
};

interface LangContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  /** Traduce un texto: devuelve la traducción al inglés si lang === "en", o el texto original. */
  t: (text: string) => string;
}

const LangContext = createContext<LangContextValue | null>(null);

function readInitialLang(): Lang {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "en" || stored === "es") return stored;
  } catch {
    // localStorage puede no estar disponible (modo privado); se usa el valor por defecto.
  }
  return "en";
}

/** Proveedor de idioma: guarda la preferencia en localStorage y expone t(). */
export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(readInitialLang);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Sin persistencia disponible; el idioma se mantiene solo en esta sesión.
    }
  }, []);

  const t = useCallback(
    (text: string) => (lang === "en" ? (EN[text] ?? text) : text),
    [lang]
  );

  return <LangContext.Provider value={{ lang, setLang, t }}>{children}</LangContext.Provider>;
}

/** Hook de acceso al idioma y la función de traducción. */
export function useLang(): LangContextValue {
  const ctx = useContext(LangContext);
  if (!ctx) throw new Error("useLang debe usarse dentro de LangProvider");
  return ctx;
}

/**
 * Traduce las líneas del resumen semántico de diferencias generado por
 * diffEngine.ts (que no tiene acceso al contexto de idioma). Aplica patrones
 * sobre las líneas dinámicas; los valores entre comillas se conservan tal cual.
 */
export function translateSummary(text: string, lang: Lang): string {
  if (lang !== "en") return text;
  return text
    .split("\n")
    .map((line) => {
      let s = line;
      // "array con N items (HAR: M) — items comunes idénticos"
      s = s.replace(
        /^array con (\d+) items \(HAR: (\d+)\) — items comunes idénticos$/,
        "array with $1 items (HAR: $2) — common items identical"
      );
      // "añadido <valor>"
      s = s.replace(/^añadido /, "added ");
      // "eliminado (antes: <valor>)"
      s = s.replace(/^eliminado \(antes: (.*)\)$/, "removed (was: $1)");
      // "array de N elemento(s)" (también anidado en "eliminado (antes: …)")
      s = s.replace(/array de (\d+) elementos?/g, (_m, n) => `array of ${n} item${n === "1" ? "" : "s"}`);
      // "objeto con N clave(s)" / "objeto vacío" (también anidados)
      s = s.replace(/objeto con (\d+) claves?/g, (_m, n) => `object with ${n} key${n === "1" ? "" : "s"}`);
      s = s.replace(/objeto vacío/g, "empty object");
      // "… y más diferencias (ver body completo)"
      s = s.replace(/^… y más diferencias \(ver body completo\)$/, "… and more differences (see full body)");
      return s;
    })
    .join("\n");
}
