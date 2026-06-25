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

// Какие лиги тянуть под каждую вкладку спорта на фронте (актуально для июня 2026, меняйте по сезону).
// 'upcoming' — спец-ключ: ближайшие матчи по всем активным видам спорта в одном запросе (дёшево по квоте).
// ВНИМАНИЕ: каждый ключ = отдельный запрос к API = расход кредитов. Бережно с активными во время сезона.
//
// Стратегия: на вкладке "all" — только upcoming (1 запрос ловит всё активное).
// На отдельных вкладках — по 5-7 топ-лиг по виду спорта. Большинство неактивных вне сезона
// просто вернут пустой ответ — это бесплатно.
const SPORT_KEYS = {
  all:      ["upcoming"],
  football: [
    "soccer_epl",                          // АПЛ
    "soccer_spain_la_liga",                // Ла Лига
    "soccer_germany_bundesliga",           // Бундеслига
    "soccer_italy_serie_a",                // Серия А
    "soccer_france_ligue_one",             // Лига 1
    "soccer_uefa_champs_league",           // Лига Чемпионов
    "soccer_uefa_europa_league",           // Лига Европы
    "soccer_russia_premier_league",        // РПЛ (если активна в сезоне)
    "soccer_fifa_world_cup",               // ЧМ
  ],
  hockey:   [
    "icehockey_nhl",                       // НХЛ
    "icehockey_ahl",                       // АХЛ (фарм-лига НХЛ)
    "icehockey_sweden_hockey_league",      // Швед. хоккей
  ],
  tennis:   [
    "tennis_atp_french_open",
    "tennis_atp_wimbledon",
    "tennis_atp_us_open",
    "tennis_atp_aus_open_singles",
    "tennis_wta_french_open",
    "tennis_wta_wimbledon",
    "tennis_wta_us_open",
  ],
  basket:   [
    "basketball_nba",                      // НБА
    "basketball_euroleague",               // Евролига
    "basketball_wnba",                     // ВНБА
    "basketball_ncaab",                    // NCAA (US college)
  ],
  mma:      ["mma_mixed_martial_arts"],    // UFC и др. (вкладка может появиться позже)
  esports:  [
    "esports_csgo",                        // CS2 / CSGO
    "esports_dota_2",                      // Dota 2
    "esports_lol",                         // LoL (если активна)
  ],
};

const categoryOf = (k = "") =>
  k.startsWith("soccer")     ? "football" :
  k.startsWith("icehockey")  ? "hockey"   :
  k.startsWith("basketball") ? "basket"   :
  k.startsWith("tennis")     ? "tennis"   :
  k.startsWith("mma")        ? "mma"      :
  k.startsWith("esports")    ? "esports"  : "other";

const cache = new Map(); // sport -> { t, data }

// CORS — пускаем только ваш сайт (ALLOWED_ORIGIN). По умолчанию '*' для теста.
app.use((req, res, next) => {
  res.set("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.set("Vary", "Origin");
  res.set("Access-Control-Allow-Headers", "accept,content-type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

async function fetchSport(key) {
  const url = `${BASE}/sports/${key}/odds?apiKey=${KEY}&regions=${REGIONS}` +
              `&markets=h2h,totals,spreads&oddsFormat=decimal&dateFormat=iso` +
              (INCLUDE_LINKS ? "&includeLinks=true" : "");
  const r = await fetch(url);
  if (!r.ok) return [];          // неактивный/неизвестный ключ — просто пропускаем
  return r.json();
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
  // Берём самую глубокую: купон outcome.link -> рынок market.link -> событие bk.link.
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

  // --- Тотал (totals) — берём основную линию (модальную) и только тех БК, кто её квотирует ---
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
  if (!KEY) return res.status(500).json({ error: "ODDS_API_KEY не задан" });
  const sport = req.query.sport || "all";
  const hit = cache.get(sport);
  if (hit && Date.now() - hit.t < TTL) return res.json(hit.data);
  try {
    const keys = SPORT_KEYS[sport] || SPORT_KEYS.all;
    const raw = (await Promise.all(keys.map(fetchSport))).flat();
    const events = raw.map(normalizeEvent).filter((e) => Object.keys(e.markets).length);
    const bookMap = new Map();
    for (const ev of raw) for (const b of ev.bookmakers || []) if (!bookMap.has(b.key)) bookMap.set(b.key, b.title || b.key);
    const books = [...bookMap].map(([id, name]) => ({ id, name }));
    const data = { updatedAt: new Date().toISOString(), books, events };
    cache.set(sport, { t: Date.now(), data });
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
});

// список доступных лиг/ключей у API — пригодится, чтобы заполнить SPORT_KEYS
app.get("/api/sports", async (_req, res) => {
  if (!KEY) return res.status(500).json({ error: "ODDS_API_KEY не задан" });
  const r = await fetch(`${BASE}/sports?apiKey=${KEY}`);
  res.json(await r.json());
});

app.get("/", (_req, res) => res.json({ ok: true, service: "odds-backend", cacheKeys: [...cache.keys()] }));

app.listen(PORT, () => console.log("odds-backend запущен на :" + PORT));
