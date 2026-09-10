/* Только старые локальные ключи. Текущий облачный сейв больше не трогаем. */

const GymPurge = (() => {
  const KEEP_LOCAL = "gymRpgV10";

  function dropLocalOld() {
    ["gymRpgV4", "gymRpgV5", "gymRpgV6", "gymRpgV7", "gymRpgV8", "gymRpgV9"].forEach((k) => {
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

  async function run() {
    dropLocalOld();
  }

  return { run };
})();
