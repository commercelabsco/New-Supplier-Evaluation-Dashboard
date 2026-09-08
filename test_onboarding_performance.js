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

  function goto(view){
    const btn = Array.from(doc.querySelectorAll("nav.side button")).find(b => b.getAttribute("data-view") === view);
    btn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  }

  // --- New Supplier: only onboarding-assessable criteria answered ---
  doc.getElementById("f-supplier").value = "Brand New Co";
  doc.getElementById("f-supplier").dispatchEvent(new window.Event("input", { bubbles: true }));
  doc.getElementById("f-product").value = "Product Delta";
  doc.getElementById("f-product").dispatchEvent(new window.Event("input", { bubbles: true }));
  doc.getElementById("q-testingCapacity").value = "0"; // score 5
  doc.getElementById("q-testingCapacity").dispatchEvent(new window.Event("change", { bubbles: true }));
  doc.getElementById("q-gmpMatch").value = "1"; // score 4
  doc.getElementById("q-gmpMatch").dispatchEvent(new window.Event("change", { bubbles: true }));
  doc.getElementById("q-labelReviewer").value = "0"; // score 5
  doc.getElementById("q-labelReviewer").dispatchEvent(new window.Event("change", { bubbles: true }));
  // Deliberately leave responsivenessResolution, productQuality, coaTurnaround unanswered
  doc.getElementById("btn-preview").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await new Promise(r => setTimeout(r, 100));

  const previewHtml = doc.getElementById("preview-box").innerHTML;
  console.log("New supplier preview shows an Onboarding Score:", /Onboarding Score.*\d+%/.test(previewHtml));
  console.log("New supplier preview shows 'No track record yet' for Performance:", previewHtml.includes("No track record yet"));
  if (!previewHtml.includes("No track record yet")) {
    console.log("FAIL: new supplier with no track-record answers should show 'No track record yet'."); process.exit(1);
  }

  doc.getElementById("btn-save").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await new Promise(r => setTimeout(r, 300));

  const newSupplierRecord = Object.values(mockDb).map(v=>{try{return JSON.parse(v);}catch(e){return null;}}).find(r=>r && r.supplier==="Brand New Co");
  console.log("New supplier onboardingScore:", newSupplierRecord.computed.onboardingScore);
  console.log("New supplier performanceScore (expect null):", newSupplierRecord.computed.performanceScore);
  if (newSupplierRecord.computed.onboardingScore === null) { console.log("FAIL: onboarding score should be computable."); process.exit(1); }
  if (newSupplierRecord.computed.performanceScore !== null) { console.log("FAIL: performance score should be null (no track record)."); process.exit(1); }

  // --- Existing Supplier: all 6 criteria answered ---
  goto("new"); await new Promise(r => setTimeout(r, 150));
  doc.getElementById("f-supplier").value = "Established Co";
  doc.getElementById("f-supplier").dispatchEvent(new window.Event("input", { bubbles: true }));
  doc.getElementById("f-product").value = "Product Delta";
  doc.getElementById("f-product").dispatchEvent(new window.Event("input", { bubbles: true }));
  ["q-testingCapacity","q-gmpMatch","q-responsivenessResolution","q-productQuality","q-coaTurnaround","q-labelReviewer"].forEach(id=>{
    doc.getElementById(id).value = "1";
    doc.getElementById(id).dispatchEvent(new window.Event("change", { bubbles: true }));
  });
  doc.getElementById("btn-save").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await new Promise(r => setTimeout(r, 300));

  const existingSupplierRecord = Object.values(mockDb).map(v=>{try{return JSON.parse(v);}catch(e){return null;}}).find(r=>r && r.supplier==="Established Co");
  console.log("Existing supplier onboardingScore:", existingSupplierRecord.computed.onboardingScore);
  console.log("Existing supplier performanceScore:", existingSupplierRecord.computed.performanceScore);
  if (existingSupplierRecord.computed.onboardingScore === null || existingSupplierRecord.computed.performanceScore === null) {
    console.log("FAIL: established supplier with all 6 answered should have both scores."); process.exit(1);
  }

  // --- Compare grid should show both rows for a new-vs-existing comparison ---
  goto("byproduct"); await new Promise(r => setTimeout(r, 200));
  const compareBtn = doc.querySelector('[data-count="2"]');
  compareBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  const mainHtml = doc.getElementById("main").innerHTML;
  console.log("Compare grid shows Onboarding Score row:", mainHtml.includes("Onboarding Score"));
  console.log("Compare grid shows Performance Score row:", mainHtml.includes("Performance Score"));
  console.log("Compare grid shows 'No track record yet' for the new supplier:", mainHtml.includes("No track record yet"));
  if (!mainHtml.includes("Onboarding Score") || !mainHtml.includes("Performance Score")) {
    console.log("FAIL: compare grid missing the new score rows."); process.exit(1);
  }

  console.log("PASS: Onboarding vs Performance scores computed correctly for new-vs-existing supplier scenario.");
  process.exit(0);
})().catch(e => { console.error("TEST THREW:", e); process.exit(1); });
