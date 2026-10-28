import { parseJmx } from "../src/jmxParser";
import { parseHar } from "../src/harParser";
import { compareFiles } from "../src/diffEngine";
import { DEFAULT_OPTIONS } from "../src/normalize";

// JMX con variables de JMeter y body JSON con formato distinto
const jmxXml = `<?xml version="1.0"?>
<jmeterTestPlan><TestPlan><hashTree>
  <HTTPSamplerProxy testname="Crear orden">
    <stringProp name="HTTPSampler.path">/api/orders</stringProp>
    <stringProp name="HTTPSampler.method">POST</stringProp>
    <stringProp name="HTTPSampler.postBodyRaw">true</stringProp>
    <elementProp name="HTTPsampler.Arguments" elementType="Arguments"><collectionProp name="Argument.arguments"/></elementProp>
    <stringProp name="HTTPSampler.BODY">{"userId": "\${userId}", "items": [1, 2]}</stringProp>
  </HTTPSamplerProxy>
  <hashTree/>
</hashTree></TestPlan></jmeterTestPlan>`;

const harObj = {
  log: {
    entries: [
      {
        request: {
          method: "POST",
          url: "https://api.example.com/api/orders?_=1699999",
          headers: [
            { name: "User-Agent", value: "Mozilla/5.0" },
            { name: "sec-ch-ua", value: '"Chromium"' },
          ],
          queryString: [{ name: "_", value: "12345" }],
          postData: { mimeType: "application/json", text: '{"items":[1,2],"userId":"abc123"}' },
        },
      },
    ],
  },
};

const jmx = parseJmx(jmxXml, "test.jmx");
const har = parseHar(JSON.stringify(harObj), "synthetic.har");

console.log("=== Variables + formato JSON distinto + headers de navegador ===");
const result = compareFiles(jmx, har, DEFAULT_OPTIONS);
console.log("Nuevos:", result.added.length, "Eliminados:", result.removed.length);
for (const m of result.matched) {
  console.log(`${m.kind.toUpperCase()}: ${m.compare?.request.method} ${m.compare?.request.path}`);
  for (const c of m.changes) console.log(`   ${c.kind}/${c.name}: "${c.before}" -> "${c.after}"`);
}
