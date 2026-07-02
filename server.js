// odds-backend — превращает The Odds API в формат дашборда КЭФ·ТРЕКЕР
// Node 18+ (глобальный fetch). Запуск: npm install && npm start
"use strict";
require("dotenv").config();   // подхватывает ключ из .env при локальном запуске (на Render .env нет — берутся переменные окружения)
const express = require("express");
const app = express();

const KEY     = process.env.ODDS_API_KEY;                 // ключ The Odds API (the-odds-api.com)
const REGIONS = process.env.REGIONS || "eu";              // eu | uk | us | au — какие БК отдавать
const TTL     = (+process.env.CACHE_TTL || 60) * 1000;    // кэш ответа, сек (бережёт квоту)
const PORT    = process.env.PORT || 8080;
const BASE    = "https://api.the-odds-api.com/v4";
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*"; // в проде впишите адрес вашего сайта
const INCLUDE_LINKS  = String(process.env.INCLUDE_LINKS) === "true"; // ссылки на событие в БК (может требовать платного тарифа)

// ===== простое логирование с временной меткой =====
const log = (...a) => console.log(new Date().toISOString(), ...a);
const errlog = (...a) => console.error(new Date().toISOString(), "ERROR:", ...a);

log("starting odds-backend", { REGIONS, TTL_sec: TTL/1000, ALLOWED_ORIGIN, INCLUDE_LINKS, hasKey: !!KEY });

// Какие лиги тянуть под каждую вкладку спорта на фронте (актуально для июня 2026).
// ВАЖНО: ключа 'upcoming' больше нет — он часто не отдаёт котировки на free-тарифе.
// На вкладке 'all' тянем активные сейчас турниры явно (Wimbledon, MLB, MLS, Бразилия).
// Большинство неактивных вне сезона просто вернут пустой ответ — это бесплатно по квоте.
const SPORT_KEYS = {
  // 'all' = сейчас активные турниры (июнь-июль 2026: Уимблдон + летние лиги)
  all: [
    "tennis_atp_wimbledon",
    "tennis_wta_wimbledon",
    "baseball_mlb",
    "soccer_mls",
    "soccer_brazil_campeonato",
    "soccer_sweden_allsvenskan",
    "soccer_norway_eliteserien",
    "soccer_conmebol_copa_libertadores",
    "mma_mixed_martial_arts",
  ],
  football: [
    // ТОП-Европа (зимний сезон, август-май)
    "soccer_epl",                          // АПЛ
    "soccer_spain_la_liga",                // Ла Лига
    "soccer_germany_bundesliga",           // Бундеслига
    "soccer_italy_serie_a",                // Серия А
    "soccer_france_ligue_one",             // Лига 1
    "soccer_uefa_champs_league",           // Лига Чемпионов
    "soccer_uefa_europa_league",           // Лига Европы
    "soccer_russia_premier_league",        // РПЛ
    "soccer_fifa_world_cup",               // ЧМ
    // ЛЕТНИЕ активные лиги (играют июнь-сентябрь)
    "soccer_brazil_campeonato",            // Бразилия Серия А
    "soccer_mls",                          // MLS (США)
    "soccer_sweden_allsvenskan",           // Швеция
    "soccer_norway_eliteserien",           // Норвегия
    "soccer_argentina_primera_division",   // Аргентина
    "soccer_japan_j_league",               // Япония
    "soccer_korea_kleague1",               // Корея
    "soccer_conmebol_copa_libertadores",   // Кубок Либертадорес
  ],
  hockey:   [
    "icehockey_nhl",                       // НХЛ
    "icehockey_ahl",                       // АХЛ
    "icehockey_sweden_hockey_league",      // Швед. хоккей
  ],
  tennis:   [
    "tennis_atp_french_open",
    "tennis_atp_wimbledon",                // стартует 30 июня
    "tennis_atp_us_open",
    "tennis_atp_aus_open_singles",
    "tennis_wta_french_open",
    "tennis_wta_wimbledon",                // стартует 30 июня
    "tennis_wta_us_open",
  ],
  basket:   [
    "basketball_nba",                      // НБА
    "basketball_euroleague",               // Евролига
    "basketball_wnba",                     // ВНБА — играет летом
    "basketball_ncaab",                    // NCAA
  ],
  mma:      ["mma_mixed_martial_arts"],    // UFC и др.
  baseball: [
    "baseball_mlb",                        // MLB
  ],
  esports:  [
    "esports_csgo",
    "esports_dota_2",
    "esports_lol",
  ],
};

const categoryOf = (k = "") =>
  k.startsWith("soccer")     ? "football" :
  k.startsWith("icehockey")  ? "hockey"   :
  k.startsWith("basketball") ? "basket"   :
  k.startsWith("tennis")     ? "tennis"   :
  k.startsWith("baseball")   ? "baseball" :
  k.startsWith("mma")        ? "mma"      :
  k.startsWith("esports")    ? "esports"  : "other";

const cache = new Map(); // sport -> { t, data }

// ===== БЕЛЫЙ СПИСОК БК ДЛЯ СНГ =====
// Оставляем только те конторы, куда игрок из СНГ реально может зарегистрироваться и пополниться.
// Ключи — как их называет The Odds API. Проверено по прямому запросу к API.
// Названия можно посмотреть в /api/odds -> books
const CIS_BOOKS = new Set([
  "pinnacle",       // Pinnacle — принимает СНГ, крипта, без верификации
  "onexbet",        // 1xBet — главная контора для СНГ
  "marathonbet",    // Marathon Bet — российские корни
  "betvictor",      // Bet Victor — работает с некоторыми СНГ
  "sport888",       // 888sport
  "betsson",        // Betsson — Balkan/CIS friendly
  "unibet_nl",      // Unibet NL — часто открыт для СНГ через VPN
  "nordicbet",      // Nordic Bet
  "betfair_ex_eu",  // Betfair Exchange EU
  "matchbook",      // Matchbook — биржа
]);

// Главные URL букмекеров (для клика по кэфу — ведём на регистрацию/главную).
// TODO: заменить на реф-ссылки когда будут партнёрские программы.
const BOOK_URLS = {
  pinnacle:      "https://www.pinnacle.com/",
  onexbet:       "https://1xbet.com/",
  marathonbet:   "https://www.marathonbet.com/",
  betvictor:     "https://www.betvictor.com/",
  sport888:      "https://www.888sport.com/",
  betsson:       "https://www.betsson.com/",
  unibet_nl:     "https://www.unibet.nl/",
  nordicbet:     "https://www.nordicbet.com/",
  betfair_ex_eu: "https://www.betfair.com/",
  matchbook:     "https://www.matchbook.com/",
};

// Фильтруем букмекеров в матче — оставляем только СНГ.
// Если после фильтра букмекеров < 2, матч выкидываем (не с чем сравнивать).
function filterCisBooks(ev) {
  const bms = (ev.bookmakers || []).filter(b => CIS_BOOKS.has(b.key));
  return { ...ev, bookmakers: bms };
}

// CORS — пускаем только ваш сайт (ALLOWED_ORIGIN). По умолчанию '*' для теста.
app.use((req, res, next) => {
  res.set("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.set("Vary", "Origin");
  res.set("Access-Control-Allow-Headers", "accept,content-type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// fetchSport: тянет один турнир, логирует подробно (URL без ключа, статус, кол-во матчей)
async function fetchSport(key) {
  const url = `${BASE}/sports/${key}/odds?apiKey=${KEY}&regions=${REGIONS}` +
              `&markets=h2h,totals,spreads&oddsFormat=decimal&dateFormat=iso` +
              (INCLUDE_LINKS ? "&includeLinks=true" : "");
  const safeUrl = url.replace(KEY, "***");
  try {
    const r = await fetch(url);
    if (!r.ok) {
      const body = await r.text().catch(() => "");
      errlog(`fetchSport ${key} HTTP ${r.status}`, safeUrl, "body:", body.slice(0, 200));
      return [];
    }
    const data = await r.json();
    log(`fetchSport ${key} OK events=${Array.isArray(data) ? data.length : "?"}`);
    return Array.isArray(data) ? data : [];
  } catch (e) {
    errlog(`fetchSport ${key} threw`, safeUrl, e.message || e);
    return [];
  }
}

const modal = (arr) => {         // самое частое значение (для выбора основной линии тотала/форы)
  const m = {}; let best = null, bc = -1;
  for (const v of arr) { m[v] = (m[v] || 0) + 1; if (m[v] > bc) { bc = m[v]; best = v; } }
  return best;
};

// Один матч из The Odds API -> схема дашборда (per-market -> per-outcome -> per-book)
function normalizeEvent(ev) {
  const markets = {};
  const bms = ev.bookmakers || [];

  // Ссылка на событие у каждой БК (если includeLinks=true и контора её отдаёт).
  const evLink = {};
  for (const bk of bms) {
    let l = bk.link || null;
    if (!l) for (const mk of (bk.markets || [])) { if (mk.link) { l = mk.link; break; } }
    if (!l) for (const mk of (bk.markets || [])) { for (const oc of (mk.outcomes || [])) { if (oc.link) { l = oc.link; break; } } if (l) break; }
    if (l) evLink[bk.key] = l;
  }
  const cell = (bkKey, price) => ({ odd: price, link: evLink[bkKey] || null });

  // --- Исход (h2h -> 1x2) ---
  const h2h = {};
  for (const bk of bms) {
    const m = (bk.markets || []).find((x) => x.key === "h2h");
    if (!m) continue;
    for (const o of m.outcomes) {
      const key = o.name === ev.home_team ? "1" : o.name === ev.away_team ? "2" : "X";
      (h2h[key] = h2h[key] || {})[bk.key] = cell(bk.key, o.price);
    }
  }
  const order = [["1", "П1"], ["X", "Ничья"], ["2", "П2"]];
  const o1x2 = order.filter(([k]) => h2h[k]).map(([k, label]) => ({ key: k, label, books: h2h[k] }));
  if (o1x2.length >= 2) markets["1x2"] = { label: "Исход", lineLabel: null, outcomes: o1x2 };

  // --- Тотал (totals) ---
  const tRows = [];
  for (const bk of bms) {
    const m = (bk.markets || []).find((x) => x.key === "totals");
    if (!m) continue;
    const byPt = {};
    for (const o of m.outcomes) { (byPt[o.point] = byPt[o.point] || {})[o.name.toLowerCase()] = o.price; }
    for (const [p, v] of Object.entries(byPt))
      if (v.over != null && v.under != null) tRows.push({ book: bk.key, point: +p, over: v.over, under: v.under });
  }
  if (tRows.length) {
    const pt = modal(tRows.map((x) => x.point));
    const at = tRows.filter((x) => x.point === pt);
    if (at.length) {
      const over = {}, under = {};
      for (const x of at) { over[x.book] = cell(x.book, x.over); under[x.book] = cell(x.book, x.under); }
      markets["total"] = { label: "Тотал", lineLabel: String(pt),
        outcomes: [{ key: "o", label: "Больше " + pt, books: over }, { key: "u", label: "Меньше " + pt, books: under }] };
    }
  }

  // --- Фора (spreads -> hcap) ---
  const sRows = [];
  for (const bk of bms) {
    const m = (bk.markets || []).find((x) => x.key === "spreads");
    if (!m) continue;
    const byPt = {};
    for (const o of m.outcomes) {
      const side = o.name === ev.home_team ? "h1" : o.name === ev.away_team ? "h2" : null;
      if (!side) continue;
      const ap = Math.abs(o.point);
      (byPt[ap] = byPt[ap] || {})[side] = { price: o.price, point: o.point };
    }
    for (const [p, v] of Object.entries(byPt))
      if (v.h1 && v.h2) sRows.push({ book: bk.key, ap: +p, h1: v.h1, h2: v.h2 });
  }
  if (sRows.length) {
    const pt = modal(sRows.map((x) => x.ap));
    const at = sRows.filter((x) => x.ap === pt);
    if (at.length) {
      const h1 = {}, h2 = {}; let l1 = 0, l2 = 0;
      for (const x of at) { h1[x.book] = cell(x.book, x.h1.price); h2[x.book] = cell(x.book, x.h2.price); l1 = x.h1.point; l2 = x.h2.point; }
      const fmt = (n) => (n > 0 ? "+" + n : "" + n);
      markets["hcap"] = { label: "Фора", lineLabel: null,
        outcomes: [{ key: "h1", label: `Ф1 (${fmt(l1)})`, books: h1 }, { key: "h2", label: `Ф2 (${fmt(l2)})`, books: h2 }] };
    }
  }

  return { id: ev.id, sport: categoryOf(ev.sport_key), league: ev.sport_title || "",
           home: ev.home_team, away: ev.away_team, commence: ev.commence_time, markets };
}

app.get("/api/odds", async (req, res) => {
  if (!KEY) { errlog("ODDS_API_KEY not set"); return res.status(500).json({ error: "ODDS_API_KEY не задан" }); }
  const sport = req.query.sport || "all";
  const hit = cache.get(sport);
  if (hit && Date.now() - hit.t < TTL) {
    log("/api/odds", sport, "cache hit, events=" + (hit.data.events?.length||0));
    return res.json(hit.data);
  }
  const t0 = Date.now();
  try {
    const keys = SPORT_KEYS[sport] || SPORT_KEYS.all;
    log("/api/odds", sport, "fetching keys:", keys.join(","));
    const rawAll = (await Promise.all(keys.map(fetchSport))).flat();
    log("/api/odds", sport, "total raw events from all keys:", rawAll.length);
    // фильтр по белому списку СНГ-БК + отсекаем матчи, где после фильтра < 2 контор
    const raw = rawAll.map(filterCisBooks).filter(ev => (ev.bookmakers || []).length >= 2);
    log("/api/odds", sport, "after CIS filter:", raw.length, "events");
    const events = raw.map(normalizeEvent).filter((e) => Object.keys(e.markets).length);
    const bookMap = new Map();
    for (const ev of raw) for (const b of ev.bookmakers || []) if (!bookMap.has(b.key)) bookMap.set(b.key, b.title || b.key);
    const books = [...bookMap].map(([id, name]) => ({ id, name, url: BOOK_URLS[id] || null }));
    const data = { updatedAt: new Date().toISOString(), books, events, bookUrls: BOOK_URLS };
    cache.set(sport, { t: Date.now(), data });
    log("/api/odds", sport, "fetched events=" + events.length, "books=" + books.length, "in " + (Date.now()-t0) + "ms");
    res.json(data);
  } catch (e) {
    errlog("/api/odds", sport, e.message || e);
    res.status(502).json({ error: String(e.message || e) });
  }
});

// список доступных лиг/ключей у API
app.get("/api/sports", async (_req, res) => {
  if (!KEY) return res.status(500).json({ error: "ODDS_API_KEY не задан" });
  const r = await fetch(`${BASE}/sports?apiKey=${KEY}`);
  res.json(await r.json());
});

app.get("/", (_req, res) => res.json({ ok: true, service: "odds-backend", cacheKeys: [...cache.keys()] }));

// health-чек
app.get("/health", (_req, res) => res.json({
  ok: true,
  uptime_sec: Math.floor(process.uptime()),
  cache_sports: [...cache.keys()],
  cache_ttl_sec: TTL/1000,
  has_key: !!KEY,
  regions: REGIONS,
  ts: new Date().toISOString()
}));

app.listen(PORT, () => log("odds-backend listening on :" + PORT));
