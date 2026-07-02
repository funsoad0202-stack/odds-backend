// odds-backend вЂ” РїСЂРµРІСЂР°С‰Р°РµС‚ The Odds API РІ С„РѕСЂРјР°С‚ РґР°С€Р±РѕСЂРґР° РљР­Р¤В·РўР Р•РљР•Р 
// Node 18+ (РіР»РѕР±Р°Р»СЊРЅС‹Р№ fetch). Р—Р°РїСѓСЃРє: npm install && npm start
"use strict";
require("dotenv").config();   // РїРѕРґС…РІР°С‚С‹РІР°РµС‚ РєР»СЋС‡ РёР· .env РїСЂРё Р»РѕРєР°Р»СЊРЅРѕРј Р·Р°РїСѓСЃРєРµ (РЅР° Render .env РЅРµС‚ вЂ” Р±РµСЂСѓС‚СЃСЏ РїРµСЂРµРјРµРЅРЅС‹Рµ РѕРєСЂСѓР¶РµРЅРёСЏ)
const express = require("express");
const app = express();

const KEY     = process.env.ODDS_API_KEY;                 // РєР»СЋС‡ The Odds API (the-odds-api.com)
const REGIONS = process.env.REGIONS || "eu";              // eu | uk | us | au вЂ” РєР°РєРёРµ Р‘Рљ РѕС‚РґР°РІР°С‚СЊ
const TTL     = (+process.env.CACHE_TTL || 60) * 1000;    // РєСЌС€ РѕС‚РІРµС‚Р°, СЃРµРє (Р±РµСЂРµР¶С‘С‚ РєРІРѕС‚Сѓ)
const PORT    = process.env.PORT || 8080;
const BASE    = "https://api.the-odds-api.com/v4";
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*"; // РІ РїСЂРѕРґРµ РІРїРёС€РёС‚Рµ Р°РґСЂРµСЃ РІР°С€РµРіРѕ СЃР°Р№С‚Р°
const INCLUDE_LINKS  = String(process.env.INCLUDE_LINKS) === "true"; // СЃСЃС‹Р»РєРё РЅР° СЃРѕР±С‹С‚РёРµ РІ Р‘Рљ (РјРѕР¶РµС‚ С‚СЂРµР±РѕРІР°С‚СЊ РїР»Р°С‚РЅРѕРіРѕ С‚Р°СЂРёС„Р°)

// ===== РїСЂРѕСЃС‚РѕРµ Р»РѕРіРёСЂРѕРІР°РЅРёРµ СЃ РІСЂРµРјРµРЅРЅРѕР№ РјРµС‚РєРѕР№ =====
const log = (...a) => console.log(new Date().toISOString(), ...a);
const errlog = (...a) => console.error(new Date().toISOString(), "ERROR:", ...a);

log("starting odds-backend", { REGIONS, TTL_sec: TTL/1000, ALLOWED_ORIGIN, INCLUDE_LINKS, hasKey: !!KEY });

// РљР°РєРёРµ Р»РёРіРё С‚СЏРЅСѓС‚СЊ РїРѕРґ РєР°Р¶РґСѓСЋ РІРєР»Р°РґРєСѓ СЃРїРѕСЂС‚Р° РЅР° С„СЂРѕРЅС‚Рµ (Р°РєС‚СѓР°Р»СЊРЅРѕ РґР»СЏ РёСЋРЅСЏ 2026).
// Р’РђР–РќРћ: РєР»СЋС‡Р° 'upcoming' Р±РѕР»СЊС€Рµ РЅРµС‚ вЂ” РѕРЅ С‡Р°СЃС‚Рѕ РЅРµ РѕС‚РґР°С‘С‚ РєРѕС‚РёСЂРѕРІРєРё РЅР° free-С‚Р°СЂРёС„Рµ.
// РќР° РІРєР»Р°РґРєРµ 'all' С‚СЏРЅРµРј Р°РєС‚РёРІРЅС‹Рµ СЃРµР№С‡Р°СЃ С‚СѓСЂРЅРёСЂС‹ СЏРІРЅРѕ (Wimbledon, MLB, MLS, Р‘СЂР°Р·РёР»РёСЏ).
// Р‘РѕР»СЊС€РёРЅСЃС‚РІРѕ РЅРµР°РєС‚РёРІРЅС‹С… РІРЅРµ СЃРµР·РѕРЅР° РїСЂРѕСЃС‚Рѕ РІРµСЂРЅСѓС‚ РїСѓСЃС‚РѕР№ РѕС‚РІРµС‚ вЂ” СЌС‚Рѕ Р±РµСЃРїР»Р°С‚РЅРѕ РїРѕ РєРІРѕС‚Рµ.
const SPORT_KEYS = {
  // 'all' = СЃРµР№С‡Р°СЃ Р°РєС‚РёРІРЅС‹Рµ С‚СѓСЂРЅРёСЂС‹ (РёСЋРЅСЊ-РёСЋР»СЊ 2026: РЈРёРјР±Р»РґРѕРЅ + Р»РµС‚РЅРёРµ Р»РёРіРё)
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
    // РўРћРџ-Р•РІСЂРѕРїР° (Р·РёРјРЅРёР№ СЃРµР·РѕРЅ, Р°РІРіСѓСЃС‚-РјР°Р№)
    "soccer_epl",                          // РђРџР›
    "soccer_spain_la_liga",                // Р›Р° Р›РёРіР°
    "soccer_germany_bundesliga",           // Р‘СѓРЅРґРµСЃР»РёРіР°
    "soccer_italy_serie_a",                // РЎРµСЂРёСЏ Рђ
    "soccer_france_ligue_one",             // Р›РёРіР° 1
    "soccer_uefa_champs_league",           // Р›РёРіР° Р§РµРјРїРёРѕРЅРѕРІ
    "soccer_uefa_europa_league",           // Р›РёРіР° Р•РІСЂРѕРїС‹
    "soccer_russia_premier_league",        // Р РџР›
    "soccer_fifa_world_cup",               // Р§Рњ
    // Р›Р•РўРќРР• Р°РєС‚РёРІРЅС‹Рµ Р»РёРіРё (РёРіСЂР°СЋС‚ РёСЋРЅСЊ-СЃРµРЅС‚СЏР±СЂСЊ)
    "soccer_brazil_campeonato",            // Р‘СЂР°Р·РёР»РёСЏ РЎРµСЂРёСЏ Рђ
    "soccer_mls",                          // MLS (РЎРЁРђ)
    "soccer_sweden_allsvenskan",           // РЁРІРµС†РёСЏ
    "soccer_norway_eliteserien",           // РќРѕСЂРІРµРіРёСЏ
    "soccer_argentina_primera_division",   // РђСЂРіРµРЅС‚РёРЅР°
    "soccer_japan_j_league",               // РЇРїРѕРЅРёСЏ
    "soccer_korea_kleague1",               // РљРѕСЂРµСЏ
    "soccer_conmebol_copa_libertadores",   // РљСѓР±РѕРє Р›РёР±РµСЂС‚Р°РґРѕСЂРµСЃ
  ],
  hockey:   [
    "icehockey_nhl",                       // РќРҐР›
    "icehockey_ahl",                       // РђРҐР›
    "icehockey_sweden_hockey_league",      // РЁРІРµРґ. С…РѕРєРєРµР№
  ],
  tennis:   [
    "tennis_atp_french_open",
    "tennis_atp_wimbledon",                // СЃС‚Р°СЂС‚СѓРµС‚ 30 РёСЋРЅСЏ
    "tennis_atp_us_open",
    "tennis_atp_aus_open_singles",
    "tennis_wta_french_open",
    "tennis_wta_wimbledon",                // СЃС‚Р°СЂС‚СѓРµС‚ 30 РёСЋРЅСЏ
    "tennis_wta_us_open",
  ],
  basket:   [
    "basketball_nba",                      // РќР‘Рђ
    "basketball_euroleague",               // Р•РІСЂРѕР»РёРіР°
    "basketball_wnba",                     // Р’РќР‘Рђ вЂ” РёРіСЂР°РµС‚ Р»РµС‚РѕРј
    "basketball_ncaab",                    // NCAA
  ],
  mma:      ["mma_mixed_martial_arts"],    // UFC Рё РґСЂ.
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

// ===== Р‘Р•Р›Р«Р™ РЎРџРРЎРћРљ Р‘Рљ Р”Р›РЇ РЎРќР“ =====
// РћСЃС‚Р°РІР»СЏРµРј С‚РѕР»СЊРєРѕ С‚Рµ РєРѕРЅС‚РѕСЂС‹, РєСѓРґР° РёРіСЂРѕРє РёР· РЎРќР“ СЂРµР°Р»СЊРЅРѕ РјРѕР¶РµС‚ Р·Р°СЂРµРіРёСЃС‚СЂРёСЂРѕРІР°С‚СЊСЃСЏ Рё РїРѕРїРѕР»РЅРёС‚СЊСЃСЏ.
// РљР»СЋС‡Рё вЂ” РєР°Рє РёС… РЅР°Р·С‹РІР°РµС‚ The Odds API. РџСЂРѕРІРµСЂРµРЅРѕ РїРѕ РїСЂСЏРјРѕРјСѓ Р·Р°РїСЂРѕСЃСѓ Рє API.
// РќР°Р·РІР°РЅРёСЏ РјРѕР¶РЅРѕ РїРѕСЃРјРѕС‚СЂРµС‚СЊ РІ /api/odds -> books
const CIS_BOOKS = new Set([
  "pinnacle",       // Pinnacle вЂ” РїСЂРёРЅРёРјР°РµС‚ РЎРќР“, РєСЂРёРїС‚Р°, Р±РµР· РІРµСЂРёС„РёРєР°С†РёРё
  "onexbet",        // 1xBet вЂ” РіР»Р°РІРЅР°СЏ РєРѕРЅС‚РѕСЂР° РґР»СЏ РЎРќР“
  "marathonbet",    // Marathon Bet вЂ” СЂРѕСЃСЃРёР№СЃРєРёРµ РєРѕСЂРЅРё
  "betvictor",      // Bet Victor вЂ” СЂР°Р±РѕС‚Р°РµС‚ СЃ РЅРµРєРѕС‚РѕСЂС‹РјРё РЎРќР“
  "sport888",       // 888sport
  "betsson",        // Betsson вЂ” Balkan/CIS friendly
  "unibet_nl",      // Unibet NL вЂ” С‡Р°СЃС‚Рѕ РѕС‚РєСЂС‹С‚ РґР»СЏ РЎРќР“ С‡РµСЂРµР· VPN
  "nordicbet",      // Nordic Bet
  "betfair_ex_eu",  // Betfair Exchange EU
  "matchbook",      // Matchbook вЂ” Р±РёСЂР¶Р°
]);

// Р“Р»Р°РІРЅС‹Рµ URL Р±СѓРєРјРµРєРµСЂРѕРІ (РґР»СЏ РєР»РёРєР° РїРѕ РєСЌС„Сѓ вЂ” РІРµРґС‘Рј РЅР° СЂРµРіРёСЃС‚СЂР°С†РёСЋ/РіР»Р°РІРЅСѓСЋ).
// TODO: Р·Р°РјРµРЅРёС‚СЊ РЅР° СЂРµС„-СЃСЃС‹Р»РєРё РєРѕРіРґР° Р±СѓРґСѓС‚ РїР°СЂС‚РЅС‘СЂСЃРєРёРµ РїСЂРѕРіСЂР°РјРјС‹.
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

// Р¤РёР»СЊС‚СЂСѓРµРј Р±СѓРєРјРµРєРµСЂРѕРІ РІ РјР°С‚С‡Рµ вЂ” РѕСЃС‚Р°РІР»СЏРµРј С‚РѕР»СЊРєРѕ РЎРќР“.
// Р•СЃР»Рё РїРѕСЃР»Рµ С„РёР»СЊС‚СЂР° Р±СѓРєРјРµРєРµСЂРѕРІ < 2, РјР°С‚С‡ РІС‹РєРёРґС‹РІР°РµРј (РЅРµ СЃ С‡РµРј СЃСЂР°РІРЅРёРІР°С‚СЊ).
function filterCisBooks(ev) {
  const bms = (ev.bookmakers || []).filter(b => CIS_BOOKS.has(b.key));
  return { ...ev, bookmakers: bms };
}

// CORS вЂ” РїСѓСЃРєР°РµРј С‚РѕР»СЊРєРѕ РІР°С€ СЃР°Р№С‚ (ALLOWED_ORIGIN). РџРѕ СѓРјРѕР»С‡Р°РЅРёСЋ '*' РґР»СЏ С‚РµСЃС‚Р°.
app.use((req, res, next) => {
  res.set("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.set("Vary", "Origin");
  res.set("Access-Control-Allow-Headers", "accept,content-type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// fetchSport: С‚СЏРЅРµС‚ РѕРґРёРЅ С‚СѓСЂРЅРёСЂ, Р»РѕРіРёСЂСѓРµС‚ РїРѕРґСЂРѕР±РЅРѕ (URL Р±РµР· РєР»СЋС‡Р°, СЃС‚Р°С‚СѓСЃ, РєРѕР»-РІРѕ РјР°С‚С‡РµР№)
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

const modal = (arr) => {         // СЃР°РјРѕРµ С‡Р°СЃС‚РѕРµ Р·РЅР°С‡РµРЅРёРµ (РґР»СЏ РІС‹Р±РѕСЂР° РѕСЃРЅРѕРІРЅРѕР№ Р»РёРЅРёРё С‚РѕС‚Р°Р»Р°/С„РѕСЂС‹)
  const m = {}; let best = null, bc = -1;
  for (const v of arr) { m[v] = (m[v] || 0) + 1; if (m[v] > bc) { bc = m[v]; best = v; } }
  return best;
};

// РћРґРёРЅ РјР°С‚С‡ РёР· The Odds API -> СЃС…РµРјР° РґР°С€Р±РѕСЂРґР° (per-market -> per-outcome -> per-book)
function normalizeEvent(ev) {
  const markets = {};
  const bms = ev.bookmakers || [];

  // РЎСЃС‹Р»РєР° РЅР° СЃРѕР±С‹С‚РёРµ Сѓ РєР°Р¶РґРѕР№ Р‘Рљ (РµСЃР»Рё includeLinks=true Рё РєРѕРЅС‚РѕСЂР° РµС‘ РѕС‚РґР°С‘С‚).
  const evLink = {};
  for (const bk of bms) {
    let l = bk.link || null;
    if (!l) for (const mk of (bk.markets || [])) { if (mk.link) { l = mk.link; break; } }
    if (!l) for (const mk of (bk.markets || [])) { for (const oc of (mk.outcomes || [])) { if (oc.link) { l = oc.link; break; } } if (l) break; }
    if (l) evLink[bk.key] = l;
  }
  const cell = (bkKey, price) => ({ odd: price, link: evLink[bkKey] || null });

  // --- РСЃС…РѕРґ (h2h -> 1x2) ---
  const h2h = {};
  for (const bk of bms) {
    const m = (bk.markets || []).find((x) => x.key === "h2h");
    if (!m) continue;
    for (const o of m.outcomes) {
      const key = o.name === ev.home_team ? "1" : o.name === ev.away_team ? "2" : "X";
      (h2h[key] = h2h[key] || {})[bk.key] = cell(bk.key, o.price);
    }
  }
  const order = [["1", "Рџ1"], ["X", "РќРёС‡СЊСЏ"], ["2", "Рџ2"]];
  const o1x2 = order.filter(([k]) => h2h[k]).map(([k, label]) => ({ key: k, label, books: h2h[k] }));
  if (o1x2.length >= 2) markets["1x2"] = { label: "РСЃС…РѕРґ", lineLabel: null, outcomes: o1x2 };

  // --- РўРѕС‚Р°Р» (totals) ---
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
      markets["total"] = { label: "РўРѕС‚Р°Р»", lineLabel: String(pt),
        outcomes: [{ key: "o", label: "Р‘РѕР»СЊС€Рµ " + pt, books: over }, { key: "u", label: "РњРµРЅСЊС€Рµ " + pt, books: under }] };
    }
  }

  // --- Р¤РѕСЂР° (spreads -> hcap) ---
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
      markets["hcap"] = { label: "Р¤РѕСЂР°", lineLabel: null,
        outcomes: [{ key: "h1", label: `Р¤1 (${fmt(l1)})`, books: h1 }, { key: "h2", label: `Р¤2 (${fmt(l2)})`, books: h2 }] };
    }
  }

  return { id: ev.id, sport: categoryOf(ev.sport_key), league: ev.sport_title || "",
           home: ev.home_team, away: ev.away_team, commence: ev.commence_time, markets };
}

app.get("/api/odds", async (req, res) => {
  if (!KEY) { errlog("ODDS_API_KEY not set"); return res.status(500).json({ error: "ODDS_API_KEY РЅРµ Р·Р°РґР°РЅ" }); }
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
    // С„РёР»СЊС‚СЂ РїРѕ Р±РµР»РѕРјСѓ СЃРїРёСЃРєСѓ РЎРќР“-Р‘Рљ + РѕС‚СЃРµРєР°РµРј РјР°С‚С‡Рё, РіРґРµ РїРѕСЃР»Рµ С„РёР»СЊС‚СЂР° < 2 РєРѕРЅС‚РѕСЂ
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

// СЃРїРёСЃРѕРє РґРѕСЃС‚СѓРїРЅС‹С… Р»РёРі/РєР»СЋС‡РµР№ Сѓ API
app.get("/api/sports", async (_req, res) => {
  if (!KEY) return res.status(500).json({ error: "ODDS_API_KEY РЅРµ Р·Р°РґР°РЅ" });
  const r = await fetch(`${BASE}/sports?apiKey=${KEY}`);
  res.json(await r.json());
});

app.get("/", (_req, res) => res.json({ ok: true, service: "odds-backend", cacheKeys: [...cache.keys()] }));

// health-С‡РµРє
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
