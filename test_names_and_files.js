const { JSDOM } = require("jsdom");
const fs = require("fs");

// Supplier/product dropdowns, renaming across evaluations, and attachments.
(async () => {
  const html = fs.readFileSync("./index.html", "utf8");
  const mockDb = {}, files = {};
  const dom = new JSDOM(html, {
    runScripts: "dangerously", resources: "usable", url: "https://example.com/",
    beforeParse(window) {
      window.__user = { name: "Rowena Sison" };
      window.storage = {
        set: async (k, v) => { mockDb[k] = v; return { key: k }; },
        get: async (k) => { if (!(k in mockDb)) throw new Error("not found"); return { key: k, value: mockDb[k] }; },
        delete: async (k) => { delete mockDb[k]; },
        list: async (prefix) => ({ keys: Object.keys(mockDb).filter(k => k.startsWith(prefix || "")) }),
        files: {
          upload: async (path, file) => { files[path] = file.name; },
          signedUrl: async (path) => "https://files.example/" + path,
          remove: async (path) => { delete files[path]; },
        },
      };
    },
  });
  const { window } = dom;
  const doc = window.document;
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const fail = m => { console.log("FAIL:", m); process.exit(1); };
  const set = (id, v) => { const el = doc.getElementById(id); el.value = v; el.dispatchEvent(new window.Event(el.tagName==="SELECT"?"change":"input", { bubbles: true })); };
  const goto = v => doc.querySelector(`nav.side button[data-view="${v}"]`).dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  const evals = () => Object.entries(mockDb).filter(([k])=>k.startsWith("evaluation:")).map(([,v])=>JSON.parse(v));
  const activity = () => Object.entries(mockDb).filter(([k])=>k.startsWith("activity:")).map(([,v])=>JSON.parse(v));
  await wait(200);

  // First evaluation: no names yet, so plain text boxes
  if (doc.getElementById("f-supplier").style.display === "none") fail("text box should show when there are no saved names");
  set("f-supplier", "Blue Mountain"); set("f-product", "Saffron Gummies");
  set("f-supplierStatus", "existing"); set("f-productStatus", "new");
  await wait(1000);

  // Next form: dropdowns list saved names plus "+ Add new"
  goto("ongoing"); await wait(200); goto("new"); await wait(300);
  const pick = doc.getElementById("f-supplier-pick");
  const optTexts = [...pick.options].map(o=>o.textContent);
  console.log("Supplier dropdown:", optTexts.join(" | "));
  if (pick.style.display === "none" || !optTexts.includes("Blue Mountain") || !optTexts.some(t=>t.includes("Add new"))) fail("supplier dropdown should list saved names");
  set("f-supplier-pick", "Blue Mountain");
  if (doc.getElementById("f-supplier").value !== "Blue Mountain") fail("choosing a name should fill the supplier");
  console.log("Supplier type remembered for Blue Mountain:", doc.getElementById("f-supplierStatus").value);
  if (doc.getElementById("f-supplierStatus").value !== "existing") fail("picking a known supplier should fill in its type");
  set("f-supplierStatus", "");
  set("f-supplier-pick", "__new");
  if (doc.getElementById("f-supplier").style.display === "none") fail("'+ Add new' should show the text box");
  set("f-supplier", "Viva"); set("f-product-pick", "Saffron Gummies");
  await wait(1000);
  console.log("Saved:", evals().map(e=>e.supplier+" / "+e.product).join(", "));
  if (evals().filter(e=>e.product==="Saffron Gummies").length !== 2) fail("both evaluations should share the picked product");

  // Rename product and supplier across evaluations
  const n = await window.eval(`renameAcross("product", "saffron gummies", "Nusava Saffron Gummies")`);
  await window.eval(`renameAcross("supplier", "Blue Mountain", "Blue Mountain Labs")`);
  console.log("Renamed product on", n, "evaluations ->", evals().map(e=>e.supplier+" / "+e.product).join(", "));
  if (n !== 2 || evals().some(e=>e.product!=="Nusava Saffron Gummies") || !evals().some(e=>e.supplier==="Blue Mountain Labs")) fail("rename should update every matching evaluation");
  if (!activity().some(a=>a.changes.some(c=>c.field==="Product" && c.to==="Nusava Saffron Gummies"))) fail("rename should be in the activity log");

  // Attachments: upload, list, count, remove (and logged)
  const id = evals()[0].id;
  window.__file = new window.File(["%PDF-1.4 quote"], "Quote Oct.pdf", { type: "application/pdf" });
  await window.eval(`uploadAttachment("${id}", window.__file)`);
  let list = await window.eval(`listAttachments("${id}")`);
  const counts = await window.eval(`attachmentCounts()`);
  console.log("Attachments:", list.map(a=>a.name+" by "+a.uploadedBy).join(", "), "| count:", counts[id], "| stored files:", Object.keys(files).length);
  if (list.length !== 1 || list[0].uploadedBy !== "Rowena Sison" || counts[id] !== 1 || Object.keys(files).length !== 1) fail("upload should store the file and its details");
  goto("ongoing"); await wait(300);
  if (!doc.getElementById("main").innerHTML.includes("Files (1)")) fail("row should show the file count");
  await window.eval(`listAttachments("${id}").then(l=>removeAttachment(l[0]))`);
  list = await window.eval(`listAttachments("${id}")`);
  if (list.length || Object.keys(files).length) fail("delete should remove the file");
  const acts = activity().map(a=>a.action);
  if (!acts.includes("Attached file") || !acts.includes("Removed file")) fail("file uploads/removals should be logged");

  console.log("PASS: name dropdowns, renaming and attachments work.");
  process.exit(0);
})().catch(e => { console.error("TEST THREW:", e); process.exit(1); });
