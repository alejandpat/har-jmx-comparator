# Comparador JMX ↔ HAR

Aplicación web (React + TypeScript + Vite) para comparar planes de pruebas de JMeter (`.jmx`) contra capturas HAR (y viceversa), detectando requests nuevos, eliminados y modificados con diff detallado de query params, headers y bodies.

Todo se procesa **localmente en el navegador**: ningún archivo sale de tu equipo.

## Funcionalidades

- **Comparar JMX ↔ HAR**: cruza un plan de pruebas de JMeter contra una captura HAR (o viceversa) y reporta requests nuevos, eliminados y modificados, con diff de query params, headers y bodies.
- **JMX vs JMX / HAR vs HAR**: compara dos archivos del mismo tipo para detectar diferencias entre versiones de un script o entre dos capturas.
- **Comparación por secciones**: empareja cada HAR con la transacción del JMX (controladores con prefijo, ej. `ITL_*`, `NAV_*`) por similitud de nombre.
- **Visor HAR**: explora una o varias capturas HAR request por request, con sus headers, params y bodies.
- **Filtros y opciones**: filtrar/excluir URLs, elegir dominios, excluir assets del front, ignorar variables de JMeter, headers y params volátiles, y comparar bodies JSON semánticamente.
- **Exportar e importar**: descarga el reporte en CSV o TXT y vuelve a cargar un reporte previo para revisarlo sin re-comparar.
- **Extras**: copia requests como cURL, tooltip con resumen de diferencias por fila, paths y params decodificados, y log de errores exportable.

## Idioma

La interfaz está disponible en **español** e **inglés**. Se cambia desde la pestaña **⚙️ Configuración** y la preferencia se guarda en `localStorage` (clave `har-jmx-comparator.lang`).

Los textos se traducen mediante `src/i18n.tsx`: `t("texto en español")` devuelve la traducción al inglés cuando corresponde; si un texto no está en el diccionario, se muestra en español (fallback seguro). Los formatos de datos exportados (CSV/TXT) permanecen en español para no romper la compatibilidad con reportes previos.

## Uso

```bash
npm install
npm run dev
```

Abre la URL que indica Vite (por defecto `http://localhost:5173`), elige el modo de comparación y arrastra los archivos:

- **JMX ↔ HAR**: un `.jmx` y uno o varios `.har` (con selector de archivo base).
- **JMX vs JMX / HAR vs HAR**: dos archivos del mismo tipo.

Luego revisa la comparación por secciones y/o la comparación completa, filtra por estado (nuevos/eliminados/modificados/iguales), expande cada request para ver el diff y exporta el reporte en CSV o TXT.

## Scripts

| Comando         | Descripción                          |
| --------------- | ------------------------------------ |
| `npm run dev`   | Servidor de desarrollo con HMR       |
| `npm run build` | Typecheck + build de producción      |
| `npm run lint`  | Lint con Oxlint                      |
| `npm run preview` | Sirve el build de producción       |

En Windows también hay utilidades: `iniciar.bat` (dev), `construir.bat` (build) y `lint.bat`.

## Estructura

```
src/
├── App.tsx                  # Pestañas (Comparar / Visor HAR / Configuración / Acerca de) y flujo principal
├── i18n.tsx                 # Proveedor de idioma (es/en) y función t()
├── components/
│   ├── FileDrop.tsx         # Zonas de arrastre de archivos (JMX/HAR)
│   ├── Results.tsx          # Tabla de resultados con filtros y detalle
│   ├── SectionResults.tsx   # Comparación por secciones (JMX vs múltiples HAR)
│   ├── RequestCompare.tsx   # Diff lado a lado de un request
│   ├── BodyDiff.tsx         # Diff línea a línea de bodies
│   ├── LoadedReport.tsx     # Vista de reportes CSV/TXT cargados
│   ├── HarViewer.tsx        # Visor de capturas HAR
│   ├── LogWidget.tsx        # Log de errores y eventos
│   └── Collapsible.tsx      # Secciones colapsables
├── diffEngine.ts            # Comparación JMX ↔ HAR / mismo tipo
├── sectionCompare.ts        # Emparejamiento HAR ↔ transacción por secciones
├── jmxParser.ts / harParser.ts
├── normalize.ts             # Normalización de URLs, params y bodies
├── urlFilter.ts             # Filtros de URLs y dominios
├── curlBuilder.ts           # Generación de cURL
├── exportLog.ts             # Exportación CSV/TXT
└── logger.ts                # Log en vivo y descargable
```

## Stack

- [React 19](https://react.dev) + [TypeScript](https://www.typescriptlang.org) + [Vite](https://vite.dev)
- [fast-xml-parser](https://github.com/NaturalIntelligence/fast-xml-parser) para parsear `.jmx`
- [Oxlint](https://oxc.rs) para lint
