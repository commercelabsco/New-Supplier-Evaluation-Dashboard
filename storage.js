/* ============================================================
   SUPABASE STORAGE ADAPTER
   Provides the window.storage interface (get / set / list / delete)
   that index.html expects (loaded by index.html), backed by a Supabase "kv" table so data is
   shared across users and survives refreshes when hosted on GitHub Pages.

   Setup: see SETUP.md. Fill in the two values below with your project's
   URL and anon (public) key. Until they're filled in, window.storage is
   left undefined and the dashboard falls back to in-memory mode.
   ============================================================ */
const SUPABASE_URL = "https://abqqovogbmpkodubkrdu.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_W5oJ15kbMcWqPmwIEa8E4A_PaZ3FaKR"; // Settings -> API Keys -> Publishable key (safe to be public)
const ALLOWED_EMAIL_DOMAIN = "commercelabs.co";

window.initStorage = async function(){
  if(SUPABASE_URL.startsWith("YOUR_") || SUPABASE_ANON_KEY.startsWith("YOUR_") || typeof supabase === "undefined") return;

  const client = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data: { session } } = await client.auth.getSession();
  if(!session){ await showLogin(client); return new Promise(()=>{}); } // page reloads after login

  // list() fetches values too; get() reuses them briefly so rendering a
  // table doesn't cost one request per row.
  const cache = new Map();
  const CACHE_MS = 5000;

  window.storage = {
    async get(key){
      const hit = cache.get(key);
      if(hit && Date.now()-hit.at < CACHE_MS) return { key, value: hit.value };
      const { data, error } = await client.from("kv").select("value").eq("key", key).maybeSingle();
      if(error) throw new Error(error.message);
      return data ? { key, value: data.value } : null;
    },
    async set(key, value){
      const { error } = await client.from("kv").upsert({ key, value, updated_at: new Date().toISOString() });
      if(error) throw new Error(error.message);
      cache.set(key, { value, at: Date.now() });
      return { key };
    },
    async delete(key){
      const { error } = await client.from("kv").delete().eq("key", key);
      if(error) throw new Error(error.message);
      cache.delete(key);
    },
    async list(prefix){
      const escaped = (prefix||"").replace(/[\\%_]/g, m=>"\\"+m);
      const { data, error } = await client.from("kv").select("key,value").like("key", escaped+"%");
      if(error) throw new Error(error.message);
      const now = Date.now();
      data.forEach(r=>cache.set(r.key, { value: r.value, at: now }));
      return { keys: data.map(r=>r.key) };
    },
    // Atomic counter (see SETUP.md) so two people submitting at once never share a ref number.
    async increment(key){
      const { data, error } = await client.rpc("kv_increment", { counter_key: key });
      if(error) throw new Error(error.message);
      cache.delete(key);
      return data;
    },
  };

  window.__user = { name: session.user.email }; // recorded as createdBy / updatedBy / submittedBy
  addSignOut(client, session.user.email);
};

function showLogin(client){
  const field = "width:100%;padding:10px;font-size:14px;border:1px solid var(--border,#DFE3E7);border-radius:6px;margin-bottom:12px;background:var(--field,#fff);color:var(--ink,#1C2B39);";
  const wrap = document.createElement("div");
  wrap.style.cssText = "position:fixed;inset:0;background:var(--bg,#F3F5F7) var(--pattern,none) repeat;display:flex;align-items:center;justify-content:center;z-index:1000;padding:16px;";
  wrap.innerHTML = `
    <form style="background:var(--panel,#fff);border:1px solid var(--border,#DFE3E7);border-radius:8px;padding:28px;max-width:380px;width:100%;font-family:var(--sans,sans-serif);">
      <h2 style="margin:0 0 6px;font-family:var(--serif,serif);">Supplier Evaluation Dashboard</h2>
      <p style="margin:0 0 18px;color:var(--ink-soft,#55606B);font-size:14px;">Sign in with your team username and password.</p>
      <input name="user" type="text" required autocomplete="username" placeholder="Username or @${ALLOWED_EMAIL_DOMAIN} email" style="${field}">
      <input name="pass" type="password" autocomplete="current-password" placeholder="Password" style="${field}">
      <button class="btn" type="submit" style="width:100%;">Sign in</button>
      <p class="msg" style="margin:12px 0 0;font-size:13px;color:var(--ink-soft,#55606B);"></p>
      <p style="margin:14px 0 0;font-size:12px;"><a href="#" class="magic" style="color:var(--accent,#2F6690);">Email me a login link instead</a></p>
    </form>`;
  document.body.appendChild(wrap);
  const form = wrap.querySelector("form"), msg = wrap.querySelector(".msg"), btn = form.querySelector("button");
  const userInput = form.querySelector("[name=user]"), passInput = form.querySelector("[name=pass]");
  // A bare username like "supplierteam" means supplierteam@commercelabs.co.
  const emailFrom = v => { v = v.trim().toLowerCase(); return v.includes("@") ? v : v+"@"+ALLOWED_EMAIL_DOMAIN; };

  form.addEventListener("submit", async ev=>{
    ev.preventDefault();
    const email = emailFrom(userInput.value);
    if(!passInput.value){ msg.textContent = "Enter your password."; return; }
    btn.disabled = true; msg.textContent = "Signing in…";
    const { error } = await client.auth.signInWithPassword({ email, password: passInput.value });
    btn.disabled = false;
    if(error) msg.textContent = /invalid/i.test(error.message) ? "Wrong username or password." : "Couldn't sign in: "+error.message;
  });

  const magic = form.querySelector(".magic");
  magic.addEventListener("click", async ev=>{
    ev.preventDefault();
    if(magic.dataset.busy) return;
    const email = emailFrom(userInput.value);
    if(!userInput.value.trim() || !email.endsWith("@"+ALLOWED_EMAIL_DOMAIN)){ msg.textContent = "Type your @"+ALLOWED_EMAIL_DOMAIN+" email above first."; return; }
    magic.dataset.busy = "1"; msg.textContent = "Sending…";
    const { error } = await client.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname } });
    msg.textContent = error
      ? (/after \d+ seconds/.test(error.message) ? "A login link was already sent — check your inbox (and spam)." : "Couldn't send link: "+error.message)
      : "Login link sent to "+email+" — check your inbox (and spam folder).";
    setTimeout(()=>{ delete magic.dataset.busy; }, 60000);
  });

  client.auth.onAuthStateChange((event)=>{ if(event==="SIGNED_IN") location.reload(); });
}

function addSignOut(client, email){
  const nav = document.querySelector("nav.side");
  if(!nav) return;
  const box = document.createElement("div");
  box.style.cssText = "padding:18px 22px;font-size:11px;color:#8FA2AF;border-top:1px solid rgba(255,255,255,.12);margin-top:18px;";
  box.innerHTML = `<div style="word-break:break-all;margin-bottom:6px;"></div><a href="#" style="color:#B9C6CE;">Sign out</a>`;
  box.firstElementChild.textContent = email;
  box.querySelector("a").addEventListener("click", async ev=>{ ev.preventDefault(); await client.auth.signOut(); location.reload(); });
  nav.appendChild(box);
}
