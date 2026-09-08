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
  function fillAndSubmit(supplier, product, val){
    doc.getElementById("f-supplier").value = supplier;
    doc.getElementById("f-supplier").dispatchEvent(new window.Event("input", { bubbles: true }));
    doc.getElementById("f-product").value = product;
    doc.getElementById("f-product").dispatchEvent(new window.Event("input", { bubbles: true }));
    doc.getElementById("q-testingCapacity").value = val;
    doc.getElementById("q-testingCapacity").dispatchEvent(new window.Event("change", { bubbles: true }));
    doc.getElementById("btn-save").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  }

  // Submit 3 distinct evaluations, expect ref numbers 1, 2, 3 in order
  fillAndSubmit("Supplier One", "Product Alpha", "0");
  await new Promise(r => setTimeout(r, 300));
  goto("new"); await new Promise(r => setTimeout(r, 150));
  fillAndSubmit("Supplier Two", "Product Alpha", "1");
  await new Promise(r => setTimeout(r, 300));
  goto("new"); await new Promise(r => setTimeout(r, 150));
  fillAndSubmit("Supplier Three", "Product Beta", "2");
  await new Promise(r => setTimeout(r, 300));

  const records = Object.values(mockDb).filter(v=>{ try{ return JSON.parse(v).refNumber; }catch(e){return false;} }).map(v=>JSON.parse(v));
  const refsBySupplier = Object.fromEntries(records.map(r=>[r.supplier, r.refNumber]));
  console.log("Ref numbers assigned:", refsBySupplier);
  if (refsBySupplier["Supplier One"] !== 1 || refsBySupplier["Supplier Two"] !== 2 || refsBySupplier["Supplier Three"] !== 3) {
    console.log("FAIL: ref numbers did not assign sequentially (1,2,3)."); process.exit(1);
  }

  // Check By Product table displays them correctly
  goto("byproduct"); await new Promise(r => setTimeout(r, 200));
  let mainHtml = doc.getElementById("main").innerHTML;
  console.log("By Product shows EVAL-001:", mainHtml.includes("EVAL-001"));
  console.log("By Product shows EVAL-002:", mainHtml.includes("EVAL-002"));
  console.log("By Product shows EVAL-003:", mainHtml.includes("EVAL-003"));
  if (!mainHtml.includes("EVAL-001") || !mainHtml.includes("EVAL-002") || !mainHtml.includes("EVAL-003")) {
    console.log("FAIL: By Product missing expected ref numbers."); process.exit(1);
  }

  // Edit Supplier One (already submitted) and confirm its ref number DOESN'T change
  const editBtn = Array.from(doc.querySelectorAll("[data-edit]"))[0];
  editBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await new Promise(r => setTimeout(r, 200));
  console.log("Editing title shows ref number:", doc.querySelector("h1").textContent);

  doc.getElementById("q-gmpMatch").value = "1";
  doc.getElementById("q-gmpMatch").dispatchEvent(new window.Event("change", { bubbles: true }));
  await new Promise(r => setTimeout(r, 1000));

  const supplierOneRecord = Object.values(mockDb).map(v=>JSON.parse(v)).find(r=>r.supplier==="Supplier One");
  console.log("Supplier One ref number after edit (should still be 1):", supplierOneRecord.refNumber);
  if (supplierOneRecord.refNumber !== 1) { console.log("FAIL: ref number changed after editing an existing record."); process.exit(1); }

  // Check total record count is still 3 (no duplicate created during edit)
  const totalRecords = Object.values(mockDb).map(v=>JSON.parse(v)).filter(r=>r.refNumber).length;
  console.log("Total evaluation records after edit (should still be 3):", totalRecords);
  if (totalRecords !== 3) { console.log("FAIL: editing created a duplicate record."); process.exit(1); }

  // Ongoing view: create a new draft (partial fill, no submit) and check ref number + display
  goto("new"); await new Promise(r => setTimeout(r, 150));
  doc.getElementById("f-supplier").value = "Supplier Four";
  doc.getElementById("f-supplier").dispatchEvent(new window.Event("input", { bubbles: true }));
  doc.getElementById("f-product").value = "Product Gamma";
  doc.getElementById("f-product").dispatchEvent(new window.Event("input", { bubbles: true }));
  await new Promise(r => setTimeout(r, 1000)); // wait for debounced autosave

  goto("ongoing"); await new Promise(r => setTimeout(r, 200));
  mainHtml = doc.getElementById("main").innerHTML;
  console.log("Ongoing shows EVAL-004 for the new draft:", mainHtml.includes("EVAL-004"));
  if (!mainHtml.includes("EVAL-004")) { console.log("FAIL: Ongoing draft did not get ref number 4."); process.exit(1); }

  console.log("PASS: sequential reference numbers work correctly across create, edit, and both list views.");
  process.exit(0);
})().catch(e => { console.error("TEST THREW:", e); process.exit(1); });
