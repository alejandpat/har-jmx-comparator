import { useState, type ReactNode } from "react";

interface CollapsibleProps {
  /** Título de la sección (siempre visible). */
  title: string;
  /** Contenido colapsable. */
  children: ReactNode;
  /** Si inicia expandido (por defecto colapsado). */
  defaultOpen?: boolean;
  /** Texto de resumen cuando está colapsado (ej. "3 headers"). */
  summary?: string;
}

/**
 * Sección colapsable: muestra el título con indicador ▸/▾ y, si se provee,
 * un resumen del contenido. Al hacer clic se expande/colapsa.
 */
export function Collapsible({ title, children, defaultOpen = false, summary }: CollapsibleProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`collapsible ${open ? "open" : ""}`}>
      <button
        type="button"
        className="collapsible-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="collapsible-arrow">{open ? "▾" : "▸"}</span>
        <span className="collapsible-title">{title}</span>
        {!open && summary && <span className="collapsible-summary">{summary}</span>}
      </button>
      {open && <div className="collapsible-content">{children}</div>}
    </div>
  );
}
