/* Сейв на своём бэкенде. Один герой на качалку. */

const GymNet = (() => {
  const ENDPOINT = "/save";
  let writeTimer = 0;
  let pending = null;
  let lastError = "";

  function setError(err) {
    lastError = err && err.message ? err.message : String(err || "");
    return lastError;
  }

  async function req(method, body) {
    const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), 12000) : 0;
    let res;
    try {
      res = await fetch(ENDPOINT, {
        method: method,
        headers: body == null ? undefined : { "Content-Type": "application/json" },
        body: body == null ? undefined : body,
        signal: ctrl ? ctrl.signal : undefined
      });
    } catch (e) {
      if (e && e.name === "AbortError") throw new Error("таймаут сервера");
      throw new Error("сервер недоступен: " + (e && e.message || "нет ответа"));
    } finally {
      if (timer) clearTimeout(timer);
    }
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
  }

  function read() {
    return req("GET");
  }

  function writeNow(raw) {
    return req("PUT", raw);
  }

  function persist(raw) {
    pending = raw;
    clearTimeout(writeTimer);
    writeTimer = setTimeout(() => {
      const cur = pending;
      pending = null;
      writeNow(cur).catch((err) => setError(err));
    }, 500);
  }

  function write(raw) {
    pending = null;
    clearTimeout(writeTimer);
    return writeNow(raw).then(() => {
      lastError = "";
      return true;
    });
  }

  async function wipe() {
    try { await req("DELETE"); } catch (e) { setError(e); }
  }

  function errorText() {
    return lastError;
  }

  return { read, write, persist, wipe, errorText, setError };
})();
