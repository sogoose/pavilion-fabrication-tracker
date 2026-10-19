// Workflow password editor API. This runs on Supabase Edge, never in public GitHub Pages.
// The hashed password and signing key are stored in a private, RLS-enabled table.
// This API does NOT change or authorize the open-to-team Pavilion Tracker.
import { createClient } from "npm:@supabase/supabase-js@2";

const ORIGIN = "https://sogoose.github.io";
const PROJECT = "pavilion-2026";
const ALLOWED_SECTIONS = new Set([
  "__page", "spatial", "structural", "gcode", "material",
  "printing", "rammed", "firing", "assembly",
  "computational", "construction", "environment", "hrc"
]);
const corsHeaders = {
  "Access-Control-Allow-Origin": ORIGIN,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, apikey, authorization, x-client-info",
  "Vary": "Origin",
  "Cache-Control": "no-store",
};
const url = Deno.env.get("SUPABASE_URL");
const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const admin = url && key ? createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false }
}) : null;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

const respond = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" }
  });
const hexBytes = (hex: string) => {
  if (!/^(?:[a-f0-9]{2})+$/i.test(hex)) throw new Error("Invalid private configuration");
  return new Uint8Array((hex.match(/.{2}/g) || []).map(h => Number.parseInt(h, 16)));
};
const encodeBase64Url = (bytes: Uint8Array) =>
  btoa(Array.from(bytes, c => String.fromCharCode(c)).join(""))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
const decodeBase64Url = (raw: string) => {
  if (!/^[A-Za-z0-9_-]{1,800}$/.test(raw)) throw new Error("Invalid session");
  const decoded = atob(raw.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(decoded, c => c.charCodeAt(0));
};
const secretKey = (hex: string) => crypto.subtle.importKey(
  "raw", hexBytes(hex), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]
);
const makeSession = async (hex: string) => {
  const payload = {
    scope: "workflow-edit", issued: Date.now(),
    exp: Date.now() + 4 * 60 * 60 * 1000
  };
  const body = encodeBase64Url(encoder.encode(JSON.stringify(payload)));
  const mac = await crypto.subtle.sign("HMAC", await secretKey(hex), encoder.encode(body));
  return body + "." + encodeBase64Url(new Uint8Array(mac));
};
const verifySession = async (token: unknown, hex: string) => {
  if (typeof token !== "string" || token.length > 1100) return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  try {
    const mac = decodeBase64Url(parts[1]);
    if (mac.byteLength !== 32) return false;
    const verified = await crypto.subtle.verify(
      "HMAC", await secretKey(hex), mac, encoder.encode(parts[0])
    );
    if (!verified) return false;
    const data = JSON.parse(decoder.decode(decodeBase64Url(parts[0])));
    const now = Date.now();
    return data.scope === "workflow-edit" &&
      Number.isFinite(data.exp) && Number.isFinite(data.issued) &&
      data.issued <= now + 30_000 && data.exp > now &&
      data.exp <= now + 4 * 60 * 60 * 1000 + 30_000;
  } catch { return false; }
};
const verifyPassword = async (password: string, record: string) => {
  const [scheme, roundText, saltHex, digestHex] = record.split(":");
  const rounds = Number(roundText);
  if (scheme !== "pbkdf2-sha256" || rounds < 200000 || rounds > 700000 ||
      saltHex?.length !== 32 || digestHex?.length !== 64) {
    throw new Error("Private password configuration is invalid");
  }
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]
  );
  const derived = new Uint8Array(await crypto.subtle.deriveBits({
    name: "PBKDF2", salt: hexBytes(saltHex), iterations: rounds, hash: "SHA-256"
  }, key, 256));
  const expected = hexBytes(digestHex);
  let difference = 0;
  for (let i = 0; i < expected.length; i++) difference |= expected[i] ^ derived[i];
  return difference === 0;
};
const isHttps = (href: string) => {
  try { return new URL(href).protocol === "https:"; } catch { return false; }
};
const isString = (value: unknown, limit: number) =>
  typeof value === "string" && value.length <= limit;
const isRows = (value: unknown, maxRows: number, maxName: number, allowTracker: boolean) =>
  Array.isArray(value) && value.length <= maxRows &&
  value.every((row: unknown) =>
    Array.isArray(row) && row.length === 2 &&
    isString(row[0], 100) && isString(row[1], maxName) &&
    (!allowTracker || row[1] === "#tracker" || isHttps(row[1]))
  );
const PAGE_FIELDS: Record<string, number> = {
  eyebrow:120,title:120,intro:1000,hint:200,
  management_label:120,management_description:1000,
  management_link_label:140,phase_label:120,phase_note:120,
  drying_label:120,footer:180,management_link_href:1700
};
const sanitize = (section: string, input: unknown) => {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const raw = input as Record<string, unknown>;
  const encoded = JSON.stringify(raw);
  if (encoded.length > 12000) return null;
  if (section === "__page") {
    if (Object.keys(raw).some(k => !(k in PAGE_FIELDS))) return null;
    const result: Record<string, unknown> = {};
    for (const [name, maxLength] of Object.entries(PAGE_FIELDS)) {
      if (raw[name] === undefined) continue;
      if (!isString(raw[name], maxLength)) return null;
      result[name] = raw[name];
    }
    if (typeof result.title !== "string" || !result.title.trim()) return null;
    if (typeof result.management_link_href !== "string" ||
      !isHttps(result.management_link_href)) return null;
    return result;
  }
  if (Object.keys(raw).some(k =>
    !["title", "description", "caption", "credits", "links"].includes(k))) return null;
  if (!isString(raw.title, 90) || !(raw.title as string).trim() ||
      !isString(raw.description, 1800) ||
      (raw.caption !== undefined && !isString(raw.caption, 220)) ||
      !isRows(raw.credits, 12, 400, false) ||
      !isRows(raw.links, 16, 1700, true)) return null;
  return raw;
};

Deno.serve(async (req: Request) => {
  if (req.headers.get("origin") !== ORIGIN) return respond(403, {error:"Origin not allowed"});
  if (req.method === "OPTIONS") return new Response(null, {status:204,headers:corsHeaders});
  if (req.method !== "POST") return respond(405, {error:"Method not allowed"});
  if (!admin) return respond(503, {error:"Server configuration unavailable"});
  if (Number(req.headers.get("content-length") || 0) > 20000) {
    return respond(413, {error:"Request too large"});
  }
  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch { return respond(400, {error:"Invalid JSON"}); }
  const {action} = payload;
  if (!["login","verify","save"].includes(String(action))) {
    return respond(400, {error:"Unknown action"});
  }
  try {
    const {data:settings,error:configError} = await admin
      .from("pavilion_workflow_password_config")
      .select("password_hash,signing_key").eq("project_id",PROJECT).single();
    if (configError || !settings?.signing_key) {
      return respond(503, {error:"Private editor is not configured"});
    }

    if (action === "login") {
      const password = payload.password;
      if (typeof password !== "string" || password.length > 128 || !password) {
        return respond(400, {error:"Enter an editor password"});
      }
      // Rate limit using one server-owned row per IP, never trusting IP information supplied in the JSON body.
      const ip = req.headers.get("cf-connecting-ip") ||
        req.headers.get("x-real-ip") ||
        req.headers.get("x-forwarded-for")?.split(",").pop()?.trim() || "unknown";
      const digest = await crypto.subtle.digest("SHA-256", encoder.encode(ip));
      const ipHash = Array.from(new Uint8Array(digest), x => x.toString(16).padStart(2,"0")).join("");
      const correct = await verifyPassword(password, settings.password_hash);
      const {data:allowed,error:limiterError} = await admin.rpc(
        "pavilion_workflow_rate_limit_auth",
        {p_ip_hash:ipHash,p_correct:correct}
      );
      if (limiterError) return respond(503, {error:"Login temporarily unavailable"});
      if (!allowed) return respond(401, {error:"Incorrect password or too many attempts. Wait 15 minutes if blocked."});
      return respond(200, {ok:true,token:await makeSession(settings.signing_key)});
    }

    if (!(await verifySession(payload.token, settings.signing_key))) {
      return respond(401,{error:"Editor session expired. Log in again."});
    }
    if (action === "verify") return respond(200,{ok:true});
    if (!ALLOWED_SECTIONS.has(String(payload.section_id))) {
      return respond(400,{error:"Unknown Workflow section"});
    }
    const data = sanitize(String(payload.section_id), payload.content);
    if (!data) return respond(400,{error:"Invalid editor content or file link"});
    const {error:saveError} = await admin.from("pavilion_workflow_content").upsert({
      project_id:PROJECT,section_id:payload.section_id,content:data,
      updated_at:new Date().toISOString()
    },{onConflict:"project_id,section_id"});
    if (saveError) return respond(500,{error:"Could not save Workflow changes"});
    return respond(200,{ok:true});
  } catch (err) {
    console.error("Workflow editor request failed:", err instanceof Error ? err.name : "Unknown error");
    return respond(500,{error:"Editor service is temporarily unavailable"});
  }
});
