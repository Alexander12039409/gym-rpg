/* Gym RPG — только оболочка Mini App. Сейв не здесь. */

const GymTg = (() => {
  let booted = false;

  function webApp() {
    try { return window.Telegram && window.Telegram.WebApp; }
    catch (e) { return null; }
  }

  function inTelegram() {
    const tg = webApp();
    if (window.TelegramWebviewProxy) return true;
    if (tg && (tg.initData || (tg.initDataUnsafe && tg.initDataUnsafe.user))) return true;
    if (/Telegram/i.test(navigator.userAgent || "")) return true;
    return false;
  }

  function statusText() {
    if (!inTelegram()) return "Открой качалку кнопкой в боте.";
    return "Сейв на своём сервере, не в Telegram.";
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
  }

  return { boot, inTelegram, statusText, viewportHeight, applyChrome, setSwipeLock };
})();
