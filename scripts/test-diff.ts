import { readFileSync } from "node:fs";
import { parseJmx } from "../src/jmxParser";
import { parseHar } from "../src/harParser";
import { compareFiles } from "../src/diffEngine";
import { DEFAULT_OPTIONS } from "../src/normalize";

const jmx = parseJmx(readFileSync("examples/sample.jmx", "utf8"), "sample.jmx");
const har = parseHar(readFileSync("examples/sample.har", "utf8"), "sample.har");

console.log("=== Comparación ESTRICTA (sin mejoras) ===");
const strict = compareFiles(jmx, har, {
  ...DEFAULT_OPTIONS,
  ignoreVariables: false,
  jsonBodies: false,
  ignoredHeaders: [],
  volatileParams: [],
});
report(strict);

console.log("\n=== Comparación TOLERANTE (con normalización) ===");
const tolerant = compareFiles(jmx, har, DEFAULT_OPTIONS);
report(tolerant);

function report(result: import("../src/types").ComparisonResult): void {
  console.log("Nuevos:", result.added.map((e) => `${e.request.method} ${e.request.path}`));
  console.log("Eliminados:", result.removed.map((e) => `${e.request.method} ${e.request.path}`));
  for (const m of result.matched) {
    console.log(`${m.kind.toUpperCase()}: ${m.compare?.request.method} ${m.compare?.request.path}`);
    for (const c of m.changes) console.log(`   ${c.kind}/${c.name}: "${c.before}" -> "${c.after}"`);
  }
}
