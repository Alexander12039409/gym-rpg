/* Gym RPG — логика. Обычные скрипты, без import, чтобы file:// работал. */

const $ = (id) => document.getElementById(id);
const MONTHS = ["Январь","Февраль","Март","Апрель","Май","Июнь","Июль","Август","Сентябрь","Октябрь","Ноябрь","Декабрь"];

function uid(prefix) {
  return prefix + "-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

function toast(msg, warn) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.toggle("warn", !!warn);
  t.classList.add("on");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove("on"), warn ? 7000 : 3200);
}

let state = emptyState();
let calCursor = new Date();
let sheetPlanId = null;
let sheetDayId = null;
let sheetBossIndex = 0;
let pathTab = "xp";
let lastFightIndex = 0;
let dayDraft = null;
let rewardQueue = [];
let pendingEvent = null;
let active = null;
let draftBody = null;
let draftExp = null;
let heroEditing = false;
let collapsedPlans = {};

function emptyState() {
  return {
    user: null,
    plans: [],
    currentBoss: 0,
    currentHp: BOSSES[0].hp,
    revengeKills: 0,
    lastWeights: {},
    history: [],
    achievements: [],
    hintSeen: false,
    lastNudgeAt: 0
  };
}

function parseSave(raw) {
  try {
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.user) return null;
    return parsed;
  } catch (e) {
    return null;
  }
}

function isKeeper(user) {
  return String(user && user.name || "").replace(/\s+/g, " ").trim().toLowerCase() === KEEPER_NAME;
}

function peekSave(key) {
  try { return parseSave(localStorage.getItem(key)); }
  catch (e) { return null; }
}

function findKeeperSave() {
  const keys = [STORAGE_KEY].concat(OLD_STORAGE_KEYS);
  for (let i = 0; i < keys.length; i++) {
    const parsed = peekSave(keys[i]);
    if (parsed && isKeeper(parsed.user)) return parsed;
  }
  return null;
}

function forgetOldSaves() {
  OLD_STORAGE_KEYS.forEach((k) => {
    try { localStorage.removeItem(k); } catch (e) {}
  });
}

function save(opts) {
  state.savedAt = Date.now();
  const raw = JSON.stringify(state);
  try { localStorage.setItem(STORAGE_KEY, raw); } catch (e) {}
  const immediate = !!(opts && opts.immediate);
  if (!window.GymNet) return Promise.resolve(false);
  if (!immediate) {
    GymNet.persist(raw);
    return Promise.resolve(false);
  }
  return GymNet.write(raw).then(() => true).catch((err) => {
    console.warn(err);
    return false;
  });
}

function load() {
  const parsed = parseSave(localStorage.getItem(STORAGE_KEY));
  if (!parsed) return false;
  state = Object.assign(emptyState(), parsed);
  return true;
}

function newestSave(a, b) {
  if (a && b) return (a.savedAt || 0) >= (b.savedAt || 0) ? a : b;
  return a || b;
}

async function hydrate() {
  const localAny = peekSave(STORAGE_KEY) || findKeeperSave();
  forgetOldSaves();

  let netObj = null;
  if (window.GymNet) {
    try { netObj = parseSave(await GymNet.read()); } catch (e) { console.warn(e); }
  }

  const pick = newestSave(netObj, localAny);
  if (!pick || !pick.user) return false;
  state = Object.assign(emptyState(), pick);
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {}
  const raw = JSON.stringify(state);
  if (window.GymNet) {
    try {
      await GymNet.write(raw);
    } catch (e) {
      toast("Герой на этом устройстве есть, в облако не ушёл: " + (((e && e.message) || (GymNet.errorText && GymNet.errorText()) || "нет ответа") + "").slice(0, 180), true);
    }
  }
  return true;
}

function hideBootVeil() {
  document.documentElement.classList.add("boot-done");
  const el = $("boot-veil");
  if (el) el.remove();
}

function fightBossData(i) {
  const b = BOSSES[Math.min(Math.max(0, i), BOSSES.length - 1)];
  if (b.endless) {
    const mul = Math.pow(1.28, state.revengeKills || 0);
    return Object.assign({}, b, { hp: Math.round(b.hp * mul) });
  }
  return b;
}

function currentBossData() {
  if (active && active.bossIndex != null) return fightBossData(active.bossIndex);
  return fightBossData(state.currentBoss);
}

function bossPortrait(b, hp, maxHp) {
  const pct = maxHp > 0 ? hp / maxHp : 1;
  let n = 0;
  if (pct <= 0.30) n = 3;
  else if (pct <= 0.50) n = 2;
  else if (pct <= 0.75) n = 1;
  if (!n) return b.img;
  return "assets/bosses/boss-" + b.id + "-hurt" + n + ".png";
}

function setBossImg(el, b, hp, maxHp) {
  if (!el) return;
  const src = bossPortrait(b, hp, maxHp);
  el.onerror = function () {
    this.onerror = null;
    this.src = b.img;
  };
  if (el.getAttribute("src") !== src) el.src = src;
}

function parseMathInput(raw) {
  const s = String(raw ?? "").trim().replace(/\s+/g, "").replace(/,/g, ".");
  if (!s) return { ok: false };
  if (!/^[0-9.+-]+$/.test(s)) return { ok: false };
  if (/[.]{2,}/.test(s)) return { ok: false };
  if (/[+-]$/.test(s)) return { ok: false };
  const body = s.charAt(0) === "-" ? s.slice(1) : s;
  if (/[+-]{2,}/.test(body)) return { ok: false };
  const parts = s.match(/[+-]?\d*\.?\d+/g);
  if (!parts || !parts.length) return { ok: false };
  const n = parts.reduce((a, t) => a + Number(t), 0);
  if (!isFinite(n)) return { ok: false };
  return { ok: true, value: n };
}

function commitMathField(el, asInt) {
  const p = parseMathInput(el.value);
  if (!p.ok) return;
  let v = asInt ? Math.round(p.value) : Math.round(p.value * 100) / 100;
  if (v < 0) v = 0;
  el.value = String(v);
}

function showScreen(id) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("on"));
  $(id).classList.add("on");
}

function showView(name) {
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("on"));
  document.querySelectorAll(".bottom-nav button").forEach((b) => {
    b.classList.toggle("on", b.dataset.view === name);
  });
  $("view-" + name).classList.add("on");
  if (window.GymTg && GymTg.setSwipeLock) GymTg.setSwipeLock(name === "map");
  if (name === "map") renderMap();
  if (name === "plans") renderPlans();
  if (name === "path") renderPath();
  if (name === "cal") renderCalendar();
  if (name === "log") renderHistory();
}

function refreshTop() {
  const u = state.user;
  $("top-hero").src = heroImg(u);
  $("top-name").textContent = u.name;
  $("top-title").textContent = "Ур. " + u.level + " · " + levelTitle(u);
  const need = xpToNext(u.level);
  $("top-xp").style.width = Math.min(100, (u.xp / need) * 100) + "%";
}

function grantAch(id) {
  state.achievements = state.achievements || [];
  if (state.achievements.includes(id)) return;
  state.achievements.push(id);
  const a = ACHIEVEMENTS.find((x) => x.id === id);
  if (a) toast("Нашивка: " + a.name);
}

function addXp(amount) {
  const u = state.user;
  u.xp += Math.max(0, Math.round(amount));
  const gained = [];
  while (u.xp >= xpToNext(u.level)) {
    u.xp -= xpToNext(u.level);
    u.level += 1;
    gained.push({ level: u.level, title: levelTitle(u) });
  }
  return gained;
}

/* —— создание —— */
function createSex() {
  return document.querySelector(".sex.on")?.dataset.sex || "m";
}

function renderBodyCarousel() {
  const box = $("body-carousel");
  if (!box) return;
  const g = createSex();
  box.innerHTML = BODY_TYPES.map((t) => `
    <button type="button" class="body-card ${draftBody === t.id ? "on" : ""}" data-body="${t.id}">
      <img src="${bodyArt(g, t.id)}" alt="" />
      <h3 class="display">${esc(t.name)}</h3>
      <div class="fat-row">
        <span class="chip">жир ~${t.fat[g]}%</span>
        <span class="chip">мышцы ~${t.muscle[g]}%</span>
      </div>
      <p>${esc(bodyBlurb(t, g))}</p>
    </button>
  `).join("");
  box.querySelectorAll(".body-card").forEach((el) => {
    el.addEventListener("click", () => {
      draftBody = el.dataset.body;
      renderBodyCarousel();
      previewCreate();
    });
  });
}

function renderExpChips() {
  const box = $("exp-chips");
  const note = $("exp-note");
  if (!box) return;
  box.innerHTML = EXPERIENCE.map((e) => `
    <button type="button" class="exp-chip ${draftExp === e.id ? "on" : ""}" data-exp="${e.id}">
      ${esc(e.name)}<small>${esc(e.tag)}</small>
    </button>
  `).join("");
  box.querySelectorAll(".exp-chip").forEach((el) => {
    el.addEventListener("click", () => {
      draftExp = el.dataset.exp;
      renderExpChips();
    });
  });
  if (!note) return;
  const cur = expById(draftExp);
  if (!cur) {
    note.className = "exp-note";
    note.textContent = "Ткни стаж — коротко скажу, что с этим делать и где не геройствовать.";
    return;
  }
  note.className = "exp-note" + (cur.warn ? " warn" : "");
  note.textContent = cur.text;
}

async function createHero() {
  const name = $("char-name").value.trim() || "Безымянный";
  const weight = parseFloat($("char-weight").value) || 75;
  const height = parseFloat($("char-height").value) || 175;
  const goal = $("char-goal").value;
  const gender = createSex();
  const problems = [...document.querySelectorAll(".zone.on")].map((el) => el.dataset.zone);
  if (!draftBody) return toast("Выбери, на кого похож. Карточка — это чипс, ткни.", true);
  if (!draftExp) return toast("Укажи тренировочный стаж.", true);
  if (!problems.length) return toast("Выбери хотя бы одну проблемную зону. Не стесняйся.", true);
  const bmi = weight / ((height / 100) ** 2);
  state.user = {
    name, weight, height, bmi, goal, gender,
    problems,
    primaryProblem: primaryProblem(problems),
    bodyType: draftBody,
    experience: draftExp,
    createdAt: Date.now(),
    level: 1,
    xp: 0
  };
  state.currentBoss = 0;
  state.currentHp = BOSSES[0].hp;
  $("btn-create").disabled = true;
  try {
    const cloudOk = await save({ immediate: true });
    if (cloudOk) toast("Герой записан в облако.");
    else toast("В облако не ушло: " + (((window.GymNet && GymNet.errorText()) || "нет ответа") + "").slice(0, 160), true);
    showSummary();
  } catch (e) {
    toast("Облако ошибка: " + ((e && e.message) || e), true);
    showSummary();
  } finally {
    $("btn-create").disabled = false;
  }
}

function summaryHtml(user, opts) {
  opts = opts || {};
  const bt = bodyTypeById(user.bodyType);
  const ex = expById(user.experience);
  const g = user.gender === "f" ? "f" : "m";
  const packs = opts.packs ? recommendedPacks(user) : [];
  const portrait = opts.portrait !== false;
  return `
    ${portrait ? `<div class="create-hero"><img src="${heroImg(user)}" alt="" /></div>
    <h2 class="display" style="text-align:center;margin:0 0 6px">${esc(user.name)}</h2>
    <p class="muted" style="text-align:center;margin-bottom:12px">${user.height} см · ${user.weight} кг · ${esc(GOAL_LABELS[user.goal] || "")}</p>` : ""}
    ${bt ? `
      <div class="pack-card">
        <img class="hero-portrait" src="${bodyArt(g, bt.id)}" alt="" />
        <h3 class="display">${esc(bt.name)}</h3>
        <div class="stat-pills">
          <span>жир ~${bt.fat[g]}%</span>
          <span>мышцы ~${bt.muscle[g]}%</span>
        </div>
        <p>${esc(bodyBlurb(bt, g))}</p>
      </div>
    ` : ""}
    ${ex ? `
      <div class="pack-card">
        <h3 class="display">${esc(ex.name)}</h3>
        <div class="muted">${esc(ex.tag)}</div>
        <p>${esc(ex.text)}</p>
      </div>
    ` : ""}
    ${packs.length ? `
      <h3 class="day-sec">Тебе зайдёт для старта</h3>
      <p class="muted">Классика. Ткни — план сразу в книгу, дни и упражнения уже внутри.</p>
      ${packs.map((p) => `
        <div class="pack-card">
          <h3>${esc(p.name)}</h3>
          <p class="muted">${esc(p.blurb)}</p>
          <div class="muted">${p.days.length} дня · ${p.days.map((d) => d.name).join(" · ")}</div>
          <button class="btn" data-add-pack="${p.id}">Добавить «${esc(p.name)}»</button>
        </div>
      `).join("")}
    ` : ""}
  `;
}

function showSummary() {
  const wrap = $("summary-wrap");
  wrap.innerHTML = summaryHtml(state.user, { packs: true }) + `<button class="btn pink" id="btn-summary-go">В качалку</button>`;
  wrap.querySelectorAll("[data-add-pack]").forEach((b) => {
    b.addEventListener("click", () => addPackById(b.dataset.addPack));
  });
  $("btn-summary-go").addEventListener("click", bootApp);
  showScreen("screen-summary");
  wrap.scrollTop = 0;
}

function addPackById(id, silent) {
  const pack = PROGRAM_PACKS.find((p) => p.id === id);
  if (!pack) return;
  if (state.plans.some((p) => p.templateId === pack.id)) {
    toast("Этот шаблон уже в книге.");
    return;
  }
  state.plans.push({
    id: uid("plan"),
    name: pack.name,
    description: pack.blurb,
    templateId: pack.id,
    days: pack.days.map((d) => ({
      id: uid("day"),
      name: d.name,
      description: d.description,
      exercises: d.exercises.map((e) => Object.assign({ id: uid("ex") }, e))
    }))
  });
  save();
  toast("План «" + pack.name + "» в книге.");
  if (!silent) renderPlans();
}

function randomBestSet() {
  const cands = [];
  (state.history || []).forEach((h) => {
    (h.exercises || []).forEach((e) => {
      (e.sets || []).forEach((s) => {
        if (!s.weight || !s.reps) return;
        cands.push({
          name: e.name,
          weight: s.weight,
          reps: s.reps,
          damage: s.damage,
          date: h.dateLabel,
          score: Number(s.weight) * Number(s.reps)
        });
      });
    });
  });
  if (!cands.length) return null;
  cands.sort((a, b) => b.score - a.score);
  return sample(cands.slice(0, Math.min(5, cands.length)));
}

function renderHeroScreen() {
  const u = state.user;
  const wrap = $("hero-screen-wrap");
  if (!u || !wrap) return;
  const pb = randomBestSet();
  const g = u.gender === "f" ? "f" : "m";
  wrap.innerHTML = `
    <button class="btn ghost" id="btn-hero-back" type="button">← На карту</button>
    <div class="create-hero"><img src="${heroImg(u)}" alt="" /></div>
    <h2 class="display" style="text-align:center;margin:0 0 4px">${esc(u.name)}</h2>
    <p class="muted" style="text-align:center">Ур. ${u.level} · ${esc(levelTitle(u))}</p>
    ${summaryHtml(u, { portrait: false, packs: false })}
    <div class="pack-card">
      <h3 class="display">Лучшее из зала</h3>
      ${pb
        ? `<p><b>${esc(pb.name)}</b> · ${pb.weight} кг × ${pb.reps}<br><span class="muted">${esc(pb.date)}${pb.damage ? " · урон " + pb.damage : ""}</span></p>`
        : `<p class="muted">Пока пусто. Сходи в рейд — появится случайный жирный подход.</p>`}
    </div>
    <button class="btn" id="btn-hero-edit" type="button">${heroEditing ? "Скрыть правку" : "Редактировать"}</button>
    <div class="hero-edit ${heroEditing ? "on" : ""}" id="hero-edit">
      <label class="lbl">Имя</label>
      <input class="field" id="hero-name" value="${esc(u.name)}" enterkeyhint="done" />
      <div class="row2">
        <div class="grow">
          <label class="lbl">Вес, кг</label>
          <input class="field" id="hero-weight" type="number" inputmode="decimal" enterkeyhint="done" value="${esc(u.weight)}" />
        </div>
        <div class="grow">
          <label class="lbl">Рост, см</label>
          <input class="field" id="hero-height" type="number" inputmode="numeric" enterkeyhint="done" value="${esc(u.height)}" />
        </div>
      </div>
      <label class="lbl">Цель</label>
      <select class="field" id="hero-goal">
        <option value="gain"${u.goal === "gain" ? " selected" : ""}>Стать машиной</option>
        <option value="lose"${u.goal === "lose" ? " selected" : ""}>Просушиться</option>
        <option value="fit"${u.goal === "fit" ? " selected" : ""}>Тонус</option>
      </select>
      <label class="lbl">Фигура</label>
      <div class="body-carousel" id="hero-body-carousel"></div>
      <label class="lbl">Стаж</label>
      <div class="exp-chips" id="hero-exp-chips"></div>
      <p class="exp-note" id="hero-exp-note"></p>
      <button class="btn lime" id="btn-hero-save" type="button">Сохранить</button>
    </div>
    <button class="btn pink" id="btn-reset" type="button">Перерождение (сброс)</button>
  `;
  $("btn-hero-back").addEventListener("click", closeHero);
  $("btn-hero-edit").addEventListener("click", () => {
    heroEditing = !heroEditing;
    renderHeroScreen();
  });
  $("btn-reset").addEventListener("click", async () => {
    if (!confirm("Снести героя, планы и летопись?")) return;
    forgetOldSaves();
    localStorage.removeItem(STORAGE_KEY);
    if (window.GymTg) await GymTg.wipe();
    if (window.GymNet) await GymNet.wipe();
    location.reload();
  });
  if (heroEditing) {
    bindHeroEdit();
  }
}

function bindHeroEdit() {
  const u = state.user;
  const g = u.gender === "f" ? "f" : "m";
  const box = $("hero-body-carousel");
  let body = u.bodyType;
  let exp = u.experience;
  const paintBody = () => {
    box.innerHTML = BODY_TYPES.map((t) => `
      <button type="button" class="body-card ${body === t.id ? "on" : ""}" data-body="${t.id}">
        <img src="${bodyArt(g, t.id)}" alt="" />
        <h3 class="display">${esc(t.name)}</h3>
        <div class="fat-row">
          <span class="chip">жир ~${t.fat[g]}%</span>
          <span class="chip">мышцы ~${t.muscle[g]}%</span>
        </div>
        <p>${esc(bodyBlurb(t, g))}</p>
      </button>
    `).join("");
    box.querySelectorAll(".body-card").forEach((el) => {
      el.addEventListener("click", () => { body = el.dataset.body; paintBody(); });
    });
  };
  const paintExp = () => {
    const chips = $("hero-exp-chips");
    const note = $("hero-exp-note");
    chips.innerHTML = EXPERIENCE.map((e) => `
      <button type="button" class="exp-chip ${exp === e.id ? "on" : ""}" data-exp="${e.id}">
        ${esc(e.name)}<small>${esc(e.tag)}</small>
      </button>
    `).join("");
    chips.querySelectorAll(".exp-chip").forEach((el) => {
      el.addEventListener("click", () => { exp = el.dataset.exp; paintExp(); });
    });
    const cur = expById(exp);
    note.className = "exp-note" + (cur && cur.warn ? " warn" : "");
    note.textContent = cur ? cur.text : "";
  };
  paintBody();
  paintExp();
  $("btn-hero-save").addEventListener("click", async () => {
    const name = $("hero-name").value.trim() || u.name;
    const weight = parseFloat($("hero-weight").value);
    const height = parseFloat($("hero-height").value);
    if (!weight || weight < 30) return toast("Вес странный.", true);
    if (!height || height < 120) return toast("Рост странный.", true);
    u.name = name;
    u.weight = weight;
    u.height = height;
    u.bmi = weight / ((height / 100) ** 2);
    u.goal = $("hero-goal").value;
    u.bodyType = body;
    u.experience = exp;
    $("btn-hero-save").disabled = true;
    try {
      const ok = await save({ immediate: true });
      heroEditing = false;
      refreshTop();
      toast(ok ? "Герой обновлён и улетел в облако." : ("В облако не ушло: " + (((window.GymNet && GymNet.errorText()) || "нет ответа") + "").slice(0, 160)), !ok);
      renderHeroScreen();
    } finally {
      $("btn-hero-save").disabled = false;
    }
  });
}

function daysIdle() {
  if (state.history && state.history.length) {
    const iso = state.history[0].dateISO;
    const t = iso ? Date.parse(iso) : 0;
    if (!t) return 0;
    return (Date.now() - t) / 86400000;
  }
  const created = state.user && state.user.createdAt;
  if (!created) return 0;
  return (Date.now() - created) / 86400000;
}

function maybeNudge() {
  if (!state.user) return;
  if (daysIdle() < NUDGE_AFTER_DAYS) return;
  const last = state.lastNudgeAt || 0;
  if (Date.now() - last < 20 * 60 * 60 * 1000) return;
  const q = sample(QUOTES);
  $("nudge-quote").textContent = "«" + q.text + "»";
  $("nudge-source").textContent = q.source;
  $("backdrop").classList.add("on");
  $("modal-nudge").classList.add("on");
}

function closeNudge() {
  state.lastNudgeAt = Date.now();
  save();
  $("modal-nudge").classList.remove("on");
  syncBackdrop();
}

function bootApp() {
  showScreen("screen-app");
  refreshTop();
  showView("map");
  maybeNudge();
}

/* —— карта —— */
const MAP_STEP = 248;

function nodePos(i, w) {
  const extra = i % 3 === 1 ? 34 : (i % 3 === 2 ? -10 : 0);
  const y = 188 + i * MAP_STEP + Math.floor(i / 3) * 30 + extra;
  const amp = Math.min(118, w * 0.32);
  const zig = [-1, 0.88, -0.42, 1, -0.9, 0.5, -0.78, 0.95];
  const x = Math.max(52, Math.min(w - 52, w / 2 + amp * zig[i % zig.length]));
  return { x, y };
}

function mapHeight(w) {
  return nodePos(BOSSES.length - 1, w).y + 230;
}

function roadPath(pts) {
  if (!pts.length) return "";
  if (pts.length === 1) return "M " + pts[0].x + " " + pts[0].y;
  const p = [pts[0]].concat(pts).concat([pts[pts.length - 1]]);
  const t = 0.22;
  let d = "M " + pts[0].x + " " + pts[0].y;
  for (let i = 1; i < p.length - 2; i++) {
    const p0 = p[i - 1];
    const p1 = p[i];
    const p2 = p[i + 1];
    const p3 = p[i + 2];
    const c1x = p1.x + (p2.x - p0.x) * t;
    const c1y = p1.y + (p2.y - p0.y) * t;
    const c2x = p2.x - (p3.x - p1.x) * t;
    const c2y = p2.y - (p3.y - p1.y) * t;
    d += " C " + c1x + " " + c1y + " " + c2x + " " + c2y + " " + p2.x + " " + p2.y;
  }
  return d;
}

function renderMap() {
  const world = $("world");
  const sc = $("world-scroll");
  const w = Math.max(320, (sc && sc.clientWidth) || 360);
  const h = mapHeight(w);
  const pts = BOSSES.map((_, i) => nodePos(i, w));
  const d = roadPath(pts);
  world.style.height = h + "px";

  const nodes = BOSSES.map((b, i) => {
    const p = pts[i];
    let cls = "locked";
    if (i < state.currentBoss) cls = "done";
    if (i === state.currentBoss) cls = "current";
    if (b.endless && state.currentBoss >= i) cls = "current";
    const rev = i < state.currentBoss;
    const portrait = i === state.currentBoss ? bossPortrait(b, state.currentHp, fightBossData(i).hp) : b.img;
    return `
      <div class="boss-node ${cls}" data-boss="${i}" style="left:${p.x}px;top:${p.y}px">
        <div class="pedestal">
          <img src="${portrait}" alt="" onerror="this.onerror=null;this.src='${b.img}'" />
          <div class="lock">🔒</div>
        </div>
        <div class="loc-banner"><i style="background:${esc(b.color || "#e23d3d")}"></i>${esc(b.loc || "")}</div>
        <div class="nm"><span>${esc(b.name)}</span></div>
        ${rev ? `<div class="rev-tag">реванш</div>` : ""}
      </div>`;
  }).join("");

  const cur = nodePos(state.currentBoss, w);
  const pinX = cur.x + (state.currentBoss % 2 === 0 ? 58 : -58);
  const pinY = cur.y + 64;

  world.innerHTML = `
    <svg class="map-art" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMin slice">
      <path d="${d}" fill="none" stroke="#171717" stroke-width="28" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="${d}" fill="none" stroke="#e2b422" stroke-width="18" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="${d}" fill="none" stroke="#fff8e4" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="10 16"/>
    </svg>
    ${nodes}
    <div class="player-pin" style="left:${pinX}px;top:${pinY}px">
      <img src="${heroImg(state.user)}" alt="" />
      <b>ТЫ</b>
    </div>
  `;

  world.querySelectorAll(".boss-node").forEach((el) => {
    el.addEventListener("click", () => onBossClick(+el.dataset.boss));
  });

  focusCurrentNode(false);
}

function focusCurrentNode(smooth) {
  const sc = $("world-scroll");
  const cur = document.querySelector(".boss-node.current");
  if (!sc || !cur) return;
  const run = () => {
    const top = cur.offsetTop - sc.clientHeight * 0.38;
    sc.scrollTo({ top: Math.max(0, top), behavior: smooth ? "smooth" : "auto" });
  };
  requestAnimationFrame(run);
}

function lockViewport() {
  let proxies = [];

  function isMobileShell() {
    return document.documentElement.classList.contains("tg-app")
      || window.matchMedia("(max-width: 519px)").matches;
  }

  function isTextField(el) {
    if (!el || el.disabled || el.readOnly) return false;
    const tag = el.tagName;
    if (tag === "TEXTAREA" || tag === "SELECT") return true;
    if (tag !== "INPUT") return false;
    const t = (el.type || "text").toLowerCase();
    return ["button", "submit", "reset", "checkbox", "radio", "file", "hidden", "range", "color", "image"].indexOf(t) < 0;
  }

  function syncChrome() {
    if (!isMobileShell()) {
      document.documentElement.style.removeProperty("--app-h");
      document.documentElement.style.removeProperty("--vv-top");
      return;
    }
    if (document.documentElement.classList.contains("kb-open")) return;
    const tgH = window.GymTg && document.documentElement.classList.contains("tg-app")
      ? GymTg.viewportHeight()
      : Math.round(window.innerHeight);
    document.documentElement.style.setProperty("--app-h", tgH + "px");
    document.documentElement.style.setProperty("--vv-top", "0px");
    if (window.scrollY || window.scrollX) window.scrollTo(0, 0);
  }

  function pinLayer() {
    const layer = $("kb-layer");
    if (!layer) return;
    const on = document.documentElement.classList.contains("kb-open");
    layer.setAttribute("aria-hidden", on ? "false" : "true");
    if (!on) {
      layer.style.top = "";
      layer.style.left = "";
      layer.style.width = "";
      layer.style.height = "";
      return;
    }
    const app = document.querySelector(".app");
    const vv = window.visualViewport;
    if (isMobileShell() && vv) {
      layer.style.top = Math.round(vv.offsetTop || 0) + "px";
      layer.style.left = Math.round(vv.offsetLeft || 0) + "px";
      layer.style.height = Math.round(vv.height || window.innerHeight) + "px";
      layer.style.width = Math.round(vv.width || window.innerWidth) + "px";
      return;
    }
    if (app) {
      const r = app.getBoundingClientRect();
      layer.style.top = Math.round(r.top) + "px";
      layer.style.left = Math.round(r.left) + "px";
      layer.style.width = Math.round(r.width) + "px";
      layer.style.height = Math.round(r.height) + "px";
    }
  }

  function fillHead(el) {
    const head = $("kb-sheet-head");
    if (!head) return;
    let text = "";
    if (el.id === "hit-w" || el.id === "hit-r" || el.closest("#kb-hit")) {
      const ex = active && active.exercises && active.exercises[active.cardIndex];
      text = ex && ex.name ? ex.name : "Подход";
    } else if (el.closest(".ex-edit")) {
      const h = el.closest(".ex-edit").querySelector(".ex-edit-head h3");
      text = h ? h.textContent : "Упражнение";
    } else {
      const box = el.closest(".grow");
      const prev = el.previousElementSibling;
      const lbl = (box && box.querySelector(".lbl")) || (prev && prev.classList.contains("lbl") ? prev : null);
      if (lbl) text = lbl.textContent;
      if (!text) {
        const card = el.closest(".card");
        const h3 = card && card.querySelector("h3");
        if (h3) text = h3.textContent;
        else if (el.getAttribute("placeholder")) text = el.getAttribute("placeholder");
      }
    }
    head.textContent = text;
  }

  function flushProxy() {
    proxies.forEach(({ src, clone }) => {
      src.value = clone.value;
      try { src.dispatchEvent(new Event("input", { bubbles: true })); } catch (err) {}
    });
  }

  function clearProxy() {
    flushProxy();
    const box = $("kb-proxy");
    if (box) box.innerHTML = "";
    proxies = [];
  }

  function cloneField(src) {
    const clone = src.cloneNode(true);
    clone.removeAttribute("id");
    Array.from(clone.attributes).forEach((a) => {
      if (a.name.indexOf("data-") === 0) clone.removeAttribute(a.name);
    });
    clone.value = src.value;
    clone.addEventListener("input", () => { src.value = clone.value; });
    clone.addEventListener("change", () => { src.value = clone.value; });
    proxies.push({ src, clone });
    return clone;
  }

  function setHitVisible(on) {
    const hit = $("kb-hit");
    const proxy = $("kb-proxy");
    if (hit) hit.hidden = !on;
    if (proxy) proxy.hidden = !!on;
  }

  function closeKb() {
    clearProxy();
    setHitVisible(false);
    document.documentElement.classList.remove("kb-open");
    pinLayer();
    setTimeout(() => {
      if (!document.documentElement.classList.contains("kb-open")) syncChrome();
    }, 60);
  }

  function dismiss(cb) {
    const ae = document.activeElement;
    if (isTextField(ae)) {
      try { ae.blur(); } catch (err) {}
    }
    closeKb();
    if (typeof cb !== "function") return;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setTimeout(cb, 80));
    });
  }

  function openBattleHitSheet() {
    clearProxy();
    setHitVisible(true);
    const ex = active && active.exercises && active.exercises[active.cardIndex];
    const head = $("kb-sheet-head");
    if (head) head.textContent = ex && ex.name ? ex.name : "Подход";
    document.documentElement.classList.add("kb-open");
    pinLayer();
    const w = $("hit-w");
    if (w) {
      try { w.focus({ preventScroll: true }); }
      catch (err) { w.focus(); }
    }
  }

  function openSheetFor(el) {
    if (el.closest && el.closest("#kb-layer")) return;
    if (el.id === "hit-w" || el.id === "hit-r") {
      openBattleHitSheet();
      return;
    }
    if (!isMobileShell()) return;
    fillHead(el);
    if (proxies.some((p) => p.src === el)) {
      document.documentElement.classList.add("kb-open");
      pinLayer();
      return;
    }
    clearProxy();
    setHitVisible(false);
    const box = $("kb-proxy");
    if (!box) return;
    box.hidden = false;
    const block = el.closest(".ex-edit");
    const sources = block
      ? Array.from(block.querySelectorAll("input.field, textarea.field, select.field"))
      : [el];
    let focusClone = null;
    sources.forEach((src) => {
      const clone = cloneField(src);
      box.appendChild(clone);
      if (src === el) focusClone = clone;
    });
    document.documentElement.classList.add("kb-open");
    pinLayer();
    const toFocus = focusClone || box.querySelector(".field");
    if (toFocus) {
      try { toFocus.focus({ preventScroll: true }); }
      catch (err) { toFocus.focus(); }
    }
  }

  function onFocusIn(e) {
    if (!isTextField(e.target)) return;
    if (e.target.closest("#kb-layer")) return;
    if (!isMobileShell()) return;
    openSheetFor(e.target);
  }

  function onFocusOut() {
    setTimeout(() => {
      const ae = document.activeElement;
      const sheet = $("kb-sheet");
      if (isTextField(ae) && ae.closest && ae.closest("#kb-layer")) return;
      if (isTextField(ae) && isMobileShell()) {
        openSheetFor(ae);
        return;
      }
      if (ae && ae.id === "kb-veil") {
        closeKb();
        return;
      }
      if (sheet && ae && sheet.contains(ae)) return;
      closeKb();
    }, 0);
  }

  function onVeil(e) {
    e.preventDefault();
    const ae = document.activeElement;
    if (isTextField(ae)) ae.blur();
    closeKb();
  }

  function onKeyDown(e) {
    if (e.key !== "Enter" || e.isComposing) return;
    const el = e.target;
    if (!isTextField(el) || el.tagName === "TEXTAREA" || el.tagName === "SELECT") return;
    if (el.id === "hit-w" || el.id === "hit-r") return;
    e.preventDefault();
    el.blur();
  }

  function onViewport() {
    pinLayer();
    syncChrome();
  }

  try {
    if (navigator.virtualKeyboard) navigator.virtualKeyboard.overlaysContent = true;
  } catch (err) {}

  lockViewport.dismiss = dismiss;
  lockViewport.openHit = openBattleHitSheet;
  syncChrome();
  if (lockViewport._on) return;
  lockViewport._on = true;
  window.visualViewport?.addEventListener("resize", onViewport);
  window.visualViewport?.addEventListener("scroll", onViewport);
  window.addEventListener("resize", onViewport);
  window.addEventListener("orientationchange", onViewport);
  document.addEventListener("focusin", onFocusIn);
  document.addEventListener("focusout", onFocusOut);
  document.addEventListener("keydown", onKeyDown);
  const veil = $("kb-veil");
  if (veil) {
    veil.addEventListener("pointerdown", onVeil);
    veil.addEventListener("click", onVeil);
  }
}

function onBossClick(i) {
  if (i > state.currentBoss) {
    toast("Сначала убей предыдущего, герой.", true);
    return;
  }
  openSheet(i);
}

/* —— шторка —— */
function openSheet(bossIndex) {
  if (!state.plans.length) {
    toast("Сначала собери план во вкладке «Планы».", true);
    showView("plans");
    return;
  }
  sheetBossIndex = bossIndex == null ? state.currentBoss : bossIndex;
  const b = fightBossData(sheetBossIndex);
  const rematch = sheetBossIndex < state.currentBoss;
  const hp = rematch ? b.hp : state.currentHp;
  $("sheet-boss").textContent = (rematch ? "Реванш · " : "") + b.name + " · HP " + Math.round(hp) + " / " + b.hp;
  sheetPlanId = state.plans.some((p) => p.id === sheetPlanId) ? sheetPlanId : state.plans[0].id;
  renderSheetPlans();
  $("sheet-deload").checked = false;
  $("backdrop").classList.add("on");
  $("sheet").classList.add("on");
}

function closeSheet() {
  $("sheet").classList.remove("on");
  syncBackdrop();
}

function syncBackdrop() {
  const ids = ["sheet", "sheet-finish", "modal-day", "modal-reward", "modal-event", "modal-results", "modal-nudge"];
  $("backdrop").classList.toggle("on", ids.some((id) => $(id).classList.contains("on")));
}

function renderSheetPlans() {
  $("sheet-plans").innerHTML = state.plans.map((p) =>
    `<span class="plan-chip ${p.id === sheetPlanId ? "on" : ""}" data-pid="${p.id}">${esc(p.name)}</span>`
  ).join("");
  $("sheet-plans").querySelectorAll(".plan-chip").forEach((el) => {
    el.addEventListener("click", () => {
      sheetPlanId = el.dataset.pid;
      renderSheetPlans();
    });
  });
  const plan = state.plans.find((p) => p.id === sheetPlanId);
  const days = (plan && plan.days) || [];
  if (!days.length) {
    $("sheet-days").innerHTML = "<p class='muted'>В плане нет дней. Добавь день во вкладке Планы.</p>";
    return;
  }
  if (!days.some((d) => d.id === sheetDayId)) sheetDayId = days[0].id;
  $("sheet-days").innerHTML = days.map((d) =>
    `<button class="btn ${d.id === sheetDayId ? "pink" : "ghost"} day-pick" data-did="${d.id}">
      <b>${esc(d.name)}</b>
      <div class="muted">${d.exercises.length} упр. · ${esc(d.description || "")}</div>
    </button>`
  ).join("");
  $("sheet-days").querySelectorAll(".day-pick").forEach((el) => {
    el.addEventListener("click", () => {
      sheetDayId = el.dataset.did;
      renderSheetPlans();
    });
  });
}

/* —— планы —— */
function cloneStarter() {
  const plan = {
    id: uid("plan"),
    name: STARTER_PLAN.name,
    description: STARTER_PLAN.description,
    days: STARTER_PLAN.days.map((d) => ({
      id: uid("day"),
      name: d.name,
      description: d.description,
      exercises: d.exercises.map((e) => Object.assign({ id: uid("ex") }, e))
    }))
  };
  state.plans.push(plan);
  save();
  renderPlans();
}

function addPlan() {
  const name = $("plan-name").value.trim();
  if (!name) return toast("Назови план.", true);
  state.plans.push({
    id: uid("plan"),
    name,
    description: $("plan-desc").value.trim(),
    days: []
  });
  $("plan-name").value = "";
  $("plan-desc").value = "";
  save();
  renderPlans();
}

function renderPlans() {
  const box = $("plans-list");
  if (!state.plans.length) {
    box.innerHTML = `<div class="hint">Книга пустая. Создай план или воткни шаблон — дни собираешь заранее, перед боем только выбираешь.</div>`;
  } else {
    box.innerHTML = state.plans.map((p) => {
      const shut = !!collapsedPlans[p.id];
      return `
    <div class="card compact plan-card ${shut ? "shut" : ""}">
      <div class="plan-head">
        <div class="grow">
          <h3>${esc(p.name)}</h3>
          <div class="muted plan-desc">${esc(p.description || "Без описания")}</div>
        </div>
        <div class="plan-tools">
          <button class="btn tiny ghost plan-chevron ${shut ? "" : "open"}" type="button" data-toggle-plan="${p.id}" aria-label="${shut ? "Развернуть" : "Свернуть"}">
            <svg viewBox="0 0 24 24" aria-hidden="true"><polygon points="6,8 18,8 12,17" fill="currentColor"/></svg>
          </button>
          <button class="btn tiny pink" type="button" data-del-plan="${p.id}">Х</button>
        </div>
      </div>
      <div class="plan-body">
      ${(p.days || []).map((d) => `
        <div class="ex-edit" style="margin-top:6px">
          <b>${esc(d.name)}</b>
          <div class="muted plan-desc">${d.exercises.map((e) => esc(e.name)).join(" · ") || "нет упражнений"}</div>
          <div class="flex" style="margin-top:4px">
            <button class="btn tiny ghost" data-edit-day="${p.id}:${d.id}">Править</button>
            <button class="btn tiny pink" data-del-day="${p.id}:${d.id}">Удалить</button>
          </div>
        </div>
      `).join("")}
      <button class="btn" style="margin-top:6px" data-add-day="${p.id}">+ День</button>
      </div>
    </div>`;
    }).join("");
  }
  renderProgramPacks();
}

function renderProgramPacks() {
  const box = $("program-packs");
  if (!box) return;
  box.innerHTML = `
    <h3>Популярные программы</h3>
    <p class="muted">Классика зала: сплиты, фуллбади, тяни-толкай и свой вес. Упражнения уже с описанием.</p>
    ${PROGRAM_PACKS.map((p) => {
      const has = state.plans.some((x) => x.templateId === p.id);
      return `
        <div class="pack-card">
          <h3>${esc(p.name)}</h3>
          <p class="muted">${esc(p.blurb)}</p>
          <div class="muted">${p.days.map((d) => esc(d.name)).join(" · ")}</div>
          <button class="btn ${has ? "ghost" : ""}" data-pack="${p.id}" ${has ? "disabled" : ""}>${has ? "Уже в книге" : "Добавить"}</button>
        </div>`;
    }).join("")}
  `;
}

function openDayEditor(planId, dayId) {
  const plan = state.plans.find((p) => p.id === planId);
  if (!plan) return;
  const day = dayId ? plan.days.find((d) => d.id === dayId) : null;
  dayDraft = {
    planId,
    id: day ? day.id : uid("day"),
    name: day ? day.name : "",
    description: day ? day.description : "",
    exercises: day ? day.exercises.map((e) => Object.assign({}, e)) : []
  };
  $("day-modal-title").textContent = day ? "Править день" : "Новый день";
  $("day-name").value = dayDraft.name;
  $("day-desc").value = dayDraft.description;
  renderDayExercises();
  $("backdrop").classList.add("on");
  $("modal-day").classList.add("on");
}

function renderDayExercises() {
  $("day-ex-list").innerHTML = dayDraft.exercises.map((e, i) => `
    <div class="ex-edit">
      <div class="ex-edit-head">
        <span class="ex-edit-num">${i + 1}</span>
        <h3>Упражнение ${i + 1}</h3>
      </div>
      <label class="lbl">Название</label>
      <input class="field" data-ex-name="${i}" value="${esc(e.name)}" placeholder="Название упражнения" enterkeyhint="done" />
      <label class="lbl">Описание / техника</label>
      <textarea class="field" data-ex-desc="${i}" placeholder="Описание (техника, заметка)">${esc(e.description || "")}</textarea>
      <label class="check"><input type="checkbox" data-ex-bw="${i}" ${e.bodyweightAllowed ? "checked" : ""} /> Есть возможность делать со своим весом</label>
      <button class="btn tiny pink" data-ex-del="${i}">Убрать</button>
    </div>
  `).join("") || "<p class='muted'>Добавь хотя бы одно упражнение.</p>";
}

function harvestDayForm() {
  dayDraft.name = $("day-name").value.trim();
  dayDraft.description = $("day-desc").value.trim();
  const root = $("modal-day");
  dayDraft.exercises.forEach((e, i) => {
    const n = root.querySelector(`[data-ex-name="${i}"]`);
    const d = root.querySelector(`[data-ex-desc="${i}"]`);
    const bw = root.querySelector(`[data-ex-bw="${i}"]`);
    if (n) e.name = n.value.trim();
    if (d) e.description = d.value.trim();
    if (bw) e.bodyweightAllowed = bw.checked;
  });
}

function saveDay() {
  harvestDayForm();
  if (!dayDraft.name) return toast("Назови день.", true);
  dayDraft.exercises = dayDraft.exercises.filter((e) => e.name);
  if (!dayDraft.exercises.length) return toast("Нужно хотя бы одно упражнение.", true);
  const plan = state.plans.find((p) => p.id === dayDraft.planId);
  const idx = plan.days.findIndex((d) => d.id === dayDraft.id);
  const saved = {
    id: dayDraft.id,
    name: dayDraft.name,
    description: dayDraft.description,
    exercises: dayDraft.exercises.map((e) => ({
      id: e.id || uid("ex"),
      name: e.name,
      description: e.description,
      bodyweightAllowed: !!e.bodyweightAllowed
    }))
  };
  if (idx >= 0) plan.days[idx] = saved;
  else plan.days.push(saved);
  save();
  closeDayModal();
  renderPlans();
}

function closeDayModal() {
  $("modal-day").classList.remove("on");
  dayDraft = null;
  syncBackdrop();
}

/* —— бой —— */
function startBattle(planId, dayId, deload) {
  const plan = state.plans.find((p) => p.id === planId);
  const day = plan && plan.days.find((d) => d.id === dayId);
  if (!day || !day.exercises.length) return toast("В дне нет упражнений.", true);

  active = {
    planName: plan.name,
    dayName: day.name,
    dayDesc: day.description || "",
    deload: !!deload,
    exercises: day.exercises.map((e) => ({
      name: e.name,
      description: e.description || "",
      bodyweightAllowed: !!e.bodyweightAllowed,
      sets: []
    })),
    totalDamage: 0,
    kills: [],
    xpGained: 0,
    levelsGained: [],
    baseline: Object.assign({}, state.lastWeights),
    stamina: 100,
    nextMul: 1,
    nextLabel: "",
    setsSinceEvent: 99,
    cardIndex: 0,
    bossIndex: sheetBossIndex,
    rematch: sheetBossIndex < state.currentBoss,
    fightMax: fightBossData(sheetBossIndex).hp,
    fightHp: sheetBossIndex < state.currentBoss ? fightBossData(sheetBossIndex).hp : state.currentHp
  };
  lastFightIndex = sheetBossIndex;
  pendingEvent = null;
  closeSheet();
  showScreen("screen-battle");
  renderBattle();
}

function bossNameHtml(b) {
  const extra = b.endless && state.revengeKills ? " · круг " + (state.revengeKills + 1) : "";
  const rem = active && active.rematch ? " · реванш" : "";
  return "<span>" + esc(b.name) + extra + rem + "</span>";
}

function renderBattle() {
  const b = currentBossData();
  setBossImg($("battle-boss"), b, active.fightHp, active.fightMax);
  $("battle-boss-name").innerHTML = bossNameHtml(b);
  $("deload-flag").hidden = !active.deload;
  $("battle-day-meta").textContent = active.planName + " · " + active.dayName + (active.dayDesc ? " — " + active.dayDesc : "");
  updateBars();
  const deck = $("deck");
  deck.innerHTML = active.exercises.map((ex, i) => {
    const last = active.baseline[ex.name];
    let hint = "Первый раз — полный урон.";
    if (active.deload) hint = "Разгрузка: штраф за вес выключен.";
    else if (last) hint = "Прошлый вес: " + last + " кг.";
    return `
      <article class="ex-card" data-ex="${i}">
        <span class="ex-mini-n">#${i + 1} / ${active.exercises.length}</span>
        <h3>${esc(ex.name)}</h3>
        <div class="set-log">${renderSets(ex) || "<div class='muted'>Пока без подходов</div>"}</div>
        <div class="muted">${hint}${ex.description ? " · " + esc(ex.description) : ""}</div>
      </article>`;
  }).join("");
  active.cardIndex = 0;
  renderDeckDots();
  syncHitFields();
  requestAnimationFrame(() => goCard(0, true));
}

function refreshCurrentCard() {
  if (!active) return;
  const i = active.cardIndex || 0;
  const ex = active.exercises[i];
  const card = $("deck").querySelector('[data-ex="' + i + '"]');
  if (!card || !ex) return;
  const log = card.querySelector(".set-log");
  if (log) log.innerHTML = renderSets(ex) || "<div class='muted'>Пока без подходов</div>";
}

function renderDeckDots() {
  if (!active) return;
  $("deck-dots").innerHTML = active.exercises.map((ex, i) =>
    `<i class="${i === (active.cardIndex || 0) ? "on" : ""}" data-card="${i}" title="${esc(ex.name)}"></i>`
  ).join("");
}

function syncHitFields() {
  if (!active) return;
  const ex = active.exercises[active.cardIndex || 0];
  if (!ex) return;
  $("hit-bw-wrap").hidden = !ex.bodyweightAllowed;
  if (!ex.bodyweightAllowed) $("hit-bw").checked = false;
  else if ($("hit-bw").checked) $("hit-w").value = state.user.weight;
}

function goCard(i, instant) {
  if (!active) return;
  const n = active.exercises.length;
  if (!n) return;
  active.cardIndex = (i % n + n) % n;
  const deck = $("deck");
  const card = deck.querySelector('[data-ex="' + active.cardIndex + '"]');
  renderDeckDots();
  syncHitFields();
  if (!card) return;
  const deckBox = deck.getBoundingClientRect();
  const cardBox = card.getBoundingClientRect();
  const left = deck.scrollLeft + (cardBox.left - deckBox.left) - (deck.clientWidth - card.offsetWidth) / 2;
  deck.scrollTo({ left: Math.max(0, left), behavior: instant ? "auto" : "smooth" });
}

function selectEx(i) {
  goCard(i);
}

function nearestCardIndex() {
  const deck = $("deck");
  const cards = [...deck.querySelectorAll(".ex-card")];
  if (!cards.length) return 0;
  const mid = deck.getBoundingClientRect().left + deck.clientWidth / 2;
  let best = 0, dist = Infinity;
  cards.forEach((c, idx) => {
    const r = c.getBoundingClientRect();
    const d = Math.abs(r.left + r.width / 2 - mid);
    if (d < dist) { dist = d; best = idx; }
  });
  return best;
}

function renderSets(ex) {
  if (!ex.sets.length) return "";
  return ex.sets.map((s, n) => `
    <div class="set-item">
      <div class="set-n">Подход ${n + 1}</div>
      <div class="set-line">${s.weight} кг × ${s.reps}${s.bodyweight ? " · свой вес" : ""}</div>
      ${s.event ? `<div class="set-line muted">${esc(s.event)}</div>` : ""}
      <div class="dmg">−${s.damage} ×${s.coeff}</div>
    </div>`).join("");
}

function updateBars() {
  const b = currentBossData();
  const hp = active ? active.fightHp : state.currentHp;
  const max = active ? active.fightMax : b.hp;
  const pct = Math.max(0, (hp / max) * 100);
  $("hp-fill").style.width = pct + "%";
  $("hp-text").textContent = Math.round(Math.max(0, hp)) + " / " + max + " HP";
  $("stamina-fill").style.width = Math.max(0, active.stamina) + "%";
  $("stamina-text").textContent = "Стамина " + Math.round(active.stamina);
  if (active) setBossImg($("battle-boss"), b, hp, max);
}

function damageCoeff(exName, weight) {
  if (active.deload) return 1;
  const last = active.baseline[exName];
  if (!last) return 1;
  if (weight > last + 0.25) return 1.2;
  if (Math.abs(weight - last) <= 0.25) return 0.8;
  return 0.62;
}

function readHitInput() {
  if (!active) return null;
  const i = active.cardIndex || 0;
  const ex = active.exercises[i];
  if (!ex) return null;
  const bwEl = $("hit-bw");
  const bodyweight = !!(bwEl && bwEl.checked);
  commitMathField($("hit-w"), false);
  commitMathField($("hit-r"), true);
  const wParsed = parseMathInput($("hit-w").value);
  const rParsed = parseMathInput($("hit-r").value);
  let w = wParsed.ok ? wParsed.value : NaN;
  const r = rParsed.ok ? Math.round(rParsed.value) : NaN;
  if (bodyweight) w = state.user.weight;
  if (!r || r < 1) {
    toast("Напиши повторы.", true);
    return null;
  }
  if (!w || w <= 0) {
    toast("Напиши вес или включи «со своим весом».", true);
    return null;
  }
  return { ex, w, r, bodyweight };
}

function requestHit() {
  if (!readHitInput()) return;
  const go = () => { if (active) hit(); };
  if (document.documentElement.classList.contains("kb-open") && typeof lockViewport.dismiss === "function") {
    lockViewport.dismiss(go);
    return;
  }
  go();
}

function hit() {
  const input = readHitInput();
  if (!input) return;
  const { ex, w, r, bodyweight } = input;

  let coeff = damageCoeff(ex.name, w);
  let eventMul = active.nextMul || 1;
  let eventName = active.nextLabel;
  active.nextMul = 1;
  active.nextLabel = "";

  let tired = active.stamina < 30 ? 0.85 : 1;
  const finalCoeff = Math.round(coeff * eventMul * tired * 100) / 100;
  const damage = Math.max(1, Math.round(w * r * coeff * eventMul * tired));

  ex.sets.push({
    weight: w,
    reps: r,
    damage,
    coeff: finalCoeff,
    bodyweight,
    event: eventName
  });
  active.totalDamage += damage;
  active.fightHp -= damage;
  if (!active.rematch) state.currentHp = active.fightHp;

  const xp = Math.max(1, Math.round(damage / 85));
  const lv = addXp(xp);
  active.xpGained += xp;
  active.levelsGained = active.levelsGained.concat(lv);
  active.setsSinceEvent += 1;

  $("hit-r").value = "";
  if (bodyweight) grantAch("body");
  refreshCurrentCard();
  impactHit(damage);

  const died = checkBossDeath();
  updateBars();
  refreshTop();
  save();

  if (!died && active.fightHp > 0 && active.setsSinceEvent >= 2 && Math.random() < 0.17) {
    fireEvent();
  }
}

function impactHit(n) {
  const box = $("boss-hitbox");
  box.classList.remove("impact");
  void box.offsetWidth;
  box.classList.add("impact");
  spawnBlood();
  spawnDmg(n);
}

function spawnBlood() {
  const layer = $("blood-layer");
  if (!layer) return;
  const splat = document.createElement("img");
  splat.src = "assets/fx/blood-splat.png";
  splat.alt = "";
  splat.className = "blood-pop";
  splat.style.left = (18 + Math.random() * 40) + "%";
  splat.style.top = (10 + Math.random() * 36) + "%";
  splat.style.setProperty("--r", (Math.random() * 70 - 35) + "deg");
  layer.appendChild(splat);
  const sheet = document.createElement("div");
  sheet.className = "blood-sheet";
  sheet.style.left = (28 + Math.random() * 28) + "%";
  sheet.style.top = (18 + Math.random() * 30) + "%";
  layer.appendChild(sheet);
  setTimeout(() => {
    splat.remove();
    sheet.remove();
  }, 460);
}

function spawnDmg(n) {
  const layer = $("fpv");
  const el = document.createElement("div");
  el.className = "dmg-float";
  el.textContent = "-" + n;
  el.style.left = (32 + Math.random() * 36) + "%";
  el.style.top = "38%";
  layer.appendChild(el);
  setTimeout(() => el.remove(), 900);
}

function checkBossDeath() {
  let killed = false;
  let guard = 0;
  while (active.fightHp <= 0 && guard < 8) {
    guard += 1;
    killed = true;
    const b = currentBossData();
    const overflow = Math.abs(active.fightHp);
    active.kills.push(b.name);
    const bossXp = 70 + (active.bossIndex || 0) * 18;
    const lv = addXp(bossXp);
    active.xpGained += bossXp;
    active.levelsGained = active.levelsGained.concat(lv);

    const loot = sample(LOOT_FLAVOR);
    let body = b.name + " пал. +" + bossXp + " XP. Добыча (пока в легенду): " + loot + ".";
    if (active.rematch) body += " Реванш не двигает сюжет.";
    if (lv.length) {
      const last = lv[lv.length - 1];
      body += " Новый уровень " + last.level + ": «" + last.title + "».";
    }
    rewardQueue.push({ title: active.rematch ? "Реванш закрыт" : "Босс пал", body });
    grantAch("boss");

    if (active.rematch) {
      const again = fightBossData(active.bossIndex);
      active.fightMax = again.hp;
      active.fightHp = again.hp - overflow;
    } else {
      if (b.endless) state.revengeKills = (state.revengeKills || 0) + 1;
      else if (state.currentBoss < BOSSES.length - 1) state.currentBoss += 1;
      else state.revengeKills = (state.revengeKills || 0) + 1;
      active.bossIndex = state.currentBoss;
      lastFightIndex = state.currentBoss;
      const next = currentBossData();
      state.currentHp = next.hp - overflow;
      active.fightMax = next.hp;
      active.fightHp = state.currentHp;
    }
  }
  if (killed) {
    showReward();
    renderBattleBossOnly();
  }
  return killed;
}

function renderBattleBossOnly() {
  const b = currentBossData();
  setBossImg($("battle-boss"), b, active.fightHp, active.fightMax);
  $("battle-boss-name").innerHTML = bossNameHtml(b);
  updateBars();
}

function showReward() {
  if (!rewardQueue.length) {
    $("modal-reward").classList.remove("on");
    syncBackdrop();
    return;
  }
  const r = rewardQueue.shift();
  $("reward-title").textContent = r.title;
  $("reward-body").textContent = r.body;
  $("modal-reward").classList.add("on");
  syncBackdrop();
}

function fireEvent() {
  pendingEvent = sample(EVENTS);
  active.setsSinceEvent = 0;
  $("event-title").textContent = pendingEvent.title;
  $("event-text").textContent = pendingEvent.text;
  $("modal-event").className = "modal on event-" + pendingEvent.side;
  syncBackdrop();
}

function acceptEvent() {
  if (!pendingEvent) return;
  const ev = pendingEvent;
  pendingEvent = null;
  active.nextMul = ev.nextMul;
  active.nextLabel = ev.title;
  active.stamina = Math.max(0, Math.min(100, active.stamina + (ev.stamina || 0)));
  if (ev.side === "hero") {
    const fpv = $("fpv");
    fpv.classList.remove("hurt");
    void fpv.offsetWidth;
    fpv.classList.add("hurt");
  }
  $("modal-event").classList.remove("on");
  syncBackdrop();
  updateBars();
}

function askFinish() {
  if (!active) return;
  if (active.totalDamage === 0) {
    active = null;
    returnToMap(true);
    return;
  }
  $("backdrop").classList.add("on");
  $("sheet-finish").classList.add("on");
}

function closeFinishSheet() {
  $("sheet-finish").classList.remove("on");
  syncBackdrop();
}

function confirmFinish() {
  closeFinishSheet();
  commitWorkout();
  showResults();
}

function commitWorkout() {
  if (!active.deload) {
    active.exercises.forEach((ex) => {
      if (!ex.sets.length) return;
      const maxW = Math.max.apply(null, ex.sets.map((s) => s.weight));
      state.lastWeights[ex.name] = maxW;
    });
  }
  const setCount = active.exercises.reduce((n, e) => n + e.sets.length, 0);
  const finishXp = 20 + setCount * 2;
  const lv = addXp(finishXp);
  active.xpGained += finishXp;
  active.levelsGained = active.levelsGained.concat(lv);

  const now = new Date();
  active.result = {
    id: uid("raid"),
    dateISO: now.toISOString(),
    dateLabel: now.toLocaleString("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }),
    planName: active.planName,
    dayName: active.dayName,
    deload: active.deload,
    damage: active.totalDamage,
    kills: active.kills.slice(),
    xp: active.xpGained,
    setCount,
    levels: active.levelsGained.slice(),
    exercises: active.exercises.map((e) => ({
      name: e.name,
      sets: e.sets.map((s) => ({ weight: s.weight, reps: s.reps, damage: s.damage, coeff: s.coeff, bodyweight: s.bodyweight }))
    }))
  };
  state.history.unshift(active.result);
  if (state.history.length > 80) state.history.pop();
  grantAch("raid");
  if (active.deload) grantAch("deload");
  save();
  refreshTop();
}

function showResults() {
  const h = active && active.result;
  if (!h) {
    leaveBattle();
    return;
  }
  const sets = (h.exercises || []).map((e) => {
    if (!(e.sets || []).length) {
      return `<li><b>${esc(e.name)}</b><div class="muted">без подходов</div></li>`;
    }
    const lines = e.sets.map((s, n) => `<li>Подход ${n + 1}: ${s.weight} кг × ${s.reps} → −${s.damage}</li>`).join("");
    return `<li><b>${esc(e.name)}</b><ul class="set-lines">${lines}</ul></li>`;
  }).join("");
  const lv = (h.levels || []).map((x) => "ур. " + x.level + " «" + esc(x.title) + "»").join(", ");
  $("results-body").innerHTML = `
    <p><b>${esc(h.dayName)}</b> · ${esc(h.planName)}${h.deload ? " · разгрузка" : ""}</p>
    <p>Урон: <b style="color:var(--crimson)">${h.damage}</b> · Подходов: <b>${h.setCount}</b> · XP: <b>${h.xp}</b></p>
    ${h.kills && h.kills.length ? `<p class="kill-chip">Убиты: ${esc(h.kills.join(", "))}</p>` : "<p class='muted'>Босс жив. HP сохраняется.</p>"}
    ${lv ? `<p>Новые уровни: ${lv}</p>` : ""}
    <ul class="history-sets">${sets}</ul>
  `;
  $("modal-results").classList.add("on");
  $("backdrop").classList.add("on");
}

function leaveBattle() {
  $("modal-results").classList.remove("on");
  $("sheet-finish").classList.remove("on");
  syncBackdrop();
  active = null;
  returnToMap(true);
}

function returnToMap(smooth) {
  showScreen("screen-app");
  showView("map");
  requestAnimationFrame(() => {
    const sc = $("world-scroll");
    const node = document.querySelector('.boss-node[data-boss="' + lastFightIndex + '"]') || document.querySelector(".boss-node.current");
    if (!sc || !node) return;
    const top = node.offsetTop - sc.clientHeight * 0.38;
    sc.scrollTo({ top: Math.max(0, top), behavior: smooth ? "smooth" : "auto" });
  });
}

/* —— путь —— */
function renderPath() {
  document.querySelectorAll("#path-tabs button").forEach((b) => {
    b.classList.toggle("on", b.dataset.ptab === pathTab);
  });
  if (pathTab === "kills") {
    renderTrophies();
    return;
  }
  const u = state.user;
  const list = titlesFor(u);
  const need = xpToNext(u.level);
  const fakeNext = Object.assign({}, u, { level: u.level + 1 });
  const nextTitle = levelTitle(fakeNext);
  const left = need - u.xp;
  const rows = [];
  const maxShow = Math.max(list.length, u.level + 3);
  for (let lv = 1; lv <= maxShow; lv++) {
    const fake = Object.assign({}, u, { level: lv });
    let cls = lv < u.level ? "done" : (lv === u.level ? "now" : "");
    const extra = lv === u.level ? ` · сейчас · ${u.xp}/${need} XP` : "";
    const next = lv === u.level ? `<div class="muted">До «${esc(nextTitle)}» ещё ${left} XP</div>` : "";
    rows.push(`
      <div class="level-row ${cls}" data-lv="${lv}">
        <div class="dot">${lv}</div>
        <div>
          <b>${esc(levelTitle(fake))}</b>
          ${extra}${next}
        </div>
      </div>`);
  }
  const patches = ACHIEVEMENTS.map((a) => {
    const on = (state.achievements || []).includes(a.id);
    return `<div class="patch ${on ? "on" : ""}"><img src="${a.img}" alt=""><span>${esc(a.name)}</span></div>`;
  }).join("");
  const zones = (u.problems || []).map((id) => {
    const p = PROBLEMS.find((x) => x.id === id);
    return p ? p.name : id;
  }).join(" · ");
  $("path-root").innerHTML = `
    <h2 class="display" style="margin:0 0 12px">Путь прокачки</h2>
    <div class="card path-hero">
      <img src="${heroImg(u)}" alt="" />
      <div class="grow">
        <div class="tag">${u.gender === "f" ? "Ж" : "М"} · ${esc(GOAL_LABELS[u.goal] || "")}</div>
        <h3 style="margin-top:6px">${esc(levelTitle(u))}</h3>
        <div class="muted">${esc(zones)}</div>
        <div class="muted">Следующий: ${esc(nextTitle)} · ещё ${left} XP</div>
        <div class="xp-bar" style="margin-top:8px"><span style="width:${Math.min(100, u.xp / need * 100)}%"></span></div>
      </div>
    </div>
    <div class="patch-row">${patches}</div>
    <p class="muted">XP капает с сетов, с конца рейда и жирным куском за убийство босса. Бой при победе не обрывается.</p>
    ${rows.join("")}
  `;
  const now = $("path-root").querySelector(".level-row.now");
  if (now) now.scrollIntoView({ block: "center", behavior: "auto" });
}

function renderTrophies() {
  const killed = BOSSES.filter((_, i) => i < state.currentBoss);
  if (!killed.length) {
    $("path-root").innerHTML = `<p class="muted">Пока никого не уложил. Иди бей текущего — трофеи появятся, когда упадёт первый.</p>`;
    return;
  }
  $("path-root").innerHTML = killed.map((b, i) => `
    <div class="card trophy-card">
      <img src="${b.img}" alt="" />
      <div class="grow">
        <div class="tag">${esc(b.loc)}</div>
        <h3>${esc(b.name)}</h3>
        <div class="muted">${esc(b.title)}</div>
        <p class="blurb">${esc(b.blurb || "")}</p>
        <button class="btn tiny pink" type="button" data-rematch="${i}">Реванш</button>
      </div>
    </div>
  `).join("");
  $("path-root").querySelectorAll("button[data-rematch]").forEach((btn) => {
    btn.addEventListener("click", () => openSheet(+btn.dataset.rematch));
  });
}

/* —— календарь / журнал —— */
function renderCalendar() {
  const y = calCursor.getFullYear();
  const m = calCursor.getMonth();
  $("cal-label").textContent = MONTHS[m] + " " + y;
  const first = new Date(y, m, 1).getDay();
  const start = (first + 6) % 7;
  const days = new Date(y, m + 1, 0).getDate();
  const byDay = {};
  state.history.forEach((h) => {
    const d = new Date(h.dateISO);
    if (d.getFullYear() === y && d.getMonth() === m) {
      const key = d.getDate();
      byDay[key] = (byDay[key] || 0) + 1;
    }
  });
  const today = new Date();
  let html = ["Пн","Вт","Ср","Чт","Пт","Сб","Вс"].map((d) => `<div class="dow">${d}</div>`).join("");
  for (let i = 0; i < start; i++) html += `<div class="cal-day empty"></div>`;
  for (let d = 1; d <= days; d++) {
    const isToday = today.getFullYear() === y && today.getMonth() === m && today.getDate() === d;
    const has = byDay[d];
    html += `<button class="cal-day ${isToday ? "today" : ""} ${has ? "has" : ""}" data-d="${d}">${d}</button>`;
  }
  $("cal-grid").innerHTML = html;
  $("cal-grid").querySelectorAll(".cal-day.has").forEach((el) => {
    el.addEventListener("click", () => showCalDay(+el.dataset.d));
  });
  $("cal-day-log").innerHTML = "<p class='muted'>Лаймовый день — была тренировка. Нажми, чтобы увидеть подходы.</p>";
}

function showCalDay(day) {
  const y = calCursor.getFullYear();
  const m = calCursor.getMonth();
  const items = state.history.filter((h) => {
    const d = new Date(h.dateISO);
    return d.getFullYear() === y && d.getMonth() === m && d.getDate() === day;
  });
  $("cal-day-log").innerHTML = items.map(historyCard).join("") || "<p class='muted'>Пусто.</p>";
}

function historyCard(h) {
  const sets = (h.exercises || []).filter((e) => (e.sets || []).length).map((e) => {
    const lines = (e.sets || []).map((s, n) => `<li>Подход ${n + 1}: ${s.weight} кг × ${s.reps} → −${s.damage}</li>`).join("");
    return `<li><b>${esc(e.name)}</b><ul class="set-lines">${lines}</ul></li>`;
  }).join("");
  return `
    <div class="card">
      <div class="flex"><b class="grow">${esc(h.dayName)}</b><span class="muted">${esc(h.dateLabel)}</span></div>
      <div class="muted">${esc(h.planName)}${h.deload ? " · разгрузка" : ""}</div>
      <div>Урон: <b style="color:var(--crimson)">${h.damage}</b> · Подходов: <b>${h.setCount || 0}</b> · XP: ${h.xp || 0}</div>
      ${h.kills && h.kills.length ? `<div class="kill-chip" style="margin-top:6px">Убиты: ${esc(h.kills.join(", "))}</div>` : ""}
      <ul class="history-sets">${sets}</ul>
    </div>`;
}

function renderHistory() {
  $("history-list").innerHTML = state.history.length
    ? state.history.map(historyCard).join("")
    : "<p class='muted'>Летопись пуста. Иди качайся.</p>";
}

/* —— профиль —— */
function openHero() {
  if (!state.user) return;
  heroEditing = false;
  renderHeroScreen();
  showScreen("screen-hero");
  $("hero-screen-wrap").scrollTop = 0;
}

function closeHero() {
  heroEditing = false;
  showScreen("screen-app");
  refreshTop();
}

/* —— события UI —— */
function bind() {
  $("btn-create").addEventListener("click", createHero);
  document.querySelectorAll(".sex").forEach((el) => {
    el.addEventListener("click", () => {
      document.querySelectorAll(".sex").forEach((x) => x.classList.remove("on"));
      el.classList.add("on");
      renderBodyCarousel();
      previewCreate();
    });
  });
  document.querySelectorAll(".zone").forEach((el) => {
    el.addEventListener("click", () => {
      el.classList.toggle("on");
      previewCreate();
    });
  });
  $("char-goal").addEventListener("change", previewCreate);
  $("btn-raid").addEventListener("click", () => openSheet(state.currentBoss));
  $("btn-sheet-close").addEventListener("click", closeSheet);
  $("btn-start-battle").addEventListener("click", () => {
    if (!sheetPlanId || !sheetDayId) return toast("Выбери план и день.", true);
    startBattle(sheetPlanId, sheetDayId, $("sheet-deload").checked);
  });
  $("backdrop").addEventListener("click", () => {
    if ($("modal-reward").classList.contains("on")) return;
    if ($("modal-results").classList.contains("on")) return;
    if ($("modal-event").classList.contains("on")) {
      acceptEvent();
      return;
    }
    if ($("modal-nudge").classList.contains("on")) {
      closeNudge();
      return;
    }
    closeSheet();
    closeFinishSheet();
    closeDayModal();
  });
  $("btn-add-plan").addEventListener("click", addPlan);
  $("btn-template").addEventListener("click", cloneStarter);
  $("btn-add-ex").addEventListener("click", () => {
    harvestDayForm();
    dayDraft.exercises.push({ id: uid("ex"), name: "", description: "", bodyweightAllowed: false });
    renderDayExercises();
  });
  $("day-ex-list").addEventListener("click", (e) => {
    const del = e.target.closest("[data-ex-del]");
    if (!del || !dayDraft) return;
    harvestDayForm();
    dayDraft.exercises.splice(+del.dataset.exDel, 1);
    renderDayExercises();
  });
  $("btn-day-save").addEventListener("click", saveDay);
  $("btn-day-cancel").addEventListener("click", closeDayModal);
  $("btn-reward-ok").addEventListener("click", showReward);
  $("btn-event-ok").addEventListener("click", acceptEvent);
  $("btn-finish").addEventListener("click", askFinish);
  $("btn-finish-yes").addEventListener("click", confirmFinish);
  $("btn-finish-no").addEventListener("click", closeFinishSheet);
  $("btn-results-ok").addEventListener("click", leaveBattle);
  $("btn-hit").addEventListener("click", () => {
    if (!active) return;
    if (document.documentElement.classList.contains("kb-open")) requestHit();
    else if (typeof lockViewport.openHit === "function") lockViewport.openHit();
  });
  $("btn-hit-go").addEventListener("click", () => { if (active) requestHit(); });
  ["hit-w", "hit-r"].forEach((id) => {
    $(id).addEventListener("blur", () => commitMathField($(id), id === "hit-r"));
    $(id).addEventListener("keydown", (e) => {
      if (e.key !== "Enter" || e.isComposing) return;
      e.preventDefault();
      commitMathField($(id), id === "hit-r");
      if (id === "hit-w") $("hit-r").focus();
      else if (id === "hit-r" && active) requestHit();
    });
  });
  $("path-tabs").addEventListener("click", (e) => {
    const tab = e.target.closest("[data-ptab]");
    if (!tab) return;
    pathTab = tab.dataset.ptab;
    renderPath();
  });
  $("hit-bw").addEventListener("change", () => {
    if ($("hit-bw").checked) $("hit-w").value = state.user.weight;
  });
  $("deck-prev").addEventListener("click", () => goCard((active?.cardIndex || 0) - 1));
  $("deck-next").addEventListener("click", () => goCard((active?.cardIndex || 0) + 1));
  $("deck-dots").addEventListener("click", (e) => {
    const dot = e.target.closest("[data-card]");
    if (dot && active) goCard(+dot.dataset.card);
  });
  $("topbar").addEventListener("click", openHero);
  $("topbar").addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openHero();
    }
  });
  $("btn-nudge-ok").addEventListener("click", closeNudge);
  $("btn-nudge-weak").addEventListener("click", closeNudge);
  $("program-packs").addEventListener("click", (e) => {
    const b = e.target.closest("[data-pack]");
    if (b && !b.disabled) addPackById(b.dataset.pack);
  });
  $("cal-prev").addEventListener("click", () => { calCursor.setMonth(calCursor.getMonth() - 1); renderCalendar(); });
  $("cal-next").addEventListener("click", () => { calCursor.setMonth(calCursor.getMonth() + 1); renderCalendar(); });

  document.querySelectorAll(".bottom-nav button").forEach((b) => {
    b.addEventListener("click", () => showView(b.dataset.view));
  });

  $("plans-list").addEventListener("click", (e) => {
    const tog = e.target.closest("[data-toggle-plan]");
    const delP = e.target.closest("[data-del-plan]");
    const addD = e.target.closest("[data-add-day]");
    const editD = e.target.closest("[data-edit-day]");
    const delD = e.target.closest("[data-del-day]");
    if (tog) {
      const id = tog.dataset.togglePlan;
      collapsedPlans[id] = !collapsedPlans[id];
      renderPlans();
      return;
    }
    if (delP) {
      if (confirm("Удалить весь план?")) {
        state.plans = state.plans.filter((p) => p.id !== delP.dataset.delPlan);
        save();
        renderPlans();
      }
    }
    if (addD) openDayEditor(addD.dataset.addDay, null);
    if (editD) {
      const [pid, did] = editD.dataset.editDay.split(":");
      openDayEditor(pid, did);
    }
    if (delD) {
      const [pid, did] = delD.dataset.delDay.split(":");
      const plan = state.plans.find((p) => p.id === pid);
      plan.days = plan.days.filter((d) => d.id !== did);
      save();
      renderPlans();
    }
  });

  $("deck").addEventListener("click", (e) => {
    const card = e.target.closest("[data-ex]");
    if (card && active) goCard(+card.dataset.ex);
  });
  bindDeckSwipe();
  window.addEventListener("resize", () => {
    clearTimeout(window._layoutR);
    window._layoutR = setTimeout(() => {
      if (active) goCard(active.cardIndex, true);
      if ($("view-map").classList.contains("on")) renderMap();
    }, 120);
  });
}

function bindDeckSwipe() {
  const deck = $("deck");
  if (!deck || deck._swipe) return;
  deck._swipe = true;
  let t;
  const sync = () => {
    if (!active) return;
    const i = nearestCardIndex();
    if (i === active.cardIndex) return;
    active.cardIndex = i;
    renderDeckDots();
    syncHitFields();
  };
  deck.addEventListener("scroll", () => {
    clearTimeout(t);
    t = setTimeout(sync, 50);
  }, { passive: true });
  deck.addEventListener("scrollend", sync);
}

function previewCreate() {
  const gender = document.querySelector(".sex.on")?.dataset.sex || "m";
  const problems = [...document.querySelectorAll(".zone.on")].map((el) => el.dataset.zone);
  const fake = {
    gender,
    goal: $("char-goal")?.value || "gain",
    primaryProblem: primaryProblem(problems),
    level: 1
  };
  const img = $("create-preview");
  if (img) img.src = heroImg(fake);
}

function paintCloudStatus() {
  const el = $("cloud-status");
  if (!el) return;
  const netErr = window.GymNet && typeof GymNet.errorText === "function" && GymNet.errorText();
  if (netErr) {
    el.textContent = "Облако: " + netErr;
    return;
  }
  if (window.GymTg) el.textContent = GymTg.statusText() || "";
}

async function init() {
  try {
    if (window.GymTg) GymTg.boot();
    if (window.GymPurge) {
      try { await GymPurge.run(); } catch (e) { console.warn(e); }
    }
    lockViewport();
    bind();
    renderBodyCarousel();
    renderExpChips();
    previewCreate();
    showScreen("screen-create");
    paintCloudStatus();
    hideBootVeil();
    const applyCloud = async () => {
      const ok = await hydrate();
      if (ok) bootApp();
      return ok;
    };
    if (!(await applyCloud())) {
      paintCloudStatus();
      const retry = async () => {
        if (state.user) return;
        await applyCloud();
      };
      document.addEventListener("pointerdown", retry, { once: true });
    }
  } finally {
    hideBootVeil();
  }
}

window.addEventListener("load", init);
