/* Сейв: Cloudflare, если Mini App туда не достучится — Telegram Bot API. */

const GymNet = (() => {
  const CF_URLS = [
    "https://gym-rpg-save.alpop-gymrpg.workers.dev/save",
    "https://gym-rpg-save.alpop-gymrpg.workers.dev/"
  ];
  const BOT = "8842335491:AAH3YEqwf97U0lCCSa_NK9jMdzC05NaofII";
  const TG_API = "https://api.telegram.org/bot" + BOT;
  const MARK = "GR10M:";
  const FALLBACK_CHAT = 586240051;
  let writeTimer = 0;
  let pending = null;
  let lastError = "";

  function setError(err) {
    lastError = err && err.message ? err.message : String(err || "");
    return lastError;
  }

  function initData() {
    try {
      const tg = window.Telegram && Telegram.WebApp;
      if (tg && tg.initData) return String(tg.initData);
    } catch (e) {}
    try {
      const wv = window.Telegram && Telegram.WebView;
      const p = wv && wv.initParams && wv.initParams.tgWebAppData;
      if (p) return String(p);
    } catch (e) {}
    try {
      const h = String(location.hash || "").replace(/^#/, "");
      const parts = h.split("&");
      for (let i = 0; i < parts.length; i++) {
        const row = parts[i];
        if (row.indexOf("tgWebAppData=") === 0) {
          return decodeURIComponent(row.slice("tgWebAppData=".length));
        }
      }
    } catch (e) {}
    return "";
  }

  function chatId() {
    try {
      const u = window.Telegram && Telegram.WebApp && Telegram.WebApp.initDataUnsafe && Telegram.WebApp.initDataUnsafe.user;
      if (u && u.id) return u.id;
    } catch (e) {}
    return FALLBACK_CHAT;
  }

  async function cfReq(action, raw) {
    const data = initData();
    if (!data) throw new Error("Нет initData Telegram.");
    let last = new Error("Cloudflare не ответил");
    for (let i = 0; i < CF_URLS.length; i++) {
      try {
        const res = await fetch(CF_URLS[i], {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: action, initData: data, raw: raw })
        });
        if (res.status === 404) return null;
        const text = await res.text();
        if (!res.ok) {
          let msg = text;
          try {
            const parsed = JSON.parse(text);
            if (parsed && parsed.error) msg = parsed.error;
          } catch (e) {}
          throw new Error(msg || ("HTTP " + res.status));
        }
        return text;
      } catch (e) {
        last = e;
      }
    }
    throw last;
  }

  async function tgApi(method, body) {
    const res = await fetch(TG_API + "/" + method, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {})
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.description || method);
    return data.result;
  }

  async function gzipB64(str) {
    if (typeof CompressionStream === "undefined") return null;
    const stream = new Blob([str]).stream().pipeThrough(new CompressionStream("gzip"));
    const buf = await new Response(stream).arrayBuffer();
    const bytes = new Uint8Array(buf);
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  async function gunzipB64(b64) {
    if (typeof DecompressionStream === "undefined") throw new Error("этот Telegram не умеет распаковать сейв");
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    return await new Response(stream).text();
  }

  async function pack(raw) {
    const plain = "GYMRPG\n" + raw;
    if (plain.length <= 4096) return plain;
    const z = await gzipB64(raw);
    if (!z) throw new Error("сейв слишком большой");
    const packed = "GYMRPGZ\n" + z;
    if (packed.length > 4096) throw new Error("сейв слишком большой даже сжатый");
    return packed;
  }

  async function unpack(text) {
    const s = String(text || "");
    if (s.indexOf("GYMRPGZ\n") === 0) return await gunzipB64(s.slice(8));
    if (s.indexOf("GYMRPG\n") === 0) return s.slice(7);
    return null;
  }

  async function tgRead() {
    const chat = await tgApi("getChat", { chat_id: chatId() });
    const pinned = chat && chat.pinned_message;
    if (pinned && pinned.text) {
      const unpacked = await unpack(pinned.text);
      if (unpacked) return unpacked;
    }
    return null;
  }

  async function tgWrite(raw) {
    const text = await pack(raw);
    const id = chatId();
    const info = await tgApi("getMyShortDescription", {});
    const desc = String((info && info.short_description) || "");
    const prev = desc.indexOf(MARK) === 0 ? Number(desc.slice(MARK.length)) : 0;
    if (prev) {
      try {
        await tgApi("editMessageText", {
          chat_id: id,
          message_id: prev,
          text: text,
          disable_web_page_preview: true
        });
        try { await tgApi("pinChatMessage", { chat_id: id, message_id: prev, disable_notification: true }); } catch (e) {}
        return;
      } catch (e) {
        if (/not modified/i.test(String(e.message || e))) return;
      }
    }
    const sent = await tgApi("sendMessage", {
      chat_id: id,
      text: text,
      disable_notification: true,
      disable_web_page_preview: true
    });
    await tgApi("setMyShortDescription", { short_description: (MARK + sent.message_id).slice(0, 120) });
    try { await tgApi("pinChatMessage", { chat_id: id, message_id: sent.message_id, disable_notification: true }); } catch (e) {}
    if (prev && prev !== sent.message_id) {
      try { await tgApi("deleteMessage", { chat_id: id, message_id: prev }); } catch (e) {}
    }
  }

  async function tgWipe() {
    try {
      const info = await tgApi("getMyShortDescription", {});
      const desc = String((info && info.short_description) || "");
      const prev = desc.indexOf(MARK) === 0 ? Number(desc.slice(MARK.length)) : 0;
      if (prev) await tgApi("deleteMessage", { chat_id: chatId(), message_id: prev });
    } catch (e) {}
    try { await tgApi("setMyShortDescription", { short_description: "Качалка. Сет = удар по боссу." }); } catch (e) {}
  }

  async function read() {
    try {
      return await cfReq("get");
    } catch (e) {
      setError(e);
      return await tgRead();
    }
  }

  async function writeNow(raw) {
    try {
      await cfReq("put", raw);
      lastError = "";
      return "cf";
    } catch (cfErr) {
      try {
        await tgWrite(raw);
        lastError = "";
        return "tg";
      } catch (tgErr) {
        setError(new Error((cfErr && cfErr.message || cfErr) + " / запасной: " + (tgErr && tgErr.message || tgErr)));
        throw tgErr;
      }
    }
  }

  function persist(raw) {
    pending = raw;
    clearTimeout(writeTimer);
    writeTimer = setTimeout(() => {
      const cur = pending;
      pending = null;
      writeNow(cur).catch((err) => setError(err));
    }, 700);
  }

  function write(raw) {
    pending = null;
    clearTimeout(writeTimer);
    return writeNow(raw);
  }

  async function wipe() {
    try { await cfReq("del"); } catch (e) {}
    await tgWipe();
  }

  function errorText() {
    return lastError;
  }

  return { read, write, persist, wipe, errorText };
})();
