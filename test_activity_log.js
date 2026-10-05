const { JSDOM } = require("jsdom");
const fs = require("fs");

// Activity log: records who created/edited/submitted an evaluation, with field-level
// previous/new values; rapid edits by one person merge into a single entry.
(async () => {
  const html = fs.readFileSync("./index.html", "utf8");
  const mockDb = {};
  const dom = new JSDOM(html, {
    runScripts: "dangerously", resources: "usable", url: "https://example.com/",
    beforeParse(window) {
      window.__user = { name: "Rowena Sison" };
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
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const activity = () => Object.entries(mockDb).filter(([k])=>k.startsWith("activity:")).map(([,v])=>JSON.parse(v)).sort((a,b)=>a.at-b.at);

  // Required markers and weights render on the form
  if (!doc.querySelectorAll(".req").length) fail("required markers missing");
  if (!doc.getElementById("main").innerHTML.includes("Required field")) fail("required-field note missing");

  set("f-supplier", "Viva"); set("f-product", "Gummies");
  await wait(1000);
  set("p-netTerms", "1"); // Net 30
  await wait(1000);
  set("p-netTerms", "2"); // Net 45
  await wait(1000);
  let log = activity();
  console.log("Entries after create + 2 edits:", log.map(e=>e.action+"("+e.changes.map(c=>c.field+": "+c.from+" -> "+c.to).join("; ")+")").join(" | "));
  if (log.length !== 1 || log[0].action !== "Created" || log[0].by !== "Rowena Sison") fail("rapid edits by one person should merge into the Created entry");
  const net = log[0].changes.find(c=>c.field==="Balance net terms");
  if (!net || net.to !== "Net 45") fail("merged entry should hold the latest value");

  // A different person's edit is its own entry with previous -> new values
  window.__user.name = "Gino";
  set("p-netTerms", "3"); // Net 60
  await wait(1000);
  log = activity();
  const gino = log.find(e=>e.by==="Gino");
  console.log("Gino's entry:", gino && gino.action, JSON.stringify(gino && gino.changes));
  if (!gino || gino.action !== "Edited" || gino.changes[0].from !== "Net 45" || gino.changes[0].to !== "Net 60") fail("second editor should get their own entry");

  // Record shows created/last edited by
  const rec = Object.entries(mockDb).filter(([k])=>k.startsWith("evaluation:")).map(([,v])=>JSON.parse(v))[0];
  console.log("Created by:", rec.createdBy, "| last edited by:", rec.updatedBy);
  if (rec.createdBy !== "Rowena Sison" || rec.updatedBy !== "Gino") fail("created/last-edited attribution wrong");

  // Activity panel renders from Ongoing
  doc.querySelector('nav.side button[data-view="ongoing"]').dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await wait(300);
  if (!doc.getElementById("main").innerHTML.includes("Gino")) fail("Ongoing should show who last edited");
  doc.querySelector("[data-activity]").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await wait(300);
  const panel = doc.querySelector("[data-activity-for] td").textContent;
  if (!panel.includes("Previous value") || !panel.includes("Net 60")) fail("activity panel should list changes");

  console.log("PASS: activity log records who changed what and when.");
  process.exit(0);
})().catch(e => { console.error("TEST THREW:", e); process.exit(1); });
