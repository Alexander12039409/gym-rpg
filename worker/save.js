/* Cloudflare Worker: общий сейв Mini App. Секреты только в биндингах, не в git. */

const ALLOW = [
  "https://alexander12039409.github.io",
  "http://127.0.0.1:8767",
  "http://localhost:8767",
  "http://127.0.0.1:5500"
];

function corsHeaders(origin) {
  const allow = ALLOW.indexOf(origin) >= 0 ? origin : ALLOW[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, PUT, DELETE, OPTIONS",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin"
  };
}

function json(status, body, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: Object.assign({ "Content-Type": "application/json; charset=utf-8" }, corsHeaders(origin))
  });
}

function hex(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, "0");
  return out;
}

function timingEqual(a, b) {
  if (a.length !== b.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
}

async function hmacSha256(keyBytes, msg) {
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const data = typeof msg === "string" ? new TextEncoder().encode(msg) : msg;
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, data));
}

async function userIdFromInitData(initData, botToken) {
  const raw = String(initData || "").replace(/^tma\s+/i, "").trim();
  if (!raw) throw new Error("Нет initData. Открой качалку из Telegram.");
  const params = new URLSearchParams(raw);
  const hash = params.get("hash") || "";
  params.delete("hash");
  const pairs = [];
  for (const [k, v] of params.entries()) pairs.push(k + "=" + v);
  pairs.sort();
  const secret = await hmacSha256(new TextEncoder().encode("WebAppData"), botToken);
  const check = hex(await hmacSha256(secret, pairs.join("\n")));
  if (!timingEqual(check, hash)) throw new Error("Подпись Telegram не сошлась.");
  const userRaw = params.get("user");
  if (!userRaw) throw new Error("В initData нет user.");
  const user = JSON.parse(userRaw);
  if (!user || !user.id) throw new Error("Нет Telegram id.");
  return String(user.id);
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    const url = new URL(request.url);
    if (url.pathname !== "/save" && url.pathname !== "/") {
      return json(404, { error: "not found" }, origin);
    }
    let uid;
    try {
      const auth = request.headers.get("Authorization") || "";
      const initData = auth.replace(/^tma\s+/i, "") || url.searchParams.get("initData") || "";
      uid = await userIdFromInitData(initData, env.BOT_TOKEN);
    } catch (e) {
      return json(401, { error: e.message || String(e) }, origin);
    }
    const key = "gr10:" + uid;
    try {
      if (request.method === "GET") {
        const raw = await env.SAVES.get(key);
        if (!raw) return json(404, { error: "empty" }, origin);
        return new Response(raw, {
          status: 200,
          headers: Object.assign({ "Content-Type": "application/json; charset=utf-8" }, corsHeaders(origin))
        });
      }
      if (request.method === "PUT") {
        const raw = await request.text();
        if (!raw || raw.length > 900000) return json(400, { error: "bad body" }, origin);
        JSON.parse(raw);
        await env.SAVES.put(key, raw);
        return json(200, { ok: true }, origin);
      }
      if (request.method === "DELETE") {
        await env.SAVES.delete(key);
        return json(200, { ok: true }, origin);
      }
    } catch (e) {
      return json(500, { error: e.message || String(e) }, origin);
    }
    return json(405, { error: "method" }, origin);
  }
};
