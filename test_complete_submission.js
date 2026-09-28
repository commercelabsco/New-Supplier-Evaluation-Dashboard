const { JSDOM } = require("jsdom");
const fs = require("fs");

// Submit requires every question answered; drafts stay in Ongoing (never By Product);
// records saved with the old procurement options are migrated back to Ongoing.
(async () => {
  const html = fs.readFileSync("./index.html", "utf8");
  const oldRecord = { id:"old-1", refNumber:7, supplier:"Legacy Co", product:"Widget", status:"submitted",
    proc:{ actualCost:"4", netTerms:"2", deposit:"1", credit:"0", moq:"0", leadTime:"0" }, qc:{ gmpMatch:"0" } };
  const mockDb = { "evaluation:old-1": JSON.stringify(oldRecord) };
  const dom = new JSDOM(html, {
    runScripts: "dangerously", resources: "usable", url: "https://example.com/",
    beforeParse(window) {
      window.storage = {
        set: async (k, v) => { mockDb[k] = v; return { key: k }; },
        get: async (k) => { if (!(k in mockDb)) throw new Error("not found"); return { key: k, value: mockDb[k] }; },
        delete: async (k) => { delete mockDb[k]; },
        list: async (prefix) => ({ keys: Object.keys(mockDb).filter(k => k.startsWith(prefix || "")) }),
      };
    },
  });
  const { window } = dom;
  await new Promise(r => setTimeout(r, 200));
  const doc = window.document;
  const fail = m => { console.log("FAIL:", m); process.exit(1); };
  const set = (id, v) => { const el = doc.getElementById(id); el.value = v; el.dispatchEvent(new window.Event(el.tagName==="SELECT"?"change":"input", { bubbles: true })); };
  const goto = view => doc.querySelector(`nav.side button[data-view="${view}"]`).dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  const main = () => doc.getElementById("main").innerHTML;
  const records = () => Object.entries(mockDb).filter(([k])=>k.startsWith("evaluation:")).map(([,v])=>JSON.parse(v));

  // New option lists render
  if (doc.getElementById("p-credit")) fail("credit limit field should be removed");
  const opts = id => [...doc.getElementById(id).options].map(o=>o.textContent).slice(1);
  console.log("MOQ options:", opts("p-moq").join(", "));
  if (opts("p-moq").length !== 7 || opts("p-leadTime")[0] !== "7 weeks" || opts("p-netTerms")[4] !== "Net 75") fail("new procurement options missing");

  // Scoring: Net 75 is best, Net 0 worst; 7-option MOQ still scores within 1..5
  const bs = (list, i) => window.eval(`bandScore(OPTS.${list}, "${i}")`);
  if (bs("netTerms", 4) !== 5 || bs("netTerms", 0) !== 1 || bs("moq", 0) !== 5 || bs("moq", 6) !== 1 || bs("leadTime", 5) !== 1) fail("band scoring wrong");

  // Partial evaluation: Submit refuses, record stays a draft, not shown in By Product
  set("f-supplier", "Partial Co"); set("f-product", "Widget");
  set("q-gmpMatch", "0");
  doc.getElementById("btn-save").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await new Promise(r => setTimeout(r, 300));
  const partial = records().find(r=>r.supplier==="Partial Co");
  console.log("Partial evaluation status:", partial && partial.status, "| fields flagged:", doc.querySelectorAll(".missing").length);
  if (!partial || partial.status !== "draft") fail("incomplete evaluation should be saved as a draft");
  if (!doc.querySelectorAll(".missing").length) fail("missing fields should be highlighted");

  // Complete it: now it submits
  set("p-actualCost", "5"); ["p-netTerms","p-deposit","p-moq","p-leadTime"].forEach(id=>set(id, "1"));
  ["q-testingCapacity","q-labelReviewer"].forEach(id=>set(id, "1"));
  ["q-responsivenessResolution","q-productQuality","q-coaTurnaround"].forEach(id=>set(id, "na"));
  doc.getElementById("btn-save").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await new Promise(r => setTimeout(r, 400));
  const done = records().find(r=>r.supplier==="Partial Co");
  console.log("Completed evaluation status:", done.status, "| QC completeness:", done.computed.completenessQC);
  if (done.status !== "submitted") fail("fully answered evaluation (with N/A track record) should submit");

  // Draft-only supplier never appears in By Product; legacy record migrated to Ongoing
  goto("new"); await new Promise(r => setTimeout(r, 100));
  set("f-supplier", "Draft Only Co"); set("f-product", "Widget");
  await new Promise(r => setTimeout(r, 1000));
  goto("byproduct"); await new Promise(r => setTimeout(r, 200));
  console.log("By Product shows submitted:", main().includes("Partial Co"), "| draft:", main().includes("Draft Only Co"), "| legacy:", main().includes("Legacy Co"));
  if (!main().includes("Partial Co") || main().includes("Draft Only Co") || main().includes("Legacy Co")) fail("By Product should list submitted evaluations only");
  goto("ongoing"); await new Promise(r => setTimeout(r, 200));
  if (!main().includes("Legacy Co") || !main().includes("Draft Only Co")) fail("drafts and migrated records belong in Ongoing");
  const legacy = window.eval(`migrateRecord(${JSON.stringify(oldRecord)})`);
  console.log("Legacy net terms (old Net 30 -> new):", legacy.proc.netTerms, "| deposit cleared:", legacy.proc.deposit === "", "| credit removed:", !("credit" in legacy.proc));
  if (legacy.proc.netTerms !== "1" || legacy.proc.deposit !== "" || "credit" in legacy.proc) fail("legacy migration wrong");

  console.log("PASS: submission requires every answer, drafts stay in Ongoing, legacy records migrate.");
  process.exit(0);
})().catch(e => { console.error("TEST THREW:", e); process.exit(1); });
