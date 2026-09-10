/* Cloudflare Worker: общий сейв Mini App. Секреты только в биндингах, не в git. */

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Max-Age": "86400"
  };
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: Object.assign({ "Content-Type": "application/json; charset=utf-8" }, corsHeaders())
  });
}

function hex(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, "0");
  return out;
}

function timingEqual(a, b) {
  const x = String(a || "");
  const y = String(b || "");
  if (x.length !== y.length) return false;
  let n = 0;
  for (let i = 0; i < x.length; i++) n |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return n === 0;
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

function parseInitData(raw) {
  const map = new Map();
  String(raw || "").split("&").forEach((part) => {
    if (!part) return;
    const i = part.indexOf("=");
    const k = decodeURIComponent((i < 0 ? part : part.slice(0, i)).replace(/\+/g, " "));
    const v = decodeURIComponent((i < 0 ? "" : part.slice(i + 1)).replace(/\+/g, " "));
    map.set(k, v);
  });
  return map;
}

async function hashFor(map, botToken, skip) {
  const pairs = [];
  map.forEach((v, k) => {
    if (skip.indexOf(k) >= 0) return;
    pairs.push(k + "=" + v);
  });
  pairs.sort();
  const secret = await hmacSha256(new TextEncoder().encode("WebAppData"), botToken);
  return hex(await hmacSha256(secret, pairs.join("\n")));
}

async function userIdFromInitData(initData, botToken) {
  const raw = String(initData || "").replace(/^tma\s+/i, "").trim();
  if (!raw) throw new Error("Нет initData. Открой качалку из Telegram.");
  const map = parseInitData(raw);
  const hash = map.get("hash") || "";
  const a = await hashFor(map, botToken, ["hash"]);
  const b = await hashFor(map, botToken, ["hash", "signature"]);
  if (!timingEqual(a, hash) && !timingEqual(b, hash)) {
    throw new Error("Подпись Telegram не сошлась.");
  }
  const userRaw = map.get("user");
  if (!userRaw) throw new Error("В initData нет user.");
  const user = JSON.parse(userRaw);
  if (!user || !user.id) throw new Error("Нет Telegram id.");
  return String(user.id);
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }
    if (request.method === "GET") {
      return json(200, { ok: true, service: "gym-rpg-save" });
    }
    if (request.method !== "POST") return json(405, { error: "method" });

    let body;
    try { body = await request.json(); } catch (e) {
      return json(400, { error: "нужен JSON" });
    }
    const action = String((body && body.action) || "get");
    let uid;
    try {
      uid = await userIdFromInitData(body && body.initData, env.BOT_TOKEN);
    } catch (e) {
      return json(401, { error: e.message || String(e) });
    }
    const key = "gr10:" + uid;
    try {
      if (action === "get") {
        const raw = await env.SAVES.get(key);
        if (!raw) return json(404, { error: "empty" });
        return new Response(raw, {
          status: 200,
          headers: Object.assign({ "Content-Type": "application/json; charset=utf-8" }, corsHeaders())
        });
      }
      if (action === "put") {
        const raw = String((body && body.raw) || "");
        if (!raw || raw.length > 900000) return json(400, { error: "bad body" });
        JSON.parse(raw);
        await env.SAVES.put(key, raw);
        return json(200, { ok: true });
      }
      if (action === "del") {
        await env.SAVES.delete(key);
        return json(200, { ok: true });
      }
    } catch (e) {
      return json(500, { error: e.message || String(e) });
    }
    return json(400, { error: "unknown action" });
  }
};
