import { useMemo, useState } from "react";
import { diffLines, changedSegment } from "../diffLines";

interface BodyDiffProps {
  before: string;
  after: string;
}

/** Intenta formatear el texto como JSON con indentación de 2 espacios. */
function prettyJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

/** Renderiza una línea resaltando el segmento que realmente cambió. */
function HighlightedLine({ text, highlight }: { text: string; highlight?: [number, number] | null }) {
  if (!highlight || highlight[0] >= highlight[1]) return <>{text || " "}</>;
  const [start, end] = highlight;
  return (
    <>
      {text.slice(0, start)}
      <mark>{text.slice(start, end) || " "}</mark>
      {text.slice(end)}
    </>
  );
}

/**
 * Botón "Ver diff" que expande una vista unificada estilo git diff
 * (líneas eliminadas en rojo, añadidas en verde, con números de línea y
 * resalte del segmento cambiado dentro de cada línea modificada).
 */
export function BodyDiff({ before, after }: BodyDiffProps) {
  const [open, setOpen] = useState(false);

  const lines = useMemo(() => {
    const beforePretty = prettyJson(before);
    const afterPretty = prettyJson(after);
    const raw = diffLines(beforePretty, afterPretty);

    // Empareja bloques removed→added consecutivos para resaltar el cambio
    // dentro de la línea (como el resalte inline de VS Code).
    return raw.map((line, i) => {
      if (line.type !== "removed") return { line, highlight: null as [number, number] | null };
      const next = raw[i + 1];
      if (next && next.type === "added") {
        const seg = changedSegment(line.text, next.text);
        return { line, highlight: seg.before as [number, number] };
      }
      return { line, highlight: null };
    });
  }, [before, after]);

  const addedCount = lines.filter((l) => l.line.type === "added").length;
  const removedCount = lines.filter((l) => l.line.type === "removed").length;

  return (
    <div className="body-diff">
      <button type="button" className="body-diff-toggle" onClick={() => setOpen((v) => !v)}>
        {open ? "▾ Ocultar diff" : "▸ Ver diff"}{" "}
        <span className="diff-stats">
          <span className="diff-stat-added">+{addedCount}</span>{" "}
          <span className="diff-stat-removed">−{removedCount}</span>
        </span>
      </button>
      {open && (
        <div className="body-diff-view" role="table">
          {lines.map((l, i) => (
            <div key={i} className={`diff-row diff-row-${l.line.type}`}>
              <span className="diff-num">{l.line.lineBefore ?? ""}</span>
              <span className="diff-num">{l.line.lineAfter ?? ""}</span>
              <span className="diff-sign">{l.line.type === "added" ? "+" : l.line.type === "removed" ? "−" : ""}</span>
              <span className="diff-text">
                <HighlightedLine text={l.line.text} highlight={l.highlight} />
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
