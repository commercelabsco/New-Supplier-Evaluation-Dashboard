// Generates the Supabase anon key (and the service key, as a check) from the JWT secret.
// Run:  node scripts/make-anon-key.mjs <JWT secret>
// Coolify: the JWT secret is the SERVICE_PASSWORD_JWT (or JWT_SECRET) environment variable.
// If the printed service key matches the one you already have, the anon key is correct.
import crypto from "node:crypto";
const secret = process.argv[2];
if (!secret) { console.error("Usage: node scripts/make-anon-key.mjs <JWT secret>"); process.exit(1); }
const b64 = o => Buffer.from(JSON.stringify(o)).toString("base64url");
const sign = role => {
  const h = b64({ typ: "JWT", alg: "HS256" });
  const p = b64({ iss: "supabase", iat: 1794807960, exp: 4950481560, role });
  return `${h}.${p}.${crypto.createHmac("sha256", secret).update(`${h}.${p}`).digest("base64url")}`;
};
console.log("ANON KEY (put in storage.js, safe to share):\n" + sign("anon"));
console.log("\nSERVICE KEY (check only - should match your existing one, keep secret):\n" + sign("service_role"));
