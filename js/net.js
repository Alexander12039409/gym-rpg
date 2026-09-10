/* Сейв через Cloudflare Worker. Работает с ПК и с телефона. */

const GymNet = (() => {
  const ENDPOINT = "https://gym-rpg-save.alpop-gymrpg.workers.dev/save";
  let writeTimer = 0;
  let pending = null;

  function initData() {
    try {
      return (window.Telegram && Telegram.WebApp && Telegram.WebApp.initData) || "";
    } catch (e) {
      return "";
    }
  }

  async function req(method, body) {
    const data = initData();
    if (!data) throw new Error("Нет Mini App. Открой из Telegram, не из браузера.");
    const res = await fetch(ENDPOINT, {
      method,
      headers: {
        Authorization: "tma " + data,
        "Content-Type": "application/json"
      },
      body: body == null ? undefined : body
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
  }

  async function read() {
    return req("GET");
  }

  async function writeNow(raw) {
    await req("PUT", raw);
  }

  function persist(raw) {
    pending = raw;
    clearTimeout(writeTimer);
    writeTimer = setTimeout(() => {
      const cur = pending;
      pending = null;
      writeNow(cur).catch((err) => console.warn("GymNet", err));
    }, 700);
  }

  function write(raw) {
    pending = null;
    clearTimeout(writeTimer);
    return writeNow(raw);
  }

  async function wipe() {
    try { await req("DELETE"); } catch (e) {}
  }

  return { read, write, persist, wipe };
})();
