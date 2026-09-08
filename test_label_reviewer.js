const { JSDOM } = require("jsdom");
const fs = require("fs");

(async () => {
  const html = fs.readFileSync("./index.html", "utf8");
  const mockDb = {};
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

  // 1. Confirm QC_WEIGHTS still sum to exactly 30
  const qcSum = Object.values(window.QC_WEIGHTS || {}).reduce((a,b)=>a+b, 0);
  // QC_WEIGHTS isn't on window by default (not attached) - read via eval in page context instead
  const qcSumViaEval = window.eval("Object.values(QC_WEIGHTS).reduce((a,b)=>a+b,0)");
  console.log("QC_WEIGHTS sum (expect 30):", qcSumViaEval);
  if (qcSumViaEval !== 30) { console.log("FAIL: QC weights no longer sum to 30."); process.exit(1); }

  // 2. Confirm the Label Reviewer field renders in the form
  const labelReviewerSelect = doc.getElementById("q-labelReviewer");
  console.log("Label Reviewer select exists in form:", !!labelReviewerSelect);
  if (!labelReviewerSelect) { console.log("FAIL: q-labelReviewer select not found."); process.exit(1); }
  const optionCount = labelReviewerSelect.querySelectorAll("option").length;
  console.log("Label Reviewer option count (expect 6 incl. 'Not answered'):", optionCount);

  // 3. Fill and submit an evaluation using the new field, verify scoring
  doc.getElementById("f-supplier").value = "Test Supplier";
  doc.getElementById("f-supplier").dispatchEvent(new window.Event("input", { bubbles: true }));
  doc.getElementById("f-product").value = "Test Product";
  doc.getElementById("f-product").dispatchEvent(new window.Event("input", { bubbles: true }));
  doc.getElementById("q-labelReviewer").value = "0"; // best option, score 5
  doc.getElementById("q-labelReviewer").dispatchEvent(new window.Event("change", { bubbles: true }));
  doc.getElementById("btn-save").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await new Promise(r => setTimeout(r, 300));

  const saved = JSON.parse(mockDb[Object.keys(mockDb).find(k=>k.startsWith("evaluation:"))]);
  console.log("Saved qc.labelReviewer:", saved.qc.labelReviewer);
  console.log("Computed QC total (only labelReviewer answered, should rescale to fill 30):", saved.computed.qcTotal);
  // Only labelReviewer answered (weight 6) -> rescale factor = 30/6 = 5 -> score(5/5)*6*5 = 30
  if (Math.abs(saved.computed.qcTotal - 30) > 0.01) {
    console.log("FAIL: expected QC total 30 when only labelReviewer (best score) answered."); process.exit(1);
  }

  console.log("PASS: Label Reviewer criterion integrated correctly (weights, form, scoring).");
  process.exit(0);
})().catch(e => { console.error("TEST THREW:", e); process.exit(1); });
