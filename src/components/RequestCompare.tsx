import { Fragment, useState } from "react";
import type { HttpRequest, RequestDiff, RequestEntry } from "../types";
import { buildCurl } from "../curlBuilder";
import { decodeFormBody, decodeParamValue } from "../normalize";
import { BodyDiff } from "./BodyDiff";
import { Collapsible } from "./Collapsible";
import { useLang } from "../i18n";

/** Botón que copia el cURL del request al portapapeles. */
function CopyCurlButton({ request }: { request: HttpRequest }) {
  const [copied, setCopied] = useState(false);
  const { t } = useLang();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(buildCurl(request));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Portapapeles no disponible (permiso/contexto inseguro): sin acción.
    }
  };
  return (
    <button className="curl-btn" onClick={copy} title={t("Copiar cURL de este request")}>
      {copied ? t("✅ Copiado") : "</> cURL"}
    </button>
  );
}

interface RequestCompareProps {
  diff: RequestDiff;
  baseLabel: string;
  compareLabel: string;
}

const FIELD_LABEL: Record<string, string> = {
  query: "Query param",
  header: "Header",
  body: "Body",
};

/** Renderiza una lista de pares nombre/valor, o un mensaje de vacío. */
export function PairList({ title, pairs, emptyText }: { title: string; pairs: { name: string; value: string }[]; emptyText: string }) {
  return (
    <div className="pair-section">
      <h4>{title}</h4>
      {pairs.length === 0 ? (
        <p className="pair-empty">{emptyText}</p>
      ) : (
        <table className="pair-table">
          <tbody>
            {pairs.map((p, i) => (
              <tr key={i}>
                <td className="pair-name">{decodeParamValue(p.name) || "—"}</td>
                <td className="pair-value">{decodeParamValue(p.value) || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** Panel de un solo request (para requests que solo existen en un archivo). */
function SingleSide({ request, label, badgeText, badgeClass }: { request: HttpRequest; label: string; badgeText: string; badgeClass: string }) {
  const { t } = useLang();
  return (
    <div className="compare-side">
      <div className="compare-side-title">
        <strong>{label}</strong>
        <span className={`badge ${badgeClass}`}>{badgeText}</span>
        <CopyCurlButton request={request} />
      </div>
      <p className="compare-method">{request.method} {decodeParamValue(request.path)}</p>
      {request.source === "har" && <p className="compare-sampler-name">{t("Request #")}{request.order + 1} {t("del HAR")}</p>}
      {request.label && <p className="compare-sampler-name">{t("Sampler:")} {request.label}</p>}
      <PairList title={t("Query params")} pairs={request.query} emptyText={t("Sin query params")} />
      <Collapsible title={t("Headers")} summary={`${request.headers.length} ${t("headers")}`}>
        <PairList title="" pairs={request.headers} emptyText={t("Sin headers")} />
      </Collapsible>
      <Collapsible title={t("Body")} summary={request.body ? `${request.body.length} ${t("caracteres")}` : t("sin body")}>
        {request.body ? <pre className="body-pre">{decodeFormBody(request.body)}</pre> : <p className="pair-empty">{t("Sin body")}</p>}
      </Collapsible>
    </div>
  );
}

/** Vista comparativa lado a lado de un request (base vs comparado). */
export function RequestCompare({ diff, baseLabel, compareLabel }: RequestCompareProps) {
  const { base, compare, changes } = diff;
  const { t } = useLang();

  // Requests que solo existen en un lado.
  if (!base || !compare) {
    const only = (base ?? compare) as RequestEntry;
    return (
      <div className="compare-grid single">
        <SingleSide
          request={only.request}
          label={base ? baseLabel : compareLabel}
          badgeText={base ? t("Solo en la base") : t("Solo en el comparado")}
          badgeClass={base ? "badge-removed" : "badge-new"}
        />
      </div>
    );
  }

  return (
    <div>
      <div className="compare-grid">
        <div className="compare-side">
          <div className="compare-side-title">
            <strong>{baseLabel}</strong>
            <CopyCurlButton request={base.request} />
          </div>
          <p className="compare-method">{base.request.method} {decodeParamValue(base.request.path)}</p>
          {base.request.source === "har" && <p className="compare-sampler-name">{t("Request #")}{base.request.order + 1} {t("del HAR")}</p>}
          {base.request.label && <p className="compare-sampler-name">{t("Sampler:")} {base.request.label}</p>}
          <PairList title={t("Query params")} pairs={base.request.query} emptyText={t("Sin query params")} />
          <Collapsible title={t("Headers")} summary={`${base.request.headers.length} ${t("headers")}`}>
            <PairList title="" pairs={base.request.headers} emptyText={t("Sin headers")} />
          </Collapsible>
          <Collapsible title={t("Body")} summary={base.request.body ? `${base.request.body.length} ${t("caracteres")}` : t("sin body")}>
            {base.request.body ? <pre className="body-pre">{decodeFormBody(base.request.body)}</pre> : <p className="pair-empty">{t("Sin body")}</p>}
          </Collapsible>
        </div>
        <div className="compare-side">
          <div className="compare-side-title">
            <strong>{compareLabel}</strong>
            <CopyCurlButton request={compare.request} />
          </div>
          <p className="compare-method">{compare.request.method} {decodeParamValue(compare.request.path)}</p>
          {compare.request.source === "har" && <p className="compare-sampler-name">{t("Request #")}{compare.request.order + 1} {t("del HAR")}</p>}
          {compare.request.label && <p className="compare-sampler-name">{t("Sampler:")} {compare.request.label}</p>}
          <PairList title={t("Query params")} pairs={compare.request.query} emptyText={t("Sin query params")} />
          <Collapsible title={t("Headers")} summary={`${compare.request.headers.length} ${t("headers")}`}>
            <PairList title="" pairs={compare.request.headers} emptyText={t("Sin headers")} />
          </Collapsible>
          <Collapsible title={t("Body")} summary={compare.request.body ? `${compare.request.body.length} ${t("caracteres")}` : t("sin body")}>
            {compare.request.body ? <pre className="body-pre">{decodeFormBody(compare.request.body)}</pre> : <p className="pair-empty">{t("Sin body")}</p>}
          </Collapsible>
        </div>
      </div>
      {changes.length > 0 && (
        <div className="changes-section">
          <h4>{t("Resumen de diferencias")}</h4>
          <table className="changes-table">
            <thead>
              <tr>
                <th>{t("Tipo")}</th>
                <th>{t("Nombre")}</th>
                <th>{t("Diferencia")}</th>
              </tr>
            </thead>
            <tbody>
              {changes.map((c, i) => (
                <Fragment key={i}>
                  <tr>
                    <td>{t(FIELD_LABEL[c.kind] ?? c.kind)}</td>
                    <td>{c.name}</td>
                    <td className="diff-value">
                      {c.kind === "body" && c.summary ? (
                        <BodyDiff before={c.before} after={c.after} />
                      ) : (
                        <span className="diff-inline">
                          <span className="diff-inline-before">{c.before || "—"}</span>
                          <span className="diff-inline-arrow">→</span>
                          <span className="diff-inline-after">{c.after || "—"}</span>
                        </span>
                      )}
                    </td>
                </tr>
                {c.summary && (
                  <tr className="diff-summary-row">
                    <td colSpan={3}>
                      <div className="diff-summary">
                        <strong>{t("Por qué difiere:")}</strong>
                        {"\n"}
                        {c.summary}
                      </div>
                    </td>
                  </tr>
                )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
