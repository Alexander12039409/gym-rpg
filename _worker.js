/* Один JSON на качалку. Telegram тут не участвует. */

const KEY = "hero";

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Cache-Control": "no-store"
    }
  });
}

async function handleSave(request, env) {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type"
      }
    });
  }
  if (!env.SAVES) return json(500, { error: "нет хранилища" });
  try {
    if (request.method === "GET") {
      const raw = await env.SAVES.get(KEY);
      if (!raw) return json(404, { error: "empty" });
      return new Response(raw, {
        status: 200,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-store"
        }
      });
    }
    if (request.method === "PUT") {
      const raw = await request.text();
      if (!raw || raw.length > 900000) return json(400, { error: "bad body" });
      JSON.parse(raw);
      await env.SAVES.put(KEY, raw);
      return json(200, { ok: true });
    }
    if (request.method === "DELETE") {
      await env.SAVES.delete(KEY);
      return json(200, { ok: true });
    }
  } catch (e) {
    return json(500, { error: e.message || String(e) });
  }
  return json(405, { error: "method" });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    if (path === "/save") return handleSave(request, env);
    if (env.ASSETS && env.ASSETS.fetch) return env.ASSETS.fetch(request);
    return json(404, { error: "not found" });
  }
};
