import { useEffect, useMemo, useRef, useState } from "react";
import type { ParsedFile } from "./types";
import { FileDrop } from "./components/FileDrop";
import { ResultsView } from "./components/Results";
import { SectionResultsView } from "./components/SectionResults";
import { HarViewer } from "./components/HarViewer";
import { LoadedReportView, parseReport, type LoadedReportData } from "./components/LoadedReport";
import { LogPanel } from "./components/LogWidget";
import { compareFiles } from "./diffEngine";
import { compareBySections, detectTransactionPrefix } from "./sectionCompare";
import { DEFAULT_OPTIONS, type CompareOptions } from "./normalize";
import { extractDomain, filterParsedFile, parseFilterInput } from "./urlFilter";
import { logError, logInfo } from "./logger";
import { useLang } from "./i18n";
import "./App.css";

type BaseKind = "jmx" | "har";
type TabKind = "compare" | "viewer" | "settings";
type CompareTabKind = "jmx-har" | "jmx-jmx" | "har-har";

export default function App() {
  const [jmxFile, setJmxFile] = useState<ParsedFile | null>(null);
  const [harFile, setHarFile] = useState<ParsedFile | null>(null);
  const [harFiles, setHarFiles] = useState<ParsedFile[]>([]);
  // Archivos para las comparaciones del mismo tipo (JMX vs JMX y HAR vs HAR).
  const [jmxFileA, setJmxFileA] = useState<ParsedFile | null>(null);
  const [jmxFileB, setJmxFileB] = useState<ParsedFile | null>(null);
  const [harFileA, setHarFileA] = useState<ParsedFile | null>(null);
  const [harFileB, setHarFileB] = useState<ParsedFile | null>(null);
  const [baseKind, setBaseKind] = useState<BaseKind>("jmx");
  const [options, setOptions] = useState<CompareOptions>(DEFAULT_OPTIONS);
  const [showOptions, setShowOptions] = useState(false);
  // Prefijo de transacción: "" = automático; si no, override manual (ej. "NAV_").
  const [manualPrefix, setManualPrefix] = useState<string>("");
  const [loadedReport, setLoadedReport] = useState<LoadedReportData | null>(null);
  const reportInputRef = useRef<HTMLInputElement>(null);
  // Detalle completo JMX vs HAR: oculto por defecto (la tabla por secciones es el resumen).
  const [showFullCompare, setShowFullCompare] = useState(false);
  // Filtro de URLs del HAR: solo se comparan requests cuyo método+URL contiene
  // alguno de estos patrones (subcadena, case-insensitive, separados por coma).
  const [urlFilterText, setUrlFilterText] = useState("");
  // Exclusión de URLs del HAR (subcadenas a descartar, separadas por coma).
  const [urlExcludeText, setUrlExcludeText] = useState("");
  // Excluir assets estáticos del front (js, css, imágenes, fuentes).
  const [excludeAssets, setExcludeAssets] = useState(false);
  // Filtro por dominios del HAR: vacío = comparar todos los dominios.
  const [selectedDomains, setSelectedDomains] = useState<Set<string>>(new Set());
  const [domainsOpen, setDomainsOpen] = useState(false);
  // Pestaña activa: comparación o visor HAR.
  const [activeTab, setActiveTab] = useState<TabKind>("compare");
  // Sub-pestaña dentro de "Comparar": JMX vs HAR, JMX vs JMX o HAR vs HAR.
  const [compareTab, setCompareTab] = useState<CompareTabKind>("jmx-har");
  // Panel "Acerca de" visible.
  const [aboutOpen, setAboutOpen] = useState(false);
  const { t, lang, setLang } = useLang();
  
  const handleReportFile = async (file: File): Promise<void> => {
    try {
      const content = await file.text();
      const data = parseReport(content, file.name);
      setLoadedReport(data);
      logInfo("reporte", `Reporte cargado: "${file.name}" (${data.requests.length} requests).`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logError("reporte", `Error al cargar el reporte "${file.name}"`, message);
      alert(message);
    }
  };

  // Dominios disponibles en los HAR cargados, ordenados por cantidad de requests.
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

  // Limpia la selección de dominios que ya no existen (ej. al cambiar de HAR).
  useEffect(() => {
    setSelectedDomains((prev) => {
      const valid = new Set(availableDomains.map(([d]) => d));
      const next = new Set([...prev].filter((d) => valid.has(d)));
      return next.size === prev.size ? prev : next;
    });
  }, [availableDomains]);

  // HARs filtrados por el filtro de URLs y dominios (se recalcula al editar el
  // filtro, sin necesidad de volver a cargar los archivos).
  const filteredHarFiles = useMemo(
    () =>
      harFiles.map((f) =>
        filterParsedFile(f, parseFilterInput(urlFilterText), parseFilterInput(urlExcludeText), excludeAssets, selectedDomains)
      ),
    [harFiles, urlFilterText, urlExcludeText, excludeAssets, selectedDomains]
  );
  const filteredHarFile = useMemo(
    () => (harFile ? filterParsedFile(harFile, parseFilterInput(urlFilterText), parseFilterInput(urlExcludeText), excludeAssets, selectedDomains) : null),
    [harFile, urlFilterText, urlExcludeText, excludeAssets, selectedDomains]
  );

  const result = useMemo(() => {
    if (!jmxFile || !filteredHarFile) return null;
    const base = baseKind === "jmx" ? jmxFile : filteredHarFile;
    const compare = baseKind === "jmx" ? filteredHarFile : jmxFile;
    try {
      return compareFiles(base, compare, options);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logError("comparación", "Error durante la comparación", err instanceof Error ? err.stack : message);
      return null;
    }
  }, [jmxFile, filteredHarFile, baseKind, options]);

  // Comparación JMX vs JMX.
  const jmxJmxResult = useMemo(() => {
    if (!jmxFileA || !jmxFileB) return null;
    try {
      return compareFiles(jmxFileA, jmxFileB, options);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logError("jmx-jmx", "Error durante la comparación JMX vs JMX", err instanceof Error ? err.stack : message);
      return null;
    }
  }, [jmxFileA, jmxFileB, options]);

  // Comparación HAR vs HAR (usa el filtro de URLs/dominios compartido).
  const harHarResult = useMemo(() => {
    if (!harFileA || !harFileB) return null;
    const filter = (f: ParsedFile): ParsedFile =>
      filterParsedFile(f, parseFilterInput(urlFilterText), parseFilterInput(urlExcludeText), excludeAssets, selectedDomains);
    try {
      return compareFiles(filter(harFileA), filter(harFileB), options);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logError("har-har", "Error durante la comparación HAR vs HAR", err instanceof Error ? err.stack : message);
      return null;
    }
  }, [harFileA, harFileB, urlFilterText, urlExcludeText, excludeAssets, selectedDomains, options]);

  // El log de comparación va en un useEffect (no en el useMemo) para que
  // StrictMode no lo ejecute dos veces en desarrollo.
  useEffect(() => {
    if (!result) return;
    logInfo(
      "comparación",
      `Comparación completada: ${result.added.length} nuevos, ${result.removed.length} eliminados, ` +
        `${result.matched.filter((d) => d.kind === "modified").length} modificados.` +
        (result.redirectsSkipped > 0
          ? ` ${result.redirectsSkipped} redirecciones (3xx) del HAR omitidas como nuevos.`
          : "")
    );
  }, [result]);

  // Captura errores globales de runtime (promesas rechazadas y errores no manejados).
  useEffect(() => {
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      logError("runtime", "Promesa rechazada no manejada", String(event.reason));
    };
    const onError = (event: ErrorEvent) => {
      logError("runtime", event.message, event.error?.stack);
    };
    window.addEventListener("unhandledrejection", onUnhandledRejection);
    window.addEventListener("error", onError);
    return () => {
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
      window.removeEventListener("error", onError);
    };
  }, []);

  const canCompare = jmxFile !== null && harFile !== null;

  // Comparación por secciones: activa cuando hay JMX y al menos 2 HARs cargados.
  const sectionResult = useMemo(() => {
    if (!jmxFile || filteredHarFiles.length === 0) return null;
    try {
      return compareBySections(jmxFile, filteredHarFiles, options, manualPrefix === "" ? undefined : manualPrefix);
    } catch (err) {
      logError(
        "secciones",
        "Error durante la comparación por secciones",
        err instanceof Error ? err.stack : String(err)
      );
      return null;
    }
  }, [jmxFile, filteredHarFiles, options, manualPrefix]);

  useEffect(() => {
    if (!sectionResult) return;
    const totals = sectionResult.reduce(
      (acc, s) => ({
        added: acc.added + s.result.added.length,
        removed: acc.removed + s.result.removed.length,
        modified: acc.modified + s.result.matched.filter((d) => d.kind === "modified").length,
      }),
      { added: 0, removed: 0, modified: 0 }
    );
    logInfo(
      "secciones",
      `Comparación por secciones completada: ${sectionResult.length} sección(es), ` +
        `${totals.added} nuevos, ${totals.removed} eliminados, ${totals.modified} modificados.`
    );
  }, [sectionResult]);

  // Si la comparación por secciones no produce resultados (ej. HAR completo sin
  // transacciones), se muestra un aviso explicando el motivo; la comparación
  // completa queda colapsada y el usuario puede expandirla manualmente.
  const sectionsEmpty = result !== null && sectionResult !== null && sectionResult.length === 0;

  return (
    <div className="app">
      <LogPanel />
      <header className="app-header">
        <h1>{t("Comparador JMX ↔ HAR")}</h1>
        <p>{t("Compara un plan de pruebas de JMeter (.jmx) contra una captura HAR")}</p>
        <div className="tab-bar">
          <button
            className={activeTab === "compare" ? "active" : ""}
            onClick={() => setActiveTab("compare")}
          >
            {t("⚖️ Comparar")}
          </button>
          <button
            className={activeTab === "viewer" ? "active" : ""}
            onClick={() => setActiveTab("viewer")}
          >
            {t("👁️ Visor HAR")}
          </button>
          <button
            className={activeTab === "settings" ? "active" : ""}
            onClick={() => setActiveTab("settings")}
          >
            {t("⚙️ Configuración")}
          </button>
          <button
            className={aboutOpen ? "active" : ""}
            onClick={() => setAboutOpen((v) => !v)}
          >
            {t("ℹ️ Acerca de")}
          </button>
        </div>
        {activeTab === "compare" && (
          <div className="subtab-bar">
            <button
              className={compareTab === "jmx-har" ? "active" : ""}
              onClick={() => setCompareTab("jmx-har")}
            >
              JMX ↔ HAR
            </button>
            <button
              className={compareTab === "jmx-jmx" ? "active" : ""}
              onClick={() => setCompareTab("jmx-jmx")}
            >
              JMX vs JMX
            </button>
            <button
              className={compareTab === "har-har" ? "active" : ""}
              onClick={() => setCompareTab("har-har")}
            >
              HAR vs HAR
            </button>
          </div>
        )}
      </header>

      {aboutOpen && (
        <section className="about-panel">
          <h2>{t("¿Qué puede hacer esta aplicación?")}</h2>
          <ul>
            <li>
              <strong>{t("Comparar JMX ↔ HAR:")}</strong> {t("cruza un plan de pruebas de JMeter (.jmx) contra una captura HAR (o viceversa) y reporta requests nuevos, eliminados y modificados, con diff de query params, headers y bodies.")}
            </li>
            <li>
              <strong>{t("Comparar JMX vs JMX / HAR vs HAR:")}</strong> {t("compara dos archivos del mismo tipo para detectar diferencias entre versiones de un script o entre dos capturas.")}
            </li>
            <li>
              <strong>{t("Comparación por secciones:")}</strong> {t("empareja cada HAR con la transacción del JMX (controladores con prefijo, ej. ITL_*, NAV_*) por similitud de nombre.")}
            </li>
            <li>
              <strong>{t("Visor HAR:")}</strong> {t("explora una o varias capturas HAR request por request, con sus headers, params y bodies.")}
            </li>
            <li>
              <strong>{t("Filtros y opciones:")}</strong> {t("filtrar/excluir URLs, elegir dominios, excluir assets del front, ignorar variables de JMeter, headers y params volátiles, y comparar bodies JSON semánticamente.")}
            </li>
            <li>
              <strong>{t("Exportar e importar:")}</strong> {t("descarga el reporte en CSV o TXT y vuelve a cargar un reporte previo para revisarlo sin re-comparar.")}
            </li>
            <li>
              <strong>{t("Extras:")}</strong> {t("copia requests como cURL, globito con resumen de diferencias por fila, paths y params decodificados, y log de errores exportable.")}
            </li>
          </ul>
          <p className="about-note">
            {t("Todo se procesa localmente en tu navegador: ningún archivo sale de tu equipo.")}
          </p>
        </section>
      )}

      {activeTab === "compare" && compareTab === "jmx-har" && (
      <>
      <section className="base-selector">
        <span>{t("Archivo base (flujo esperado):")}</span>
        <label>
          <input
            type="radio"
            name="base"
            checked={baseKind === "jmx"}
            onChange={() => setBaseKind("jmx")}
          />
          JMX
        </label>
        <label>
          <input
            type="radio"
            name="base"
            checked={baseKind === "har"}
            onChange={() => setBaseKind("har")}
          />
          HAR
        </label>
      </section>

      <section className="drops">
        <FileDrop kind="jmx" label={t("Archivo JMX (JMeter)")} file={jmxFile} onFile={setJmxFile} />
        <FileDrop
          kind="har"
          label={t("Archivo(s) HAR")}
          file={harFile}
          onFile={(f) => {
            setHarFile(f);
            setHarFiles([f]);
          }}
          onFiles={(files) => {
            setHarFiles(files);
            setHarFile(files[files.length - 1] ?? null);
          }}
        />
      </section>

      <section className="options-bar">
        <button className="options-toggle" onClick={() => setShowOptions(!showOptions)}>
          {t("⚙️ Opciones de comparación")} {showOptions ? "▲" : "▼"}
        </button>
        <button className="export-btn" onClick={() => reportInputRef.current?.click()}>
          {t("📂 Cargar reporte (CSV/TXT)")}
        </button>
        {showOptions && (
          <div className="options-panel">
            <label className="option-check">
              <input
                type="checkbox"
                checked={options.ignoreVariables}
                onChange={(e) => setOptions({ ...options, ignoreVariables: e.target.checked })}
              />
              Ignorar variables de JMeter ({"${var}"} → placeholder)
            </label>
            <label className="option-check">
              <input
                type="checkbox"
                checked={options.jsonBodies}
                onChange={(e) => setOptions({ ...options, jsonBodies: e.target.checked })}
              />
              {t("Comparar bodies JSON semánticamente (ignora formato y orden de claves)")}
            </label>
            <label className="option-inline">
              {t("Prefijo de transacción (vacío = automático, ej. \"ITL_\", \"NAV_\"):")}
              <input
                type="text"
                value={manualPrefix}
                placeholder={t("Automático")}
                onChange={(e) => setManualPrefix(e.target.value.trim())}
              />
            </label>
            <label className="option-inline">
              {t("Headers a ignorar (separados por coma):")}
              <input
                type="text"
                value={options.ignoredHeaders.join(", ")}
                onChange={(e) =>
                  setOptions({
                    ...options,
                    ignoredHeaders: e.target.value.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
                  })
                }
              />
            </label>
            <label className="option-inline">
              {t("Query params volátiles a ignorar (separados por coma):")}
              <input
                type="text"
                value={options.volatileParams.join(", ")}
                onChange={(e) =>
                  setOptions({
                    ...options,
                    volatileParams: e.target.value.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
                  })
                }
              />
            </label>
            <label className="option-inline">
              {t("Filtro de URLs del HAR (solo se comparan requests cuya URL contiene alguno de estos textos, separados por coma):")}
              <input
                type="text"
                value={urlFilterText}
                placeholder={t("Ej. __remoteService, /Resource.svc (vacío = comparar todo)")}
                onChange={(e) => setUrlFilterText(e.target.value)}
              />
            </label>
            <label className="option-inline">
              {t("Excluir URLs del HAR que contengan (separados por coma):")}
              <input
                type="text"
                value={urlExcludeText}
                placeholder={t("Ej. favicon, analytics, /assets/ (vacío = no excluir nada)")}
                onChange={(e) => setUrlExcludeText(e.target.value)
                }
              />
            </label>
            <label className="option-check">
              <input
                type="checkbox"
                checked={excludeAssets}
                onChange={(e) => setExcludeAssets(e.target.checked)}
              />
              {t("Excluir assets del front (js, css, imágenes, fuentes, media)")}
            </label>
            <div className="option-inline domains-option">
              <button
                type="button"
                className={domainsOpen || selectedDomains.size > 0 ? "options-toggle active" : "options-toggle"}
                onClick={() => setDomainsOpen((v) => !v)}
                disabled={harFiles.length === 0}
              >
                🌐 Dominios{selectedDomains.size > 0 ? `: ${selectedDomains.size}` : ""}
              </button>
              {domainsOpen && harFiles.length > 0 && (
                <div className="domains-dialog">
                  {availableDomains.length === 0 ? (
                    <p className="detail-empty">No se detectaron dominios en los HAR cargados.</p>
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
                        <button type="button" onClick={() => setSelectedDomains(new Set(availableDomains.map(([d]) => d)))}>
                          Todos
                        </button>
                        <button type="button" onClick={() => setSelectedDomains(new Set())}>Ninguno</button>
                        <span className="search-option-label">
                          {selectedDomains.size === 0
                            ? "Comparando todos los dominios"
                            : `Comparando ${selectedDomains.size} dominio(s)`}
                        </span>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </section>

      {sectionResult && sectionResult.length > 0 && jmxFile && (
        <SectionResultsView
          sections={sectionResult}
          jmxName={jmxFile.fileName}
          prefixLabel={manualPrefix === "" ? `${detectTransactionPrefix(jmxFile) ?? "(sin prefijo)"} (auto)` : manualPrefix}
        />
      )}

      {sectionsEmpty && (
        <section className="sections-empty-notice">
          <p>
            <strong>{t("No hay comparación por secciones.")}</strong> {t("La tabla por secciones empareja cada archivo HAR con una transacción del JMX (controladores con prefijo, ej. ITL_*, NAV_*) por similitud de nombre. Tu HAR no coincide con ninguna transacción del script, así que se omite.")}
          </p>
          <p>
            {t("Causas habituales: (1) cargaste un HAR completo de la sesión en lugar de un HAR por transacción (ej. _Login_Page.har); (2) el prefijo de transacción detectado no corresponde — ajústalo en Opciones de comparación → Prefijo de transacción.")}
          </p>
          <p>{t("Los resultados completos están en «Comparación completa JMX vs HAR» más abajo.")}</p>
        </section>
      )}

      {canCompare && result && (
        <section className="full-compare">
          <button
            className="options-toggle"
            onClick={() => setShowFullCompare((v) => !v)}
          >
            {t("🔍 Comparación completa JMX vs HAR")} {showFullCompare ? "▲" : "▼"}
          </button>
          {showFullCompare && (
            <ResultsView
              result={result}
              baseName={baseKind === "jmx" ? jmxFile!.fileName : harFile!.fileName}
              compareName={baseKind === "jmx" ? harFile!.fileName : jmxFile!.fileName}
            />
          )}
        </section>
      )}
      </>
      )}

      {activeTab === "compare" && compareTab === "jmx-jmx" && (
        <>
          <section className="drops">
            <FileDrop kind="jmx" label={t("JMX base (flujo esperado)")} file={jmxFileA} onFile={setJmxFileA} />
            <FileDrop kind="jmx" label={t("JMX a comparar")} file={jmxFileB} onFile={setJmxFileB} />
          </section>
          {jmxJmxResult && (
            <section className="full-compare">
              <ResultsView
                result={jmxJmxResult}
                baseName={jmxFileA!.fileName}
                compareName={jmxFileB!.fileName}
              />
            </section>
          )}
          {jmxFileA && jmxFileB && !jmxJmxResult && (
            <section className="sections-empty-notice">
              <p>No se pudo comparar los dos JMX. Revisa el log de errores.</p>
            </section>
          )}
        </>
      )}

      {activeTab === "compare" && compareTab === "har-har" && (
        <>
          <section className="drops">
            <FileDrop kind="har" label={t("HAR base (flujo esperado)")} file={harFileA} onFile={setHarFileA} />
            <FileDrop kind="har" label={t("HAR a comparar")} file={harFileB} onFile={setHarFileB} />
          </section>
          {harHarResult && (
            <section className="full-compare">
              <ResultsView
                result={harHarResult}
                baseName={harFileA!.fileName}
                compareName={harFileB!.fileName}
              />
            </section>
          )}
          {harFileA && harFileB && !harHarResult && (
            <section className="sections-empty-notice">
              <p>No se pudo comparar los dos HAR. Revisa el log de errores.</p>
            </section>
          )}
        </>
      )}

      {activeTab === "settings" && (
        <section className="settings-panel">
          <h2>{t("Configuración")}</h2>
          <div className="settings-row">
            <label htmlFor="lang-select">{t("Idioma de la aplicación")}</label>
            <select
              id="lang-select"
              value={lang}
              onChange={(e) => setLang(e.target.value === "en" ? "en" : "es")}
            >
              <option value="es">{t("Español")}</option>
              <option value="en">{t("Inglés")}</option>
            </select>
          </div>
          <p className="settings-note">
            {t("El idioma se guarda en tu navegador y se aplica al recargar. Algunas secciones pueden seguir en español.")}
          </p>
        </section>
      )}

      {activeTab === "viewer" && (
        <HarViewer
          harFile={harFile}
          harFiles={harFiles}
          onFilesChange={(files) => {
            setHarFiles(files);
            setHarFile(files[files.length - 1] ?? null);
          }}
          onSelectFile={setHarFile}
        />
      )}

      {loadedReport && (
        <LoadedReportView data={loadedReport} onClose={() => setLoadedReport(null)} />
      )}
      <input
        ref={reportInputRef}
        type="file"
        accept=".csv,.txt"
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleReportFile(file);
          e.target.value = "";
        }}
      />
    </div>
  );
}
