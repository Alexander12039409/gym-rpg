/* Сносит старых героев из localStorage и Telegram CloudStorage. Текущий gymRpgV10 не трогает. */

const GymPurge = (() => {
  const KEEP_LOCAL = "gymRpgV10";
  const CLOUD_FIXED = ["gr10d", "gr10n", "gr9d", "gr9n", "gr8d", "gr8n"];

  function dropLocalOld() {
    const extra = ["gymRpgV4", "gymRpgV5", "gymRpgV6", "gymRpgV7", "gymRpgV8", "gymRpgV9"];
    extra.forEach((k) => {
      try { localStorage.removeItem(k); } catch (e) {}
    });
    try {
      const names = [];
      for (let i = 0; i < localStorage.length; i++) names.push(localStorage.key(i));
      names.forEach((k) => {
        if (!k || k === KEEP_LOCAL) return;
        if (/^gymRpg/i.test(k)) localStorage.removeItem(k);
      });
    } catch (e) {}
  }

  function isGymCloudKey(k) {
    const s = String(k || "");
    return /^gr\d/i.test(s) || /^gymRpg/i.test(s) || /^gym/i.test(s);
  }

  function cloud() {
    try { return window.Telegram && Telegram.WebApp && Telegram.WebApp.CloudStorage; }
    catch (e) { return null; }
  }

  function listKeys() {
    return new Promise((resolve) => {
      const cs = cloud();
      if (!cs || typeof cs.getKeys !== "function") return resolve([]);
      let done = false;
      const finish = (v) => { if (done) return; done = true; resolve(v); };
      setTimeout(() => finish([]), 5000);
      try {
        cs.getKeys((err, keys) => finish(Array.isArray(keys) ? keys : []));
      } catch (e) {
        finish([]);
      }
    });
  }

  function removeKeys(keys) {
    return new Promise((resolve) => {
      const cs = cloud();
      const uniq = [];
      (keys || []).forEach((k) => {
        if (k && uniq.indexOf(k) < 0) uniq.push(k);
      });
      if (!cs || !uniq.length) return resolve();
      let done = false;
      const finish = () => { if (done) return; done = true; resolve(); };
      setTimeout(finish, 5000);
      try {
        if (typeof cs.removeItems === "function") cs.removeItems(uniq, () => finish());
        else finish();
      } catch (e) {
        finish();
      }
    });
  }

  async function run() {
    dropLocalOld();
    const guessed = CLOUD_FIXED.slice();
    for (let i = 0; i < 32; i++) {
      guessed.push("gr10c" + i, "gr9c" + i, "gr8c" + i);
    }
    let listed = [];
    try { listed = await listKeys(); } catch (e) {}
    const drop = listed.filter(isGymCloudKey).concat(guessed);
    await removeKeys(drop);
    if (window.GymTg && typeof GymTg.wipe === "function") {
      try { await GymTg.wipe(); } catch (e) {}
    }
  }

  return { run };
})();
