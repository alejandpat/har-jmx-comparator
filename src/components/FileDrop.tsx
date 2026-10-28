import { useCallback, useId, useState } from "react";
import type { ParsedFile } from "../types";
import { parseJmx } from "../jmxParser";
import { parseHar } from "../harParser";
import { logError, logInfo, logWarn } from "../logger";
import { useLang } from "../i18n";

interface FileDropProps {
  /** "jmx" | "har" */
  kind: "jmx" | "har";
  label: string;
  file: ParsedFile | null;
  onFile: (file: ParsedFile) => void;
  /** Solo para HAR: acepta múltiples archivos y entrega la lista completa. */
  onFiles?: (files: ParsedFile[]) => void;
}

const ACCEPT: Record<string, string> = { jmx: ".jmx,.xml", har: ".har,.json" };

export function FileDrop({ kind, label, onFile, file, onFiles }: FileDropProps) {
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useLang();
  // Id único por instancia: con dos dropzones del mismo tipo en pantalla (ej.
  // pestaña JMX vs JMX), un id fijo haría que ambos compartan el mismo input.
  const inputId = `file-input-${useId()}`;

  const readFile = useCallback(
    (selected: File) => {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const text = String(reader.result ?? "");
          const parsed = kind === "jmx" ? parseJmx(text, selected.name) : parseHar(text, selected.name);
          if (parsed.requests.length === 0) {
            setError("No se encontraron requests HTTP en el archivo.");
            logWarn(`parser-${kind}`, `No se encontraron requests HTTP en "${selected.name}".`);
            return;
          }
          setError(null);
          logInfo(`parser-${kind}`, `"${selected.name}" parseado: ${parsed.requests.length} requests.`);
          onFile(parsed);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          setError(`Error al parsear: ${message}`);
          logError(`parser-${kind}`, `Error al parsear "${selected.name}"`, message);
        }
      };
      reader.readAsText(selected);
    },
    [kind, onFile]
  );

  const readFiles = useCallback(
    (selected: FileList) => {
      const parsed: ParsedFile[] = [];
      const names: string[] = [];
      let pending = selected.length;
      for (const file of Array.from(selected)) {
        const reader = new FileReader();
        reader.onload = () => {
          try {
            const text = String(reader.result ?? "");
            const p = kind === "jmx" ? parseJmx(text, file.name) : parseHar(text, file.name);
            if (p.requests.length === 0) {
              logWarn(`parser-${kind}`, `"${file.name}" sin requests HTTP; se omite.`);
            } else {
              parsed.push(p);
              names.push(`${file.name} (${p.requests.length} requests)`);
            }
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            logError(`parser-${kind}`, `Error al parsear "${file.name}"`, message);
          }
          pending--;
          if (pending === 0) {
            if (parsed.length > 0) {
              setError(null);
              logInfo(`parser-${kind}`, `${parsed.length} archivo(s) parseado(s): ${names.join("; ")}.`);
              onFiles?.(parsed);
            } else {
              setError(t("Ningún archivo pudo parsearse."));
            }
          }
        };
        reader.readAsText(file);
      }
    },
    [kind, onFiles]
  );

  const handleFileList = useCallback(
    (files: FileList) => {
      if (files.length > 1 && kind === "har" && onFiles) {
        readFiles(files);
      } else {
        readFile(files[0]);
      }
    },
    [kind, onFiles, readFile, readFiles]
  );

  return (
    <div
      className={`drop-zone ${dragOver ? "drag-over" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const files = e.dataTransfer.files;
        if (!files || files.length === 0) return;
        handleFileList(files);
      }}
      onClick={() => document.getElementById(inputId)?.click()}
      role="button"
      tabIndex={0}
    >
      <input
        id={inputId}
        type="file"
        accept={ACCEPT[kind]}
        multiple={kind === "har"}
        style={{ display: "none" }}
        onChange={(e) => {
          const files = e.target.files;
          if (!files || files.length === 0) return;
          handleFileList(files);
        }}
      />
      <div className="drop-icon">{file ? "✅" : "📄"}</div>
      <div className="drop-title">{label}</div>
      {file ? (
        <div className="drop-info">
          <strong>{file.fileName}</strong> — {file.requests.length} requests
        </div>
      ) : (
        <div className="drop-hint">
          {kind === "har"
            ? t("Arrastra uno o varios HAR aquí o haz clic para seleccionar")
            : t("Arrastra el archivo aquí o haz clic para seleccionar")}
        </div>
      )}
      {error && <div className="drop-error">{error}</div>}
    </div>
  );
}
