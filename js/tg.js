/* Gym RPG — Telegram Mini App. Без import, чтобы file:// не ломался. */

const GymTg = (() => {
  const DATA_KEY = "gr9d";
  const META_KEY = "gr9n";
  const CHUNK_PREFIX = "gr9c";
  const CHUNK = 3500;
  const WRITE_WAIT = 280;
  const CALL_MS = 9000;
  const LEGACY_PREFIXES = ["g8", "g8n", "g8c"];

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
    const cs = cloud();
    if (!cs || typeof cs.setItem !== "function" || typeof cs.getItem !== "function") return false;
    const tg = webApp();
    try {
      if (tg && typeof tg.isVersionAtLeast === "function" && !tg.isVersionAtLeast("6.9")) return false;
    } catch (e) {}
    return inTelegram();
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

  function unwrapCallback(err, value) {
    if (typeof err === "string" && err) return { error: new Error(err) };
    if (err && value === undefined && typeof err === "object" && !Array.isArray(err) && (err.message || err.error)) {
      return { error: err instanceof Error ? err : new Error(String(err.message || err.error)) };
    }
    if (value === undefined && err != null && typeof err === "object") return { value: err };
    return { value };
  }

  function csCall(method, args) {
    return new Promise((resolve, reject) => {
      const cs = cloud();
      if (!cs || typeof cs[method] !== "function") {
        reject(new Error("CloudStorage недоступен"));
        return;
      }
      let done = false;
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        reject(new Error("CloudStorage timeout"));
      }, CALL_MS);
      const list = args.slice();
      list.push((err, value) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        const out = unwrapCallback(err, value);
        if (out.error) reject(out.error);
        else resolve(out.value);
      });
      try {
        cs[method].apply(cs, list);
      } catch (e) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        reject(e);
      }
    });
  }

  function getItem(key) {
    return csCall("getItem", [key]).then((v) => (v == null ? "" : String(v)));
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

  async function getAllKeys() {
    const keys = await csCall("getKeys", []);
    return Array.isArray(keys) ? keys : [];
  }

  async function wipeLegacy() {
    if (!hasCloud()) return;
    try {
      const keys = await getAllKeys();
      const drop = keys.filter((k) => {
        const s = String(k);
        return s === "g8n" || s.indexOf("g8c") === 0 || s === "g8" || LEGACY_PREFIXES.some((p) => s.indexOf(p) === 0);
      });
      if (drop.length) await removeItems(drop);
    } catch (e) {}
  }

  async function read() {
    if (!hasCloud()) return null;
    try {
      const single = await getItem(DATA_KEY);
      if (single) return single;
    } catch (e) {}
    try {
      const nRaw = await getItem(META_KEY);
      const n = parseInt(nRaw, 10);
      if (!n || n < 1) return null;
      const keys = [];
      for (let i = 0; i < n; i++) keys.push(CHUNK_PREFIX + i);
      const parts = await getItems(keys);
      let raw = "";
      for (let i = 0; i < n; i++) raw += parts[CHUNK_PREFIX + i] || "";
      return raw || null;
    } catch (e) {
      return null;
    }
  }

  async function writeNow(raw) {
    if (!hasCloud() || raw == null) return;
    if (raw.length <= CHUNK) {
      await setItem(DATA_KEY, raw);
      try {
        const oldN = parseInt(await getItem(META_KEY), 10) || 0;
        const extra = [];
        if (oldN) {
          extra.push(META_KEY);
          for (let i = 0; i < oldN; i++) extra.push(CHUNK_PREFIX + i);
        }
        if (extra.length) await removeItems(extra);
      } catch (e) {}
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
      if (typeof toast === "function") toast("Telegram не сохранил облако. Нажми Allow, если спросит.", true);
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

  function persistNow(raw) {
    if (!hasCloud()) return Promise.resolve();
    pendingRaw = raw;
    clearTimeout(writeTimer);
    return runWriteQueue();
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
        return s === DATA_KEY || s === META_KEY || s.indexOf(CHUNK_PREFIX) === 0 || s === "g8n" || s.indexOf("g8c") === 0;
      });
      if (drop.length) await removeItems(drop);
      else await removeItems([DATA_KEY, META_KEY, CHUNK_PREFIX + "0"]);
    } catch (err) {
      console.warn("GymTg wipe", err);
    }
  }

  return {
    boot, inTelegram, hasCloud, read, persist, persistNow, flush, wipe, wipeLegacy,
    viewportHeight, applyChrome, setSwipeLock
  };
})();
