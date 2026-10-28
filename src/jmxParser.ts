import { XMLParser } from "fast-xml-parser";
import type { HttpHeader, HttpRequest, ParsedFile, QueryParam } from "./types";
import { logWarn } from "./logger";

/** Normaliza un path: quita host, protocolo, variables de host y query string. */
export function normalizePath(rawUrl: string): string {
  let url = rawUrl.trim();
  const schemeMatch = url.match(/^https?:\/\/[^/]+/i);
  if (schemeMatch) {
    url = url.slice(schemeMatch[0].length) || "/";
  }
  // Quita variables de host al inicio (ej. "${MAIN_HOST}/...", "{HOST_LOGIN}/..."):
  // en JMeter el host suele parametrizarse y no es parte del path.
  url = url.replace(/^\$\{[^}]+\}\//, "/").replace(/^\{[^}]+\}\//, "/");
  const qIndex = url.indexOf("?");
  if (qIndex !== -1) url = url.slice(0, qIndex);
  const hIndex = url.indexOf("#");
  if (hIndex !== -1) url = url.slice(0, hIndex);
  // Asegura "/" inicial: algunos JMX tienen samplers con paths relativos sin "/" (ej. "__remoteService/x").
  if (!url.startsWith("/")) url = "/" + url;
  return url || "/";
}

/** Parsea un query string en lista de pares. */
export function parseQueryString(qs: string): QueryParam[] {
  if (!qs) return [];
  const clean = qs.startsWith("?") ? qs.slice(1) : qs;
  return clean
    .split("&")
    .filter(Boolean)
    .map((pair) => {
      const eq = pair.indexOf("=");
      if (eq === -1) return { name: decodeURIComponent(pair), value: "" };
      return {
        name: decodeURIComponent(pair.slice(0, eq)),
        value: decodeURIComponent(pair.slice(eq + 1)),
      };
    });
}

/** Extrae el query string de una URL cruda (sin decodificar). */
export function extractRawQuery(rawUrl: string): string {
  const qIndex = rawUrl.indexOf("?");
  if (qIndex === -1) return "";
  const hIndex = rawUrl.indexOf("#");
  return hIndex === -1
    ? rawUrl.slice(qIndex + 1)
    : rawUrl.slice(qIndex + 1, hIndex);
}

/** Nodo XML en modo preserveOrder: { Tag: hijos[], ":@": atributos }. */

function tagOf(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  for (const key of Object.keys(node)) {
    if (key !== ":@") return key;
  }
  return "";
}

function childrenOf(node: unknown): unknown[] {
  const tag = tagOf(node);
  if (!tag) return [];
  const inner = (node as Record<string, unknown>)[tag];
  if (Array.isArray(inner)) return inner;
  if (inner === undefined || inner === null) return [];
  return [inner];
}

function attrOf(node: unknown, name: string): string {
  if (!node || typeof node !== "object") return "";
  const attrs = (node as Record<string, unknown>)[":@"] as Record<string, unknown> | undefined;
  const value = attrs?.[`@_${name}`];
  return value === undefined || value === null ? "" : String(value);
}

function textOf(node: unknown): string {
  if (node === undefined || node === null) return "";
  if (typeof node !== "object") return String(node).trim();
  const text = (node as Record<string, unknown>)["#text"];
  return text === undefined || text === null ? "" : String(text).trim();
}

/** Elementos hijos de un nodo cuyo tag coincide. */
function childrenWithTag(node: unknown, tagName: string): unknown[] {
  return childrenOf(node).filter((child) => tagOf(child) === tagName);
}

/** Busca un elemento hijo `tagName` con atributo name === propName y devuelve su texto. */
function propTextOf(node: unknown, tagName: string, propName: string): string {
  for (const child of childrenWithTag(node, tagName)) {
    if (attrOf(child, "name") === propName) {
      return childrenOf(child).map(textOf).join("");
    }
  }
  return "";
}

const SAMPLER_CLASSES = new Set(["HTTPSamplerProxy", "HTTPSampler", "HTTPSampler2"]);

/** Extrae los argumentos (query params o body params) de un sampler. */
function extractArguments(sampler: unknown): QueryParam[] {
  const result: QueryParam[] = [];
  for (const argsContainer of childrenWithTag(sampler, "elementProp")) {
    if (attrOf(argsContainer, "name") !== "HTTPsampler.Arguments") continue;
    for (const coll of childrenWithTag(argsContainer, "collectionProp")) {
      for (const arg of childrenWithTag(coll, "elementProp")) {
        const name = propTextOf(arg, "stringProp", "Argument.name");
        const value = propTextOf(arg, "stringProp", "Argument.value");
        result.push({ name, value });
      }
    }
  }
  return result;
}

/** Extrae headers de un HeaderManager (embebido o hermano en hashTree). */
function extractHeaders(node: unknown): HttpHeader[] {
  const result: HttpHeader[] = [];
  for (const manager of childrenWithTag(node, "HeaderManager")) {
    for (const coll of childrenWithTag(manager, "collectionProp")) {
      for (const headerEl of childrenWithTag(coll, "elementProp")) {
        const name = propTextOf(headerEl, "stringProp", "Header.name");
        const value = propTextOf(headerEl, "stringProp", "Header.value");
        result.push({ name, value });
      }
    }
  }
  return result;
}

interface Sampler {
  method: string;
  path: string;
  args: QueryParam[];
  headers: HttpHeader[];
  body: string;
  label: string;
  /** Cadena de controladores padres (testname), separados por " > ". */
  parentPath: string;
  /** "Follow Redirects" de JMeter (true = comportamiento por defecto). */
  followRedirects: boolean;
}

/** Serializa argumentos como form-urlencoded (para POST con body params). */
function serializeArgsAsBody(args: QueryParam[]): string {
  return args.map((a) => `${encodeURIComponent(a.name)}=${encodeURIComponent(a.value)}`).join("&");
}

/** Concatena los valores de los argumentos sin codificar (body crudo de postBodyRaw). */
function joinArgValues(args: QueryParam[]): string {
  return args.map((a) => a.value).join("");
}

/**
 * Recorre el árbol (preserveOrder) y empareja cada sampler con su hashTree hermano,
 * donde viven el HeaderManager y el body crudo. `parents` acumula la cadena de
 * controladores padres (testname) para trazabilidad por sección.
 */
/**
 * Recorre el árbol (preserveOrder) emparejando cada elemento con su hashTree hermano,
 * donde viven su configuración y sus hijos. En formato JMX, cada elemento va seguido
 * de un hashTree hermano: los samplers tienen ahí su HeaderManager/body, y los
 * controladores tienen ahí sus samplers hijos.
 */
function collectSamplers(node: unknown, out: Sampler[], parents: string[] = []): void {
  const children = childrenOf(node);
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    const tag = tagOf(child);
    // Los hashTree se procesan junto a su elemento asociado. Si llegan aquí es porque
    // ningún elemento los consumió (hashTree huérfano, p. ej. el de TestPlan): se exploran.
    if (tag === "hashTree") {
      collectSamplers(child, out, parents);
      continue;
    }

    const isSampler = SAMPLER_CLASSES.has(tag);
    const isCtrl = isController(child);
    const testname = attrOf(child, "testname");

    // El hashTree de configuración/hijos es el siguiente hashTree entre los hermanos
    // (tolera elementos intermedios entre el elemento y su hashTree). Solo se busca
    // para elementos que lo consumen (samplers, controladores, contenedores con testname).
    let config: unknown = undefined;
    let configIndex = -1;
    if (isSampler || isCtrl || testname) {
      for (let k = i + 1; k < children.length; k++) {
        if (tagOf(children[k]) === "hashTree") {
          config = children[k];
          configIndex = k;
          break;
        }
      }
    }

    if (SAMPLER_CLASSES.has(tag)) {
      out.push(buildSampler(child, config ?? child, parents));
      if (configIndex >= 0) i = configIndex; // El hashTree hermano ya fue consumido.
      continue;
    }
    if (isController(child)) {
      if (config) {
        // Los hijos del controlador viven en el hashTree hermano; acumula el nombre como padre.
        collectSamplers(config, out, [...parents, controllerName(child)]);
        i = configIndex;
      } else {
        // Tolerancia: sin hashTree hermano (formato no estándar, herramientas externas);
        // explora los hijos propios del elemento para no perder samplers anidados.
        collectSamplers(child, out, parents);
      }
      continue;
    }
    // Heurística de tolerancia: elementos con testname (tags nuevos de JMeter, plugins)
    // se tratan como contenedores genéricos, acumulando su nombre, para que la
    // trazabilidad por sección no dependa de una lista fija de tags. Se explora tanto
    // el hashTree hermano como los hijos propios (algunas herramientas anidan el
    // hashTree dentro del elemento).
    if (attrOf(child, "testname")) {
      const name = [...parents, attrOf(child, "testname")];
      if (config) {
        collectSamplers(config, out, name);
        i = configIndex;
      }
      collectSamplers(child, out, name);
      continue;
    }
    // Otros elementos (TestPlan, Arguments, etc.): sus hashTree anidados se recorren
    // de forma natural en la siguiente iteración, sin acumular padres.
    collectSamplers(child, out, parents);
  }
}

/** Tags de controladores que agrupan samplers en JMeter. */
const CONTROLLER_CLASSES = new Set([
  "ThreadGroup",
  "SetupThreadGroup",
  "PostThreadGroup",
  "TransactionController",
  "GenericController",
  "LoopController",
  "OnceOnlyController",
  "InterleaveControl",
  "RandomController",
  "ThroughputController",
  "IfController",
  "WhileController",
  "ForeachController",
  "ModuleController",
  "IncludeController",
  "TestFragmentController",
]);

/** Determina si un nodo es un controlador que agrupa samplers. */
function isController(node: unknown): boolean {
  return CONTROLLER_CLASSES.has(tagOf(node));
}

/** Nombre legible de un controlador (testname o tag). */
function controllerName(node: unknown): string {
  return attrOf(node, "testname") || tagOf(node);
}

/** Construye un Sampler a partir del nodo sampler, su árbol de configuración y la cadena de controladores padres. */
function buildSampler(samplerNode: unknown, configTree: unknown, parents: string[]): Sampler {
  const method = propTextOf(samplerNode, "stringProp", "HTTPSampler.method") || "GET";
  const path = propTextOf(samplerNode, "stringProp", "HTTPSampler.path") || "/";
  const args = extractArguments(samplerNode);
  const postBodyRaw = propTextOf(samplerNode, "stringProp", "HTTPSampler.postBodyRaw") === "true";
  // Body: stringProp HTTPSampler.BODY en el hashTree de configuración, o args serializados.
  const body =
    propTextOf(configTree, "stringProp", "HTTPSampler.BODY") ||
    (postBodyRaw ? joinArgValues(args) : "");
  const headers = extractHeaders(configTree);
  // "Follow Redirects" de JMeter: boolProp HTTPSampler.follow_redirects.
  // Si el prop no existe, JMeter lo tiene activado por defecto (true).
  const followRedirectsProp = propTextOf(samplerNode, "boolProp", "HTTPSampler.follow_redirects");
  const followRedirects = followRedirectsProp === "" ? true : followRedirectsProp === "true";
  return {
    method,
    path,
    args: postBodyRaw ? [] : args,
    headers,
    body,
    label: attrOf(samplerNode, "testname") || `${method} ${path}`,
    parentPath: parents.join(" > "),
    followRedirects,
  };
}

/** Parsea el contenido de un archivo .jmx y extrae los HTTP requests. */
export function parseJmx(content: string, fileName: string): ParsedFile {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    textNodeName: "#text",
    trimValues: true,
    preserveOrder: true,
  });
  const doc = parser.parse(content) as unknown[];
  // doc es la lista de nodos raíz; busca el nodo cuyo tag sea jmeterTestPlan.
  const testPlan = doc.find((node) => tagOf(node) === "jmeterTestPlan") ?? (doc[0] ?? {});

  const samplers: Sampler[] = [];
  collectSamplers(testPlan, samplers);

  // Advertencia temprana: JMX parseable pero sin samplers HTTP detectados
  // (formato no estándar, plugins, o archivo que no es un plan de JMeter).
  if (samplers.length === 0) {
    logWarn(
      "parser-jmx",
      `No se encontraron samplers HTTP en "${fileName}". ` +
        `El archivo puede usar un formato no estándar o no ser un plan de JMeter.`
    );
  }

  const requests: HttpRequest[] = samplers.map((s, i) => {
    const method = s.method.toUpperCase();
    const rawQuery = extractRawQuery(s.path);
    const urlQuery = parseQueryString(rawQuery);
    // En métodos con body, los argumentos del sampler son body params (form-urlencoded),
    // no query params. En GET/HEAD son query params.
    const bodyMethod = ["POST", "PUT", "PATCH", "DELETE"].includes(method);
    const query = urlQuery.length > 0 ? urlQuery : bodyMethod ? [] : s.args;
    const body = s.body || (bodyMethod && s.args.length > 0 ? serializeArgsAsBody(s.args) : "");
    return {
      method,
      path: normalizePath(s.path),
      query,
      headers: s.headers,
      body,
      source: "jmx" as const,
      order: i,
      label: s.label,
      parentPath: s.parentPath,
      followRedirects: s.followRedirects,
    };
  });

  return {
    kind: "jmx",
    fileName,
    requests,
    meta: { samplers: String(samplers.length) },
  };
}
