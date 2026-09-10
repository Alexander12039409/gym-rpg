/* Gym RPG — Telegram Mini App. Без import, чтобы file:// не ломался. */

const GymTg = (() => {
  const META_KEY = "g8n";
  const CHUNK_PREFIX = "g8c";
  const CHUNK = 3500;
  const WRITE_WAIT = 450;

  let pendingRaw = null;
  let writing = false;
  let writeTimer = 0;
  let booted = false;

  function webApp() {
    try { return window.Telegram && window.Telegram.WebApp; }
    catch (e) { return null; }
  }

  function cloud() {
    const tg = webApp();
    return tg && tg.CloudStorage ? tg.CloudStorage : null;
  }

  function inTelegram() {
    const tg = webApp();
    if (!tg) return false;
    if (tg.initData) return true;
    if (tg.initDataUnsafe && tg.initDataUnsafe.user) return true;
    const p = String(tg.platform || "");
    return p && p !== "unknown";
  }

  function hasCloud() {
    const tg = webApp();
    const cs = cloud();
    if (!inTelegram() || !cs) return false;
    try {
      if (typeof tg.isVersionAtLeast === "function" && !tg.isVersionAtLeast("6.1")) return false;
    } catch (e) {}
    return true;
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

  function boot() {
    if (booted) return;
    const tg = webApp();
    if (!tg) return;
    booted = true;
    try { tg.ready(); } catch (e) {}
    try { tg.expand(); } catch (e) {}
    try { if (typeof tg.disableVerticalSwipes === "function") tg.disableVerticalSwipes(); } catch (e) {}
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

  function csCall(method, args) {
    return new Promise((resolve, reject) => {
      const cs = cloud();
      if (!cs || typeof cs[method] !== "function") {
        reject(new Error("CloudStorage недоступен"));
        return;
      }
      const list = args.slice();
      list.push((err, value) => {
        if (err) reject(typeof err === "string" ? new Error(err) : err);
        else resolve(value);
      });
      cs[method].apply(cs, list);
    });
  }

  function getItems(keys) {
    if (!keys.length) return Promise.resolve({});
    return csCall("getItems", [keys]).then((values) => values || {});
  }

  function setItem(key, value) {
    return csCall("setItem", [key, value]);
  }

  function removeItems(keys) {
    if (!keys.length) return Promise.resolve();
    return csCall("removeItems", [keys]);
  }

  async function read() {
    if (!hasCloud()) return null;
    const meta = await getItems([META_KEY]);
    const n = parseInt(meta[META_KEY], 10);
    if (!n || n < 1) return null;
    const keys = [];
    for (let i = 0; i < n; i++) keys.push(CHUNK_PREFIX + i);
    const parts = await getItems(keys);
    let raw = "";
    for (let i = 0; i < n; i++) raw += parts[CHUNK_PREFIX + i] || "";
    return raw || null;
  }

  async function writeNow(raw) {
    if (!hasCloud() || raw == null) return;
    const chunks = [];
    for (let i = 0; i < raw.length; i += CHUNK) chunks.push(raw.slice(i, i + CHUNK));
    if (!chunks.length) chunks.push("{}");
    const meta = await getItems([META_KEY]);
    const oldN = parseInt(meta[META_KEY], 10) || 0;
    for (let i = 0; i < chunks.length; i++) {
      await setItem(CHUNK_PREFIX + i, chunks[i]);
    }
    await setItem(META_KEY, String(chunks.length));
    if (oldN > chunks.length) {
      const extra = [];
      for (let i = chunks.length; i < oldN; i++) extra.push(CHUNK_PREFIX + i);
      await removeItems(extra);
    }
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
      if (typeof toast === "function") toast("Telegram не сохранил облако. Локально сейв есть.", true);
    } finally {
      writing = false;
      if (pendingRaw != null) runWriteQueue();
    }
  }

  function persist(raw) {
    if (!hasCloud()) return;
    pendingRaw = raw;
    clearTimeout(writeTimer);
    writeTimer = setTimeout(runWriteQueue, WRITE_WAIT);
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
      const meta = await getItems([META_KEY]);
      const n = parseInt(meta[META_KEY], 10) || 0;
      const keys = [META_KEY];
      for (let i = 0; i < Math.max(n, 1); i++) keys.push(CHUNK_PREFIX + i);
      await removeItems(keys);
    } catch (err) {
      console.warn("GymTg wipe", err);
    }
  }

  return { boot, inTelegram, hasCloud, read, persist, flush, wipe, viewportHeight, applyChrome };
})();
