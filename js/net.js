/* Сейв между устройствами: сначала Telegram (телефон его точно видит), потом Cloudflare. */

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

  function beaconGet(url) {
    return new Promise((resolve) => {
      const img = new Image();
      let done = false;
      const finish = () => { if (done) return; done = true; resolve(true); };
      img.onload = finish;
      img.onerror = finish;
      img.src = url;
      setTimeout(finish, 2500);
    });
  }

  function xhrGet(url) {
    return new Promise((resolve, reject) => {
      const x = new XMLHttpRequest();
      x.open("GET", url, true);
      x.timeout = 10000;
      x.onload = () => {
        try { resolve(JSON.parse(x.responseText)); }
        catch (e) { reject(new Error("битый ответ Telegram")); }
      };
      x.onerror = () => reject(new Error("сеть Mini App: XHR"));
      x.ontimeout = () => reject(new Error("таймаут"));
      x.send();
    });
  }

  function packHero(raw) {
    let o;
    try { o = JSON.parse(raw); } catch (e) { return ""; }
    const u = o.user || {};
    const line = ["G1", u.name || "", u.weight || "", u.height || "", u.goal || "", u.gender || "m", u.bodyType || "", u.experience || "", (u.problems || []).join("."), u.primaryProblem || "", u.level || 1, u.xp || 0, o.currentBoss || 0, Math.round(o.currentHp || 0), o.savedAt || Date.now()].join("|");
    return line.slice(0, 512);
  }

  function unpackHero(desc) {
    const s = String(desc || "");
    if (s.indexOf("G1|") !== 0) return null;
    const p = s.split("|");
    const user = {
      name: p[1] || "Герой",
      weight: parseFloat(p[2]) || 75,
      height: parseFloat(p[3]) || 175,
      goal: p[4] || "gain",
      gender: p[5] || "m",
      bodyType: p[6] || "",
      experience: p[7] || "",
      problems: p[8] ? p[8].split(".").filter(Boolean) : ["belly"],
      primaryProblem: p[9] || "belly",
      level: parseInt(p[10], 10) || 1,
      xp: parseInt(p[11], 10) || 0,
      createdAt: Date.now()
    };
    user.bmi = user.weight / ((user.height / 100) ** 2);
    return JSON.stringify({
      user: user,
      currentBoss: parseInt(p[12], 10) || 0,
      currentHp: parseFloat(p[13]) || 0,
      savedAt: parseInt(p[14], 10) || Date.now()
    });
  }

  async function descWrite(raw) {
    const line = packHero(raw);
    if (!line) throw new Error("нечего писать в описание");
    const url = TG_API + "/setMyDescription?description=" + encodeURIComponent(line);
    await beaconGet(url);
  }

  async function descRead() {
    const data = await xhrGet(TG_API + "/getMyDescription");
    if (!data || !data.ok) throw new Error((data && data.description) || "getMyDescription");
    const desc = data.result && data.result.description;
    return unpackHero(desc);
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
    const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), 10000) : 0;
    let res;
    try {
      res = await fetch(TG_API + "/" + method, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body || {}),
        signal: ctrl ? ctrl.signal : undefined
      });
    } catch (e) {
      if (e && e.name === "AbortError") throw new Error("таймаут Telegram API");
      throw new Error("сеть Mini App: " + (e && e.message || "нет ответа"));
    } finally {
      if (timer) clearTimeout(timer);
    }
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

  function slimRaw(raw) {
    const out = [raw];
    try {
      const o = JSON.parse(raw);
      out.push(JSON.stringify({
        savedAt: o.savedAt,
        user: o.user,
        currentBoss: o.currentBoss,
        currentHp: o.currentHp,
        revengeKills: o.revengeKills,
        plans: o.plans,
        lastWeights: o.lastWeights,
        achievements: o.achievements
      }));
      out.push(JSON.stringify({
        savedAt: o.savedAt,
        user: o.user,
        currentBoss: o.currentBoss,
        currentHp: o.currentHp
      }));
    } catch (e) {}
    return out;
  }

  async function pack(raw) {
    const attempts = slimRaw(raw);
    for (let i = 0; i < attempts.length; i++) {
      const plain = "GYMRPG\n" + attempts[i];
      if (plain.length <= 4096) return plain;
      const z = await gzipB64(attempts[i]);
      if (z) {
        const packed = "GYMRPGZ\n" + z;
        if (packed.length <= 4096) return packed;
      }
    }
    throw new Error("сейв не влез в сообщение Telegram");
  }

  async function unpack(text) {
    const s = String(text || "");
    if (s.indexOf("GYMRPGZ\n") === 0) return await gunzipB64(s.slice(8));
    if (s.indexOf("GYMRPG\n") === 0) return s.slice(7);
    return null;
  }

  function parseSavedAt(raw) {
    try { return (JSON.parse(raw) || {}).savedAt || 0; } catch (e) { return 0; }
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
    let msgId = prev;
    if (prev) {
      try {
        await tgApi("editMessageText", {
          chat_id: id,
          message_id: prev,
          text: text,
          disable_web_page_preview: true
        });
        msgId = prev;
      } catch (e) {
        if (!/not modified/i.test(String(e.message || e))) msgId = 0;
      }
    }
    if (!msgId) {
      const sent = await tgApi("sendMessage", {
        chat_id: id,
        text: text,
        disable_notification: true,
        disable_web_page_preview: true
      });
      msgId = sent && sent.message_id;
      if (!msgId) throw new Error("Telegram не вернул message_id");
      if (prev && prev !== msgId) {
        try { await tgApi("deleteMessage", { chat_id: id, message_id: prev }); } catch (e) {}
      }
    }
    await tgApi("setMyShortDescription", { short_description: (MARK + msgId).slice(0, 120) });
    await tgApi("pinChatMessage", { chat_id: id, message_id: msgId, disable_notification: true });
    const check = await tgRead();
    if (!check) throw new Error("сейв не закрепился в чате с ботом");
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
    let descRaw = null;
    let cfRaw = null;
    let tgRaw = null;
    try { descRaw = await descRead(); } catch (e) { setError(e); }
    try { cfRaw = await cfReq("get"); } catch (e) { setError(e); }
    try { tgRaw = await tgRead(); } catch (e) { setError(e); }
    const a = newestRaw(descRaw, newestRaw(cfRaw, tgRaw));
    return a;
  }

  function newestRaw(a, b) {
    if (a && b) return parseSavedAt(a) >= parseSavedAt(b) ? a : b;
    return a || b;
  }

  async function writeNow(raw) {
    const errors = [];
    let ok = false;
    try {
      await descWrite(raw);
      ok = true;
    } catch (e) {
      errors.push("описание: " + (e && e.message || e));
    }
    try {
      await tgWrite(raw);
      ok = true;
    } catch (e) {
      errors.push("Telegram: " + (e && e.message || e));
    }
    try {
      await cfReq("put", raw);
      ok = true;
    } catch (e) {
      errors.push("CF: " + (e && e.message || e));
    }
    if (!ok) {
      setError(new Error(errors.join(" / ")));
      throw new Error(lastError);
    }
    lastError = "";
    return "ok";
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

  return { read, write, persist, wipe, errorText, setError };
})();
