/* Gym RPG — Telegram Mini App. Без import, чтобы file:// не ломался. */

const GymTg = (() => {
  const DATA_KEY = "sv1";
  const META_KEY = "sv1n";
  const CHUNK_PREFIX = "sv1c";
  const CHUNK = 3500;
  const WRITE_WAIT = 280;
  const CALL_MS = 15000;

  let pendingRaw = null;
  let writing = false;
  let writeTimer = 0;
  let booted = false;

  function webApp() {
    try { return window.Telegram && window.Telegram.WebApp; }
    catch (e) { return null; }
  }

  function webView() {
    try { return window.Telegram && window.Telegram.WebView; }
    catch (e) { return null; }
  }

  function cloud() {
    const tg = webApp();
    return tg && tg.CloudStorage ? tg.CloudStorage : null;
  }

  function inTelegram() {
    if (window.TelegramWebviewProxy) return true;
    if (typeof window.TelegramWebview !== "undefined") return true;
    if (/Telegram/i.test(navigator.userAgent || "")) return true;
    const tg = webApp();
    if (tg) {
      if (tg.initData) return true;
      if (tg.initDataUnsafe && tg.initDataUnsafe.user) return true;
      const p = String(tg.platform || "");
      if (p && p !== "unknown") return true;
      if (tg.themeParams && Object.keys(tg.themeParams).length) return true;
    }
    const wv = webView();
    if (wv && wv.initParams && (wv.initParams.tgWebAppData || wv.initParams.tgWebAppVersion)) return true;
    try { if (window.parent && window.parent !== window) return true; } catch (e) { return true; }
    return false;
  }

  function diag() {
    const tg = webApp();
    const wv = webView();
    const ver = tg && tg.version ? String(tg.version) : (wv && wv.initParams && wv.initParams.tgWebAppVersion) || "?";
    const plat = tg && tg.platform ? String(tg.platform) : "?";
    const proxy = window.TelegramWebviewProxy ? "proxy" : "no-proxy";
    const data = tg && tg.initData ? "init" : "no-init";
    return ver + " / " + plat + " / " + proxy + " / " + data;
  }

  function hasCloud() {
    if (!(cloud() || window.TelegramWebviewProxy || (webView() && typeof webView().postEvent === "function"))) return false;
    return inTelegram();
  }

  function statusText() {
    if (!inTelegram()) return "Это не Mini App. Открой https://t.me/gym_rpg_app_bot?startapp";
    if (hasCloud()) return "Облако: пробуем Telegram CloudStorage. Если спросит Allow — жми. " + diag();
    return "Облако недоступно. " + diag();
  }

  function viewportHeight() {
    const tg = webApp();
    if (!tg) return Math.round(window.innerHeight);
    return Math.round(tg.viewportStableHeight || tg.viewportHeight || window.innerHeight);
  }

  function applyChrome() {
    const tg = webApp();
    if (!tg) return;
    const h = viewportHeight();
    document.documentElement.style.setProperty("--app-h", h + "px");
    const safe = tg.safeAreaInset || {};
    const content = tg.contentSafeAreaInset || {};
    const top = (Number(safe.top) || 0) + (Number(content.top) || 0);
    const bottom = (Number(safe.bottom) || 0) + (Number(content.bottom) || 0);
    document.documentElement.style.setProperty("--tg-safe-t", top + "px");
    document.documentElement.style.setProperty("--tg-safe-b", bottom + "px");
    if (window.scrollY || window.scrollX) window.scrollTo(0, 0);
  }

  function setSwipeLock(lock) {
    const tg = webApp();
    if (!tg) return;
    try {
      if (lock && typeof tg.disableVerticalSwipes === "function") tg.disableVerticalSwipes();
      else if (!lock && typeof tg.enableVerticalSwipes === "function") tg.enableVerticalSwipes();
    } catch (e) {}
  }

  function boot() {
    if (booted) return;
    const tg = webApp();
    if (!tg) return;
    booted = true;
    try { tg.ready(); } catch (e) {}
    try { tg.expand(); } catch (e) {}
    try { if (typeof tg.enableClosingConfirmation === "function") tg.enableClosingConfirmation(); } catch (e) {}
    try { tg.setHeaderColor("#ffcc22"); } catch (e) {}
    try { tg.setBackgroundColor("#1a2748"); } catch (e) {}
    document.documentElement.classList.add("tg-app");
    applyChrome();
    try { tg.onEvent("viewportChanged", applyChrome); } catch (e) {}
    try { tg.onEvent("safeAreaChanged", applyChrome); } catch (e) {}
    try { tg.onEvent("contentSafeAreaChanged", applyChrome); } catch (e) {}
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) flush();
    });
    window.addEventListener("pagehide", flush);
  }

  function parseResult(res) {
    if (typeof res === "string") {
      const s = res.trim();
      if ((s.charAt(0) === "{" && s.charAt(s.length - 1) === "}") || (s.charAt(0) === "[" && s.charAt(s.length - 1) === "]")) {
        try { return JSON.parse(s); } catch (e) { return res; }
      }
    }
    return res;
  }

  function nativeInvoke(method, params) {
    return new Promise((resolve, reject) => {
      const wv = webView();
      if (!wv || typeof wv.postEvent !== "function" || typeof wv.onEvent !== "function") {
        reject(new Error("WebView недоступен"));
        return;
      }
      const req_id = "g" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      let done = false;
      const finish = (err, value) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try { wv.offEvent("custom_method_invoked", onInvoked); } catch (e) {}
        if (err) reject(err);
        else resolve(value);
      };
      const timer = setTimeout(() => finish(new Error("CloudStorage timeout")), CALL_MS);
      function onInvoked(eventType, eventData) {
        const data = eventData || {};
        if (String(data.req_id) !== req_id) return;
        if (data.error) finish(new Error(String(data.error)));
        else finish(null, parseResult(data.result));
      }
      wv.onEvent("custom_method_invoked", onInvoked);
      try {
        wv.postEvent("web_app_invoke_custom_method", false, {
          req_id: req_id,
          method: method,
          params: params || {}
        });
      } catch (e) {
        finish(e);
      }
    });
  }

  function unwrapCallback(err, value) {
    if (typeof err === "string" && err) return { error: new Error(err) };
    if (err && value === undefined && typeof err === "object" && !Array.isArray(err) && (err.message || err.error)) {
      return { error: err instanceof Error ? err : new Error(String(err.message || err.error)) };
    }
    if (value === undefined && err != null && typeof err === "object") return { value: err };
    return { value };
  }

  function sdkCall(method, args) {
    return new Promise((resolve, reject) => {
      const cs = cloud();
      if (!cs || typeof cs[method] !== "function") {
        reject(new Error("CloudStorage SDK недоступен"));
        return;
      }
      let done = false;
      const finish = (fn) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        fn();
      };
      const timer = setTimeout(() => finish(() => reject(new Error("CloudStorage timeout"))), CALL_MS);
      const list = args.slice();
      list.push((err, value) => {
        finish(() => {
          const out = unwrapCallback(err, value);
          if (out.error) reject(out.error);
          else resolve(out.value);
        });
      });
      try {
        cs[method].apply(cs, list);
      } catch (e) {
        finish(() => reject(e));
      }
    });
  }

  async function callStore(kind, payload) {
    try {
      if (kind === "set") return await nativeInvoke("saveStorageValue", payload);
      if (kind === "get") return await nativeInvoke("getStorageValues", payload);
      if (kind === "keys") return await nativeInvoke("getStorageKeys", {});
      if (kind === "del") return await nativeInvoke("deleteStorageValues", payload);
    } catch (e) {
      if (kind === "set") return sdkCall("setItem", [payload.key, payload.value]);
      if (kind === "get") return sdkCall("getItems", [payload.keys]);
      if (kind === "keys") return sdkCall("getKeys", []);
      if (kind === "del") return sdkCall("removeItems", [payload.keys]);
      throw e;
    }
  }

  async function getItem(key) {
    const values = await callStore("get", { keys: [key] }) || {};
    const v = values[key];
    return v == null ? "" : String(v);
  }

  async function setItem(key, value) {
    return callStore("set", { key: key, value: value });
  }

  async function removeItems(keys) {
    if (!keys.length) return;
    return callStore("del", { keys: keys });
  }

  async function getAllKeys() {
    const keys = await callStore("keys", {});
    return Array.isArray(keys) ? keys : [];
  }

  async function read() {
    if (!hasCloud()) return null;
    try {
      const single = await getItem(DATA_KEY);
      if (single) return single;
    } catch (e) {}
    try {
      const old10 = await getItem("gr10d");
      if (old10) return old10;
    } catch (e) {}
    try {
      const nRaw = await getItem(META_KEY);
      const n = parseInt(nRaw, 10);
      if (!n || n < 1) return null;
      const keys = [];
      for (let i = 0; i < n; i++) keys.push(CHUNK_PREFIX + i);
      const parts = (await callStore("get", { keys: keys })) || {};
      let raw = "";
      for (let i = 0; i < n; i++) raw += parts[CHUNK_PREFIX + i] || "";
      return raw || null;
    } catch (e) {
      return null;
    }
  }

  async function writeNow(raw) {
    if (!hasCloud() || raw == null) throw new Error("CloudStorage недоступен. " + diag());
    if (raw.length <= CHUNK) {
      await setItem(DATA_KEY, raw);
      return;
    }
    const chunks = [];
    for (let i = 0; i < raw.length; i += CHUNK) chunks.push(raw.slice(i, i + CHUNK));
    for (let i = 0; i < chunks.length; i++) {
      await setItem(CHUNK_PREFIX + i, chunks[i]);
    }
    await setItem(META_KEY, String(chunks.length));
    try { await removeItems([DATA_KEY]); } catch (e) {}
  }

  async function runWriteQueue() {
    if (writing) return;
    const raw = pendingRaw;
    if (raw == null) return;
    pendingRaw = null;
    writing = true;
    try {
      await writeNow(raw);
    } catch (err) {
      console.warn("GymTg write", err);
      if (typeof toast === "function") toast("Telegram не сохранил облако: " + (err && err.message || err), true);
    } finally {
      writing = false;
      if (pendingRaw != null) await runWriteQueue();
    }
  }

  function persist(raw) {
    if (!hasCloud()) return;
    pendingRaw = raw;
    clearTimeout(writeTimer);
    writeTimer = setTimeout(() => { runWriteQueue(); }, WRITE_WAIT);
  }

  async function persistNow(raw) {
    if (!hasCloud()) return false;
    clearTimeout(writeTimer);
    pendingRaw = null;
    await writeNow(raw);
    return true;
  }

  function flush() {
    clearTimeout(writeTimer);
    return runWriteQueue();
  }

  async function wipe() {
    if (!hasCloud()) return;
    clearTimeout(writeTimer);
    pendingRaw = null;
    try {
      const keys = await getAllKeys();
      const drop = keys.filter((k) => {
        const s = String(k);
        return /^gr\d/i.test(s) || /^gymRpg/i.test(s) || /^gym/i.test(s);
      });
      if (drop.length) await removeItems(drop);
      else await removeItems([DATA_KEY, META_KEY, "gr9d"]);
    } catch (err) {
      console.warn("GymTg wipe", err);
    }
  }

  return {
    boot, inTelegram, hasCloud, statusText, diag, read, persist, persistNow, flush, wipe,
    viewportHeight, applyChrome, setSwipeLock
  };
})();
