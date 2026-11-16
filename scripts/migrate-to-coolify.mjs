// Copies everything from Supabase cloud to the self-hosted Supabase on Coolify:
//   1. every row of the "kv" table (evaluations, suppliers, activity log, EVAL-### counter)
//   2. every file in the "attachments" bucket, at the same path
// Nothing is changed or deleted on the old (cloud) project. Safe to re-run:
// rows and files that already exist on the new side are overwritten with the cloud copy.
//
// Run (Node 18+, no npm install needed):
//   OLD_URL=https://abqqovogbmpkodubkrdu.supabase.co \
//   OLD_KEY=<cloud service_role / secret key> \
//   NEW_URL=https://<your-coolify-supabase-domain> \
//   NEW_KEY=<coolify SERVICE_ROLE_KEY> \
//   node scripts/migrate-to-coolify.mjs
//
// Use the SERVICE ROLE / SECRET keys (not anon): they bypass the row-level
// security rules so every row and file can be read and written. Never commit them.

const { OLD_URL, OLD_KEY, NEW_URL, NEW_KEY } = process.env;
if (!OLD_URL || !OLD_KEY || !NEW_URL || !NEW_KEY) {
  console.error("Set OLD_URL, OLD_KEY, NEW_URL and NEW_KEY (see top of this file).");
  process.exit(1);
}
const BUCKET = "attachments";
const strip = u => u.replace(/\/+$/, "");
const OLD = { url: strip(OLD_URL), key: OLD_KEY, name: "cloud" };
const NEW = { url: strip(NEW_URL), key: NEW_KEY, name: "coolify" };
const headers = (s, extra = {}) => ({ apikey: s.key, Authorization: `Bearer ${s.key}`, ...extra });
const encPath = p => p.split("/").map(encodeURIComponent).join("/");

async function req(s, path, opts = {}) {
  const res = await fetch(s.url + path, { ...opts, headers: headers(s, opts.headers) });
  if (!res.ok) throw new Error(`${s.name} ${opts.method || "GET"} ${path} -> ${res.status} ${await res.text()}`);
  return res;
}

// ---------- 1. kv table ----------
async function copyKv() {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const res = await req(OLD, `/rest/v1/kv?select=key,value,updated_at&order=key&offset=${from}&limit=1000`);
    const page = await res.json();
    rows.push(...page);
    if (page.length < 1000) break;
  }
  console.log(`kv: ${rows.length} rows found on cloud`);
  for (let i = 0; i < rows.length; i += 500) {
    await req(NEW, "/rest/v1/kv", {
      method: "POST",
      headers: { "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(rows.slice(i, i + 500)),
    });
  }
  const check = await req(NEW, "/rest/v1/kv?select=key", { headers: { Prefer: "count=exact", Range: "0-0" } });
  const total = (check.headers.get("content-range") || "").split("/")[1];
  console.log(`kv: copied ${rows.length} rows; coolify now has ${total} rows`);
  return rows.length;
}

// ---------- 2. attachments bucket ----------
async function ensureBucket() {
  const res = await fetch(`${NEW.url}/storage/v1/bucket/${BUCKET}`, { headers: headers(NEW) });
  if (res.ok) return;
  await req(NEW, "/storage/v1/bucket", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: BUCKET, name: BUCKET, public: false, file_size_limit: 52428800 }),
  });
  console.log(`attachments: created private "${BUCKET}" bucket on coolify`);
}

async function listAll(s, prefix = "") {
  const files = [];
  for (let offset = 0; ; offset += 100) {
    const res = await req(s, `/storage/v1/object/list/${BUCKET}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prefix, limit: 100, offset, sortBy: { column: "name", order: "asc" } }),
    });
    const items = await res.json();
    for (const it of items) {
      const full = prefix ? `${prefix}/${it.name}` : it.name;
      if (it.id === null) files.push(...await listAll(s, full)); // folder
      else files.push({ path: full, type: it.metadata?.mimetype });
    }
    if (items.length < 100) break;
  }
  return files;
}

async function copyAttachments() {
  await ensureBucket();
  const files = await listAll(OLD);
  console.log(`attachments: ${files.length} files found on cloud`);
  let done = 0; const failed = [];
  for (const f of files) {
    try {
      const dl = await req(OLD, `/storage/v1/object/${BUCKET}/${encPath(f.path)}`);
      const body = Buffer.from(await dl.arrayBuffer());
      await req(NEW, `/storage/v1/object/${BUCKET}/${encPath(f.path)}`, {
        method: "POST",
        headers: { "Content-Type": f.type || dl.headers.get("content-type") || "application/octet-stream", "x-upsert": "true" },
        body,
      });
      done++;
      if (done % 10 === 0 || done === files.length) console.log(`attachments: ${done}/${files.length}`);
    } catch (e) {
      failed.push(f.path); console.error(`attachments: FAILED ${f.path}: ${e.message}`);
    }
  }
  const after = await listAll(NEW);
  console.log(`attachments: copied ${done}/${files.length}; coolify bucket now has ${after.length} files`);
  return failed;
}

const kvCount = await copyKv();
const failed = await copyAttachments();
console.log("\n=== Done ===");
console.log(`kv rows copied: ${kvCount}`);
if (failed.length) { console.log(`Files that failed (re-run the script to retry):\n  ${failed.join("\n  ")}`); process.exit(1); }
console.log("All attachments copied. Cloud data was not changed.");
