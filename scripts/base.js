// ============================================================================
// base.js — global Supabase + unified data/cache layer
// ============================================================================

// ---------------------------------------------------------------------------
// Global state
// ---------------------------------------------------------------------------
var supabaseClient;
var defaultCacheDuration = 3 * 60 * 60 * 1000;

window.__supabasePreload = window.__supabasePreload || {};

// TTLs
var TTL_1H = 1 * 60 * 60 * 1000;
var TTL_3H = 3 * 60 * 60 * 1000;
var TTL_24H = 24 * 60 * 60 * 1000;

// Single canonical keys
var LS_KEYS = {
  maps: "base_maps",
  news: "base_news",
  teams: "base_teams",
  players: "base_players",
  games: "base_games",
};

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
$(document).ready(function () {
  initSupabase();
});

// ---------------------------------------------------------------------------
// Init Supabase
// ---------------------------------------------------------------------------
function initSupabase() {
  var supabaseUrl = "https://wenalkryitvdtpvzuzmn.supabase.co";
  var supabaseKey =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndlbmFsa3J5aXR2ZHRwdnp1em1uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk5Mzg1NjYsImV4cCI6MjA3NTUxNDU2Nn0.3rfU58K-oMHtx1xPc1SCVkpmkhHBhWW70vtTgNO-7Jg";

  supabaseClient = supabase.createClient(supabaseUrl, supabaseKey);
  window.supabaseClient = supabaseClient;

  document.dispatchEvent(
    new CustomEvent("supabase:ready", { detail: { client: supabaseClient } })
  );

  prefetchAllSupabaseData().catch(function (err) {
    console.warn("[base] prefetchAllSupabaseData failed:", err);
  });
}

// ============================================================================
// Prefetch (maps + news → teams → players → games)
// ============================================================================

async function prefetchAllSupabaseData() {
  if (!supabaseClient) {
    console.warn("[base] supabase client missing");
    return;
  }

  var forceRefresh = hasForceRefreshFlag();

  // 1) maps + news
  var maps = await ensureMapsPreloaded(forceRefresh);
  var news = await ensureNewsPreloaded(forceRefresh);

  // 2) teams
  var teams = await ensureTeamsPreloaded(forceRefresh);

  // 3) players
  var players = await ensurePlayersPreloaded(forceRefresh);

  // 4) games
  var games = await ensureGamesPreloaded(forceRefresh);

  console.log("[base] prefetch done", {
    maps: maps?.length || 0,
    news: news?.length || 0,
    teams: teams?.length || 0,
    players: players?.length || 0,
    games: games?.length || 0,
    force: forceRefresh,
  });
}

// ---------------------------------------------------------------------------
// Force refresh flag: ?refresh or ?refresh=1
// ---------------------------------------------------------------------------
function hasForceRefreshFlag() {
  try {
    var params = new URLSearchParams(window.location.search);
    if (params.has("refresh")) return true;
    var v = params.get("refresh");
    return v === "1" || v === "true";
  } catch (e) {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Teams (all columns we care about) — 24h
// ---------------------------------------------------------------------------
async function ensureTeamsPreloaded(force) {
  var key = LS_KEYS.teams;

  if (!force) {
    var cached = getCached(key, TTL_24H);
    if (cached) {
      // decorate cached teams with "players" using pname
      var decoratedCached = await attachPlayerLinesToTeams(cached);
      window.__supabasePreload.teams = decoratedCached;
      return decoratedCached;
    }
  }

  // pull everything we actually use across pages
  var { data, error } = await supabaseClient
    .from("teams")
    .select(
      [
        "id",
        "created_at",
        "slug",
        "tname",
        "tag",
        "group",
        "p1_slug",
        "p2_slug",
        "stat_wins",
        "stat_losses",
        "stat_rounds",
        "stat_hltv",
        "stat_kdr",
        "stat_adr",
        "m1_wins",
        "m1_losses",
        "m2_wins",
        "m2_losses",
        "m3_wins",
        "m3_losses",
        "m4_wins",
        "m4_losses",
        "m5_wins",
        "m5_losses",
        "m6_wins",
        "m6_losses",
        "m7_wins",
        "m7_losses",
      ].join(", ")
    );

  if (error) {
    console.error("[base] teams error:", error);
    return [];
  }

  var teamsWithPlayers = await attachPlayerLinesToTeams(data || []);

  setCached(key, teamsWithPlayers);
  window.__supabasePreload.teams = teamsWithPlayers;
  return teamsWithPlayers;
}

// ---------------------------------------------------------------------------
// Players (all relevant stat columns) — 24h
// ---------------------------------------------------------------------------
async function ensurePlayersPreloaded(force) {
  var key = LS_KEYS.players;
  if (!force) {
    var cached = getCached(key, TTL_24H);
    if (cached) {
      window.__supabasePreload.players = cached;
      return cached;
    }
  }

  var { data, error } = await supabaseClient
    .from("players")
    .select(
      [
        "id",
        "created_at",
        "slug",
        "pname",
        "stat_hltv",
        "stat_kdr",
        "stat_adr",
        "stat_utility",
        "stat_headshot",
        "stat_entry",
        "stat_clutch",
        "faceit",
        "medals_gold",
        "medals_silver",
        "medals_bronze",
        "medals_points",
        "role_streamer",
        "role_caster",
        "role_spielleiter",
      ].join(", ")
    );

  if (error) {
    console.error("[base] players error:", error);
    return [];
  }

  setCached(key, data || []);
  window.__supabasePreload.players = data || [];
  return data || [];
}

// ---------------------------------------------------------------------------
// Games (full dataset) — 3h
// ---------------------------------------------------------------------------
async function ensureGamesPreloaded(force) {
  var key = LS_KEYS.games;
  if (!force) {
    var cached = getCached(key, TTL_3H);
    if (cached) {
      window.__supabasePreload.games = cached;
      return cached;
    }
  }

  var { data, error } = await supabaseClient
    .from("games")
    .select(
      [
        "id",
        "created_at",
        "slug",
        "name",
        "group",
        "datetime",
        "t1_slug",
        "t2_slug",
        "t1_score_total",
        "t1_score_m1",
        "t1_score_m2",
        "t1_score_m3",
        "t1_score_m4",
        "t1_score_m5",
        "t1_score_m6",
        "t1_score_m7",
        "t1_score_m1_halftime",
        "t1_score_m2_halftime",
        "t1_score_m3_halftime",
        "t1_score_m4_halftime",
        "t1_score_m5_halftime",
        "t1_score_m6_halftime",
        "t1_score_m7_halftime",
        "t2_score_total",
        "t2_score_m1",
        "t2_score_m2",
        "t2_score_m3",
        "t2_score_m4",
        "t2_score_m5",
        "t2_score_m6",
        "t2_score_m7",
        "t2_score_m1_halftime",
        "t2_score_m2_halftime",
        "t2_score_m3_halftime",
        "t2_score_m4_halftime",
        "t2_score_m5_halftime",
        "t2_score_m6_halftime",
        "t2_score_m7_halftime",
        "vote_start",
        "vote_1",
        "vote_2",
        "vote_3",
        "vote_4",
        "vote_5",
        "vote_6",
        "vote_7",
        "vod_url",
        "active",
        "prod_streamer",
        "prod_cast_1",
        "prod_cast_2",
        "prod_spielleiter",
        "best_of",
      ].join(", ")
    )
    .order("datetime", { ascending: true });

  if (error) {
    console.error("[base] games error:", error);
    return [];
  }

  setCached(key, data || []);
  window.__supabasePreload.games = data || [];
  return data || [];
}

// ---------------------------------------------------------------------------
// Maps (hero needs them) — 24h
// ---------------------------------------------------------------------------
async function ensureMapsPreloaded(force) {
  var key = LS_KEYS.maps;
  if (!force) {
    var cached = getCached(key, TTL_24H);
    if (cached) {
      window.__supabasePreload.maps = cached;
      return cached;
    }
  }

  var { data, error } = await supabaseClient
    .from("maps")
    .select(
      [
        "id",
        "slug",
        "mname",
        "mid",
        "subtitle",
        "workshop_url",
        "created_at",
        "desc_lore",
        "desc_gameplay",
        "rating_tactical",
        "rating_utility",
        "rating_tsided",
      ].join(", ")
    );

  if (error) {
    console.error("[base] maps error:", error);
    return [];
  }

  var rows = (data || []).map(function (row) {
    var slug = row.slug || "";
    return Object.assign({}, row, {
      urlCover: buildAssetUrl("map", slug, "-cover"),
      urlEmblem: buildAssetUrl("map", slug, "-emblem"),
      urlCallouts: buildAssetUrl("map", slug, "-callouts"),
    });
  });

  setCached(key, rows);
  window.__supabasePreload.maps = rows;
  return rows;
}

// ---------------------------------------------------------------------------
// News — 1h
// ---------------------------------------------------------------------------
async function ensureNewsPreloaded(force) {
  var key = LS_KEYS.news;
  if (!force) {
    var cached = getCached(key, TTL_1H);
    if (cached) {
      window.__supabasePreload.news = cached;
      return cached;
    }
  }

  var { data, error } = await supabaseClient
    .from("news")
    .select(
      "id, created_at, newstext, edited_at, order, created_author, edited_author"
    )
    .order("order", { ascending: true });

  if (error) {
    console.error("[base] news error:", error);
    return [];
  }

  setCached(key, data || []);
  window.__supabasePreload.news = data || [];
  return data || [];
}

// ============================================================================
// Public fetchers (for site scripts)
// ============================================================================

async function fetchMaps() {
  if (window.__supabasePreload.maps) return window.__supabasePreload.maps;
  return ensureMapsPreloaded(false);
}

async function fetchNews() {
  if (window.__supabasePreload.news) return window.__supabasePreload.news;
  return ensureNewsPreloaded(false);
}

async function fetchTeams() {
  if (window.__supabasePreload.teams) return window.__supabasePreload.teams;
  return ensureTeamsPreloaded(false);
}

async function fetchPlayers() {
  if (window.__supabasePreload.players) return window.__supabasePreload.players;
  return ensurePlayersPreloaded(false);
}

async function fetchGames() {
  if (window.__supabasePreload.games) return window.__supabasePreload.games;
  return ensureGamesPreloaded(false);
}

async function fetchTeamBundle(teamSlug) {
  if (!teamSlug) return null;

  var teams = window.__supabasePreload.teams || (await fetchTeams());
  var players = window.__supabasePreload.players || (await fetchPlayers());

  var team =
    (teams || []).find(function (t) {
      return (t.slug || "").toLowerCase() === teamSlug.toLowerCase();
    }) || null;

  if (!team) return null;

  var p1 =
    (players || []).find(function (p) {
      return p.slug === team.p1_slug;
    }) || null;
  var p2 =
    (players || []).find(function (p) {
      return p.slug === team.p2_slug;
    }) || null;

  return { team: team, p1: p1, p2: p2 };
}

// ============================================================================
// Cache helpers
// ============================================================================

function getCached(key, ttlMs) {
  var ttl = typeof ttlMs === "number" ? ttlMs : defaultCacheDuration;
  var now = Date.now();

  try {
    var raw = localStorage.getItem(key);
    var ts = parseInt(localStorage.getItem(key + "_timestamp"), 10);
    if (!raw || !ts) return null;
    if (now - ts > ttl) return null;
    return JSON.parse(raw);
  } catch (err) {
    console.warn("[base] getCached failed for", key, err);
    return null;
  }
}

function setCached(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify(data));
    localStorage.setItem(key + "_timestamp", String(Date.now()));
  } catch (err) {
    console.warn("[base] setCached failed for", key, err);
  }
}

// ============================================================================
// Asset helpers
// ============================================================================

var rootPath = "https://glatte.info/gg/wc25/assets/";
var mapPath = "maps";
var playersPath = "players";
var teamsPath = "teams";
var filePath = ".webp";

function buildAssetUrl(pathType, slug, presetOrSuffix, teamSlug) {
  if (!pathType || !slug) {
    console.warn("buildAssetUrl: missing pathType or slug", {
      pathType: pathType,
      slug: slug,
      presetOrSuffix: presetOrSuffix,
    });
    return "";
  }

  var base = rootPath.replace(/\/+$/, "");
  var segment =
    pathType === "map"
      ? mapPath
      : pathType === "players"
      ? playersPath
      : pathType === "teams"
      ? teamsPath
      : null;

  if (!segment) {
    console.warn("buildAssetUrl: unknown pathType", pathType);
    return "";
  }

  var cleanSlug = String(slug).replace(/^\/+|\/+$/g, "");
  var folder = segment.replace(/^\/+|\/+$/g, "");
  var preset = (presetOrSuffix || "").toString().trim().toLowerCase();

  var teamLogoMap = {
    "logo-72-flat": cleanSlug + "_logo-72px_flat.webp",
    "logo-150-flat": cleanSlug + "_logo-150px_flat.webp",
    "logo-150-iso": cleanSlug + "_logo-150px_isolated.webp",
    "logo-800-iso": cleanSlug + "_logo-800px_isolated.webp",
    teambg: cleanSlug + "_teambg.webp",
  };

  var playerPresetRe = /^(p[12])-(60|150|800)$/;

  if (preset && pathType === "teams" && teamLogoMap[preset]) {
    return base + "/" + folder + "/" + teamLogoMap[preset];
  }

  if (preset && pathType === "players" && playerPresetRe.test(preset)) {
    var parts = preset.split("-");
    var pIdx = parts[0];
    var size = parts[1];
    var effectiveSlug = teamSlug ? String(teamSlug).trim() : cleanSlug;
    var filename = effectiveSlug + "_" + pIdx + "-" + size + "px.webp";
    return base + "/" + folder + "/" + filename;
  }

  var cleanSuffix = preset ? String(preset) : "";
  return base + "/" + folder + "/" + cleanSlug + cleanSuffix + filePath;
}

function buildRankAssetUrl(rank) {
  if (rank === 0 || rank === "0" || rank === undefined || rank === null) {
    return rootPath + "faceit-unknown.png";
  }
  return rootPath + "faceit" + rank + ".svg";
}

function buildMedalsAssetUrl(medalTier) {
  return rootPath + "medals-" + medalTier + ".webp";
}

function buildTeamUrl(slug) {
  if (!slug) return "#";
  var origin = window.location.origin;
  return origin + "/team?slug=" + encodeURIComponent(slug);
}

// PLAYER LINE -----------------------------------------------------------------

/**
 * Build a simple "p1 & p2" line and cache it in localStorage.
 *
 * @param {string} p1Name
 * @param {string} p2Name
 * @param {object} [options]
 * @param {string} [options.storageKey]  - if provided, result is cached under this key
 * @param {boolean} [options.forceRefresh=false] - if true, rebuild even if cached
 * @returns {string} "p1 & p2"
 */
function buildPlayerLine(p1Name, p2Name, options) {
  options = options || {};
  var key = options.storageKey;
  var force = !!options.forceRefresh;

  if (key && !force) {
    try {
      var cached = localStorage.getItem(key);
      if (cached && typeof cached === "string" && cached.length > 0) {
        return cached;
      }
    } catch (e) {
      console.warn("[buildPlayerLine] cache read failed:", e);
    }
  }

  var safe = function (s) {
    return s == null ? "" : String(s).trim();
  };
  var line = safe(p1Name) + " & " + safe(p2Name);

  if (key) {
    try {
      localStorage.setItem(key, line);
    } catch (e) {
      console.warn("[buildPlayerLine] cache write failed:", e);
    }
  }

  return line;
}

/**
 * Attach "players" lines (p1 & p2, using player.pname) to a list of team rows.
 *
 * @param {Array<object>} teams
 * @returns {Promise<Array<object>>}
 */
async function attachPlayerLinesToTeams(teams) {
  if (!teams || !Array.isArray(teams) || teams.length === 0) return teams || [];

  // ensure players are available
  var players = window.__supabasePreload.players;
  if (!players) {
    players = await fetchPlayers();
  }

  function findPlayerBySlug(slug) {
    if (!slug) return null;
    var needle = String(slug).toLowerCase();
    return (
      (players || []).find(function (p) {
        return String(p.slug || "").toLowerCase() === needle;
      }) || null
    );
  }

  return teams.map(function (t) {
    var teamSlugLower = String(t.slug || "").toLowerCase();

    var p1Obj = findPlayerBySlug(t.p1_slug);
    var p2Obj = findPlayerBySlug(t.p2_slug);

    var p1Name = p1Obj && p1Obj.pname ? p1Obj.pname : t.p1_slug || "";
    var p2Name = p2Obj && p2Obj.pname ? p2Obj.pname : t.p2_slug || "";

    var playersLine = buildPlayerLine(p1Name, p2Name, {
      forceRefresh: true,
    });

    return Object.assign({}, t, {
      players: playersLine,
    });
  });
}
