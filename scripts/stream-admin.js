// =============================================================================
// BOOT
// =============================================================================

// [STATE] -------------------------------------------------------------------
// Streamadmin-local namespace
window.SA = window.SA || {
  supabase: null,
  session: null,
  user: null,
  player: null,
  team: null,

  // Data caches for this page
  games: [],
  teams: [],
  gamesBySlug: {},
  teamsBySlug: {},
  activeGame: null,

  // Results UI state
  resultsPlayedMaps: [],

  // News editor state
  news: [],
  newsById: {},
  newsPlayersBySlug: {},
  newsTemplatePrepared: false,
  $newsTemplate: null,
  $newsList: null,

  // Internal flags
  _bootstrapped: false,
  _wiredGameSelect: false,
  _wiredResultsSection: false,
  _wiredNewsSection: false,
  _wiredCastSection: false,
};

var SA = window.SA;

// [VARIABLES] ----------------------------------------------------------------
var saCFG = {
  sec: {
    auth: '[sa-section="auth"]',
    active: '[sa-section="active-game"]',
    results: '[sa-section="results"]',
    news: '[sa-section="news"]',
    cast: '[sa-section="cast"]',
  },
  el: {
    pageWrap: "#streamadmin",
  },
};

// [DOC READY] ---------------------------------------------------------------
$(document).ready(function () {
  initStreamAdminPage();
});

// [INITIALIZE STREAMADMIN PAGE] ---------------------------------------------
function initStreamAdminPage() {
  var $root = $("#streamadmin");
  if ($root.length === 0) return;

  SA.$root = $root;
  SA.$root.addClass("is--js-ready");

  saWireAuthUI();
  saWireActiveGameSelect();
  saWireResultsSection();
  saWireNewsSection();
  saWireCastSection();
  saInitAuth();

  // Initial attributes (no active game / no veto)
  SA.$root.attr("sa-has-active", "false");
  SA.$root.attr("sa-has-veto", "false");

  initNewsticker(true);
}

// =============================================================================
// GLOBAL HELPERS
// =============================================================================

// [DATA LOADERS] ---------------------------------------------------------------
async function saEnsureGamesAndTeamsLoaded() {
  // If both are already present, keep them
  if (
    Array.isArray(SA.games) &&
    SA.games.length &&
    Array.isArray(SA.teams) &&
    SA.teams.length
  ) {
    return;
  }

  var games = [];
  var teams = [];

  try {
    games = await fetchGames();
  } catch (err) {
    console.warn("[stream-admin] Failed to load games:", err);
  }

  try {
    teams = await fetchTeams();
  } catch (err) {
    console.warn("[stream-admin] Failed to load teams:", err);
  }

  SA.games = Array.isArray(games) ? games.slice() : [];
  SA.teams = Array.isArray(teams) ? teams.slice() : [];

  SA.gamesBySlug = indexBy(SA.games, "slug");
  SA.teamsBySlug = indexBy(SA.teams, "slug");
}

// [TEAM LOGO HELPER] ----------------------------------------------------------
function saSetTeamLogo($el, url) {
  if (!$el || !$el.length || !url) return;

  // Support both <img> and generic block elements (avatar divs)
  if ($el.is("img")) {
    $el.removeAttr("srcset");
    $el.attr("src", url);
  } else {
    $el.removeAttr("srcset");
    $el.css("background-image", 'url("' + url + '")');
  }
}

// [INSERT TEAM DATA FOR ACTIVE GAME]  -----------------------------------------
function saInsertTeamDataForActiveGame() {
  var game = SA.activeGame;
  if (!game) return;

  var teamsBySlug = SA.teamsBySlug || {};
  if (!teamsBySlug || !SA.teams || SA.teams.length === 0) return;

  function getTeamForSlot(slotNumber) {
    var slug =
      slotNumber === 2 ? game.t2_slug || game.t2 : game.t1_slug || game.t1;
    if (!slug) return null;
    return teamsBySlug[slug] || null;
  }

  // Note: we intentionally target all [data-base="t1"] and [data-base="t2"]
  // containers across the page (active card + results section).
  $('[data-base="t1"], [data-base="t2"]').each(function () {
    var $container = $(this);
    var base = String($container.attr("data-base") || "").toLowerCase();
    var slotNumber = base === "t2" ? 2 : 1;

    var team = getTeamForSlot(slotNumber);
    var $nameEl = $container.find('[data-base="tname"]').first();
    var $tagEl = $container.find('[data-base="tag"]').first();
    var $playersEl = $container.find('[data-base="players"]').first();
    var $logoEl = $container.find('[data-base="logo-72-flat"]').first();

    if (!team) {
      setTextIfExists($nameEl, "");
      setTextIfExists($tagEl, "");
      setTextIfExists($playersEl, "");
      if ($logoEl.length) {
        $logoEl.removeAttr("src").removeAttr("srcset");
        $logoEl.css("background-image", "");
      }
      return;
    }

    setTextIfExists($nameEl, team.tname || "");
    setTextIfExists($tagEl, team.tag || "");
    setTextIfExists($playersEl, team.players || "");

    var logoUrl = buildAssetUrl("teams", team.slug, "logo-72-flat");
    saSetTeamLogo($logoEl, logoUrl);
  });
}

// [GAME LABEL / SORT HELPERS] -------------------------------------------------
function saBuildGameOptionLabel(game) {
  if (!game) return "";
  var name = game.name || game.slug || "";
  var t1 = (game.t1_slug || "").toString().toUpperCase();
  var t2 = (game.t2_slug || "").toString().toUpperCase();

  if (t1 && t2) {
    return name + " · " + t1 + " vs " + t2;
  }
  return name;
}

function saParseSlugParts(slug) {
  var raw = String(slug || "").toLowerCase();
  var m = /^([a-z]+)(\d+)$/.exec(raw);
  if (!m) {
    return { prefix: raw, num: 0 };
  }
  return { prefix: m[1], num: parseInt(m[2], 10) || 0 };
}

function saCompareGroupGameSlugs(a, b) {
  var pa = saParseSlugParts(a && a.slug);
  var pb = saParseSlugParts(b && b.slug);

  if (pa.prefix !== pb.prefix) {
    return pa.prefix.localeCompare(pb.prefix);
  }
  return pa.num - pb.num;
}

function saFindRecommendedGame(games) {
  var list = Array.isArray(games) ? games : [];
  if (!list.length) return null;

  var now = Date.now();
  var best = null;
  var bestDiff = Infinity;

  list.forEach(function (g) {
    if (!g || !g.datetime) return;
    var t = Date.parse(g.datetime);
    if (!Number.isFinite(t)) return;

    var diff = Math.abs(t - now);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = g;
    }
  });

  return best;
}

// [UNLOAD WARNING HELPERS] -----------------------------------------------------
// Generic beforeunload guard that can be reused by multiple sections.
var saUnloadGuards = [];
var saUnloadGuardBound = false;

function saRegisterBeforeUnloadGuard(id, checkFn, message) {
  if (!id || typeof checkFn !== "function") return;

  if (!saUnloadGuardBound) {
    saUnloadGuardBound = true;
    window.addEventListener("beforeunload", saBeforeUnloadHandler);
  }

  var existing = null;
  for (var i = 0; i < saUnloadGuards.length; i++) {
    if (saUnloadGuards[i] && saUnloadGuards[i].id === id) {
      existing = saUnloadGuards[i];
      break;
    }
  }

  if (existing) {
    existing.check = checkFn;
    if (typeof message === "string" && message) {
      existing.message = message;
    }
  } else {
    saUnloadGuards.push({
      id: id,
      check: checkFn,
      message: typeof message === "string" && message ? message : null,
    });
  }
}

function saBeforeUnloadHandler(event) {
  var guards = saUnloadGuards || [];
  for (var i = 0; i < guards.length; i++) {
    var g = guards[i];
    if (!g || typeof g.check !== "function") continue;

    try {
      if (g.check()) {
        var msg =
          g.message ||
          "Es liegen ungespeicherte Änderungen vor. " +
            "Wenn du die Seite verlässt, gehen Änderungen möglicherweise verloren.";
        event.preventDefault();
        event.returnValue = msg;
        return msg;
      }
    } catch (err) {
      console.warn("[stream-admin] beforeunload guard error:", err);
    }
  }
}

// =============================================================================
// AUTHENTICATION
// =============================================================================

// [AUTH BOOTSTRAP (STREAMADMIN)] --------------------------------------------
async function saInitAuth() {
  var MAX_WAIT_MS = 8000;
  var POLL_MS = 200;
  var started = Date.now();

  function hasAuthCore() {
    return !!window.AppAuth && typeof authInitLifecycle === "function";
  }

  // Wait until script-auth has defined AppAuth + authInitLifecycle
  while (!hasAuthCore() && Date.now() - started < MAX_WAIT_MS) {
    await new Promise(function (resolve) {
      setTimeout(resolve, POLL_MS);
    });
  }

  if (!hasAuthCore()) {
    console.warn(
      "[stream-admin:auth] Auth core not available after wait; aborting auth init"
    );
    return;
  }

  // Page-specific reaction to auth changes
  AppAuth.onAuthStateChange = saOnAuthStateChange;

  try {
    await authInitLifecycle();
  } catch (e) {
    console.error("[stream-admin] auth bootstrap failed:", e);
    authStatus("Verbindungsfehler. Bitte Seite neu laden.", "error");
  }
}

// [AUTH STATE HANDLING (STREAMADMIN)] ---------------------------------------
async function saOnAuthStateChange(payload) {
  var isSignedIn = !!payload && !!payload.isSignedIn;
  var hasPlayer = !!payload && !!payload.player;

  if (!SA.$root || SA.$root.length === 0) {
    return;
  }

  // PATCH: If role_streamer is missing (undefined) but we have a player, try to find it via SLUG
  if (
    isSignedIn &&
    hasPlayer &&
    typeof payload.player.role_streamer === "undefined"
  ) {
    try {
      var found = false;
      var mySlug = payload.player.slug;

      console.log("[stream-admin] Patch: Starting patch for slug:", mySlug);

      if (mySlug) {
        // 1. Try finding in global cache (base.js)
        if (typeof fetchPlayers === "function") {
          var allPlayers = await fetchPlayers();
          var cached = (allPlayers || []).find(function (p) {
            return p && p.slug === mySlug;
          });

          if (cached) {
            payload.player.role_streamer = !!cached.role_streamer;
            found = true;
            console.log(
              "[stream-admin] Patch: Found role via cache:",
              payload.player.role_streamer
            );
          }
        }

        // 2. If not in cache, fetch directly via slug
        if (!found && AppAuth && AppAuth.supabase) {
          console.log("[stream-admin] Patch: Cache miss. Fetching via slug...");
          var res = await AppAuth.supabase
            .from("players")
            .select("role_streamer")
            .eq("slug", mySlug)
            .maybeSingle();

          if (res.data) {
            payload.player.role_streamer = !!res.data.role_streamer;
            console.log(
              "[stream-admin] Patch: Direct fetch success. Role =",
              payload.player.role_streamer
            );
          } else {
            console.warn(
              "[stream-admin] Patch: Direct fetch returned no data for slug:",
              mySlug
            );
          }
        }
      } else {
        console.warn(
          "[stream-admin] Patch: Player object has no slug.",
          payload.player
        );
      }
    } catch (err) {
      console.warn("[stream-admin] Patch failed:", err);
    }
  }

  var isStreamer = hasPlayer && !!payload.player.role_streamer;

  SA.$root
    .toggleClass("is--signed-in", isSignedIn)
    .toggleClass("is--signed-out", !isSignedIn)
    .toggleClass("is--streamer", isStreamer);

  // Toggle sections based on auth
  SA.$root.find('[data-auth="signed-in"]').prop("hidden", !isSignedIn);
  SA.$root.find('[data-auth="signed-out"]').prop("hidden", isSignedIn);

  // Wenn nicht eingeloggt: lokalen State zurücksetzen
  if (!isSignedIn) {
    // globaler Helper aus script-auth.js
    authStatus(null);
    SA._bootstrapped = false;
    SA.activeGame = null;

    // Reset active game + results attributes / UI
    saRenderActiveGameSection();
    saUpdateHasVetoFlag(false);
    saResultsClear();
    saRenderCastSection(); // Reset cast inputs

    // Reset news editor state
    SA.news = [];
    SA.newsById = {};
    SA.newsPlayersBySlug = {};
    SA.newsTemplatePrepared = false;
    SA.$newsTemplate = null;
    SA.$newsList = null;
    saNewsRenderEmptyState();

    return;
  }

  // Mirror auth state into SA for convenience
  SA.supabase = AppAuth.supabase;
  SA.session = payload.session || null;
  SA.user = payload.user || null;
  SA.player = payload.player || null;
  SA.team = payload.team || null;

  // Ohne Player (Whitelist) keine Admin-Controls
  if (!hasPlayer) {
    return;
  }

  try {
    await saBootstrapActiveGameSection();
  } catch (err) {
    console.warn(
      "[stream-admin] Failed to bootstrap active game section:",
      err
    );
  }

  try {
    await saNewsReloadFromBackend();
  } catch (err) {
    console.warn("[stream-admin] Failed to bootstrap news section:", err);
  }
}

// [AUTH UI WIRING] ----------------------------------------------------------
function saWireAuthUI() {
  $(document).on("click", '[data-auth-button="login"]', async function (e) {
    e.preventDefault();
    await authOnLoginDiscord();
  });

  $(document).on("click", '[data-auth-button="logout"]', async function (e) {
    e.preventDefault();
    $(saCFG.el.pageWrap)
      .removeClass("is--signed-in")
      .addClass("is--signed-out");
    await authOnLogout();
  });
}

// =============================================================================
// ACTIVE GAME SECTION
// =============================================================================

// INTERNAL BOOTSTRAP --------------------------------------------------------
async function saBootstrapActiveGameSection() {
  if (SA._bootstrapped) return;
  SA._bootstrapped = true;

  await saEnsureGamesAndTeamsLoaded();
  await saSetActiveGameFromMemory();
  saPrepareActiveGameSelect();
}

// SET ACTIVE GAME FROM MEMORY -----------------------------------------------
async function saSetActiveGameFromMemory() {
  var list = Array.isArray(SA.games) ? SA.games : [];
  if (!list.length) {
    SA.activeGame = null;
    saRenderActiveGameSection();
    await saResultsRefreshForActiveGame(false);
    return;
  }

  var active = list.find(function (g) {
    return g && g.active === true;
  });

  SA.activeGame = active || null;
  saRenderActiveGameSection();
  await saResultsRefreshForActiveGame(false);
}

// RENDER ACTIVE GAME CARD ---------------------------------------------------
function saRenderActiveGameSection() {
  var $root = SA.$root && SA.$root.length ? SA.$root : $("#streamadmin");
  if (!$root.length) return;

  // Track whether there is an active game (CSS empty state)
  var hasActive = !!(SA.activeGame && SA.activeGame.slug);
  $root.attr("sa-has-active", hasActive ? "true" : "false");

  var $card = $root.find('[sa-active="active"]').first();
  var $empty = $root.find('[sa-active="empty"]').first();

  if (!$card.length || !$empty.length) return;

  if (!SA.activeGame) {
    $card.addClass("is--hidden");
    $empty.removeClass("is--hidden");
    saRenderCastSection(); // Clear cast inputs
    return;
  }

  $card.removeClass("is--hidden");
  $empty.addClass("is--hidden");

  var game = SA.activeGame;
  var gameName = game.name || game.slug || "";
  var dtShort = game.datetime
    ? convertDateTime(game.datetime, "datetime-long")
    : "";

  var $nameEls = $card.find('[data-base="name"]');
  setTextIfExists($nameEls, gameName);

  var $dtEl = $card.find('[data-base="datetime-long"]').first();
  setTextIfExists($dtEl, dtShort);

  // Team info for this game (used by active card + results section)
  saInsertTeamDataForActiveGame();

  // Render Cast Section with active game data
  saRenderCastSection();
}

// PREPARE ACTIVE GAME SELECT ------------------------------------------------
function saPrepareActiveGameSelect() {
  var $root = SA.$root && SA.$root.length ? SA.$root : $("#streamadmin");
  if (!$root.length) return;

  var $select = $root.find('[sa-active="game-select"]').first();
  if (!$select.length) return;

  var games = Array.isArray(SA.games) ? SA.games : [];
  $select.empty();

  if (!games.length) {
    $select.append(
      $("<option>").attr("disabled", true).text("Keine Spiele verfügbar")
    );
    return;
  }

  var activeSlug = SA.activeGame && SA.activeGame.slug;
  var recommended = saFindRecommendedGame(games);
  var recommendedSlug = recommended ? recommended.slug : null;

  // Build selectable games list (include active game so it can be selected)
  var selectableGames = games.filter(function (g) {
    return g && g.slug;
  });

  var groupGames = selectableGames.filter(function (g) {
    return String(g.group || "").toLowerCase() !== "ko";
  });

  var koGames = selectableGames.filter(function (g) {
    return String(g.group || "").toLowerCase() === "ko";
  });

  // Sort: Group games via helper, KO games alphabetically
  groupGames.sort(saCompareGroupGameSlugs);
  koGames.sort(function (a, b) {
    return String(a.slug || "").localeCompare(String(b.slug || ""));
  });

  var firstSelectableValue = null;

  // Helper to build label and append option
  function appendGameOption(g) {
    var val = "slug:" + g.slug;
    var label = saBuildGameOptionLabel(g);

    // Append emoji if this is the recommended game
    if (g.slug === recommendedSlug) {
      label += " ⭐";
    }

    var $opt = $("<option>").val(val).text(label);
    $select.append($opt);

    // Capture the first item added to the list for default selection
    firstSelectableValue = firstSelectableValue || val;
  }

  // 1) All group games (group != 'ko')
  groupGames.forEach(appendGameOption);

  // 2) All ko games (group = 'ko')
  koGames.forEach(appendGameOption);

  // Select the active game if present in the list
  if (activeSlug) {
    $select.val("slug:" + activeSlug);
  }

  // Fallback: If no active game set or found, select the first available option
  if (!$select.val() && firstSelectableValue) {
    $select.val(firstSelectableValue);
  }
}

// PERSIST ACTIVE GAME IN SUPABASE -------------------------------------------
async function saPersistActiveGame(game) {
  if (!AppAuth.supabase || !game || !game.slug) return;

  try {
    // Clear previous active flags
    await AppAuth.supabase
      .from("games")
      .update({ active: false })
      .eq("active", true);
  } catch (err) {
    console.warn("[stream-admin] Failed to clear previous active games:", err);
  }

  try {
    await AppAuth.supabase
      .from("games")
      .update({ active: true })
      .eq("slug", game.slug);
  } catch (err) {
    console.warn("[stream-admin] Failed to set active game:", err);
  }

  // Update local state + preload cache
  (SA.games || []).forEach(function (g) {
    if (!g) return;
    g.active = g.slug === game.slug;
  });

  try {
    if (window.__supabasePreload) {
      window.__supabasePreload.games = SA.games.slice();
    }
    if (typeof setCached === "function") {
      setCached(LS_KEYS.games, SA.games);
    }
  } catch (e) {
    console.warn("[stream-admin] Failed to update local games cache:", e);
  }
}

// HANDLE GAME SELECT CHANGE -------------------------------------------------
function saWireActiveGameSelect() {
  if (SA._wiredGameSelect) return;
  SA._wiredGameSelect = true;

  $(document).on("change", '[sa-active="game-select"]', function () {
    var rawValue = $(this).val();
    saOnGameSelectChange(rawValue);
  });
}

function saOnGameSelectChange(rawValue) {
  if (!rawValue) return;
  var value = String(rawValue);

  var m = /^slug:(.+)$/.exec(value);
  if (!m) return;

  var slug = m[1];
  if (!slug) return;

  if (SA.activeGame && SA.activeGame.slug === slug) {
    // Nothing to do
    return;
  }

  saSetActiveGameFromSelect(slug);
}

async function saSetActiveGameFromSelect(slug) {
  if (!slug) return;

  await saEnsureGamesAndTeamsLoaded();

  var game =
    (SA.gamesBySlug && SA.gamesBySlug[slug]) ||
    (SA.games || []).find(function (g) {
      return g && g.slug === slug;
    });

  if (!game) {
    console.warn("[stream-admin] Selected game not found for slug:", slug);
    return;
  }

  await saPersistActiveGame(game);

  SA.activeGame = game;
  saRenderActiveGameSection();
  saPrepareActiveGameSelect();
  await saResultsRefreshForActiveGame(true);
}

// =============================================================================
// RESULTS SECTION
// =============================================================================

// WIRING ---------------------------------------------------------------------
function saWireResultsSection() {
  if (SA._wiredResultsSection) return;
  SA._wiredResultsSection = true;

  // Refresh button: re-check veto + rebuild map list
  $(document).on("click", '[sa-results="refresh"]', async function (e) {
    if (e && typeof e.preventDefault === "function") {
      e.preventDefault();
    }
    await saResultsRefreshForActiveGame(true);
  });

  // Send button: persist scores to Supabase
  $(document).on("click", '[sa-results="send"]', async function (e) {
    if (e && typeof e.preventDefault === "function") {
      e.preventDefault();
    }
    await saResultsSendToSupabase();
  });

  // Input handling: clamp values + recompute totals
  $(document).on("input", "[sa-results-input]", function () {
    saClampResultsInput($(this));
    saResultsRecalculateTotals();
  });

  // Warn if results are dirty or not complete for the configured best_of
  saRegisterBeforeUnloadGuard(
    "results",
    saResultsShouldWarnBeforeUnload,
    "Ergebnisse sind noch nicht vollständig gespeichert " +
      "oder unvollständig eingetragen. Wenn du die Seite verlässt, " +
      "gehen Änderungen möglicherweise verloren."
  );
}

// ATTR FLAG HELPER ----------------------------------------------------------
function saUpdateHasVetoFlag(hasVeto) {
  var $root = SA.$root && SA.$root.length ? SA.$root : $("#streamadmin");
  if (!$root.length) return;
  $root.attr("sa-has-veto", hasVeto ? "true" : "false");
}

// VETO COMPLETENESS CHECK ----------------------------------------------------
function saHasCompleteVeto(game) {
  if (!game) return false;

  if (!isNonEmpty(game.vote_start)) return false;

  for (var i = 1; i <= 7; i++) {
    var key = "vote_" + i;
    if (!isNonEmpty(game[key])) return false;
  }

  return true;
}

// CLEAR RESULTS UI -----------------------------------------------------------
function saResultsClear() {
  var $root = SA.$root && SA.$root.length ? SA.$root : $("#streamadmin");
  if (!$root.length) return;

  var $sec = $root.find(saCFG.sec.results).first();
  if (!$sec.length) return;

  var $maps = $sec.find('[sa-results-element="map"]');
  if (!$maps.length) return;

  var $template = $maps.first();
  $sec.find('[sa-results-element="map"]').not($template).remove();

  $template.addClass("is--template");
  $template.removeAttr("sa-results-slug");
  $template.find('[sa-results-map="name"]').each(function () {
    $(this).text("");
  });
  $template.find("[sa-results-input]").val("");

  $sec.find('[sa-results-total="1"], [sa-results-total="2"]').each(function () {
    $(this).text("0");
  });

  SA.resultsPlayedMaps = [];
}

// VOTE → PLAYED MAPS MAPPING -------------------------------------------------
function saGetVoteIndicesForBestOf(bestOf) {
  var bo = parseInt(bestOf, 10);
  if (!Number.isFinite(bo)) bo = 1;

  if (bo === 1) return [7];
  if (bo === 3) return [3, 4, 7];
  if (bo === 5) return [3, 4, 5, 6, 7];
  if (bo === 7) return [1, 2, 3, 4, 5, 6, 7];

  // Fallback: treat as BO1 (only decider)
  return [7];
}

function saBuildPlayedMapsForGame(game, mapsBySlug) {
  var votes = saGetVoteIndicesForBestOf(game.best_of);
  var list = [];
  var mapIndex = 1;

  votes.forEach(function (voteIndex) {
    var key = "vote_" + voteIndex;
    var slug = String(game[key] || "").trim();
    if (!slug) return;

    var mapRow = mapsBySlug[slug] || null;

    list.push({
      mapIndex: mapIndex,
      voteIndex: voteIndex,
      slug: slug,
      name: (mapRow && mapRow.mname) || slug,
    });

    mapIndex += 1;
  });

  return list;
}

// MAIN REFRESH ENTRYPOINT ---------------------------------------------------
async function saResultsRefreshForActiveGame(forceReload) {
  var game = SA.activeGame;
  if (!AppAuth.supabase || !game || !game.slug) {
    saResultsClear();
    saUpdateHasVetoFlag(false);
    return;
  }

  var freshGame = game;

  // Check if we need to load caster fields (in case they weren't in the initial load)
  var needsCastData = game && typeof game.prod_cast_1_display === "undefined";

  // Optional fresh pull from Supabase for the active game
  if (forceReload || needsCastData) {
    try {
      var res = await AppAuth.supabase
        .from("games")
        .select(
          [
            "id",
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
            "t2_score_total",
            "t2_score_m1",
            "t2_score_m2",
            "t2_score_m3",
            "t2_score_m4",
            "t2_score_m5",
            "t2_score_m6",
            "t2_score_m7",
            "vote_start",
            "vote_1",
            "vote_2",
            "vote_3",
            "vote_4",
            "vote_5",
            "vote_6",
            "vote_7",
            "best_of",
            // Added caster fields
            "prod_cast_1_display",
            "prod_cast_2_display",
          ].join(", ")
        )
        .eq("slug", game.slug)
        .maybeSingle();

      if (res.error) {
        console.warn("[stream-admin] Failed to reload game:", res.error);
      } else if (res.data) {
        freshGame = res.data;
        SA.activeGame = freshGame;

        // Refresh local caches
        SA.gamesBySlug = SA.gamesBySlug || {};
        SA.gamesBySlug[freshGame.slug] = freshGame;

        if (Array.isArray(SA.games) && SA.games.length) {
          SA.games = SA.games.map(function (g) {
            return g && g.slug === freshGame.slug ? freshGame : g;
          });
        }

        if (window.__supabasePreload && window.__supabasePreload.games) {
          window.__supabasePreload.games = window.__supabasePreload.games.map(
            function (g) {
              return g && g.slug === freshGame.slug ? freshGame : g;
            }
          );
        }

        // Re-render cast section since we have fresh data
        saRenderCastSection();
      }
    } catch (err) {
      console.warn("[stream-admin] Error reloading game:", err);
    }
  }

  var hasVeto = saHasCompleteVeto(freshGame);
  saUpdateHasVetoFlag(hasVeto);

  if (!hasVeto) {
    saResultsClear();
    return;
  }

  try {
    await saRenderResultsSection(freshGame);
    saResultsRecalculateTotals();
  } catch (err) {
    console.warn("[stream-admin] Failed to render results section:", err);
  }
}

// RENDER RESULTS MAP LIST ----------------------------------------------------
async function saRenderResultsSection(game) {
  if (!game) {
    saResultsClear();
    return;
  }

  var maps = (window.__supabasePreload && window.__supabasePreload.maps) || [];
  if (!Array.isArray(maps) || !maps.length) {
    try {
      maps = await fetchMaps();
    } catch (err) {
      console.warn("[stream-admin] Failed to load maps for results:", err);
      saResultsClear();
      return;
    }
  }

  var mapsBySlug = indexBy(maps || [], "slug");
  var played = saBuildPlayedMapsForGame(game, mapsBySlug);
  SA.resultsPlayedMaps = played;

  var $root = SA.$root && SA.$root.length ? SA.$root : $("#streamadmin");
  if (!$root.length) return;

  var $sec = $root.find(saCFG.sec.results).first();
  if (!$sec.length) return;

  var $template = $sec.find('[sa-results-element="map"]').first();
  if (!$template.length) {
    console.warn(
      '[stream-admin] Missing [sa-results-element="map"] template in results'
    );
    return;
  }

  // Prepare template & clear existing clones
  $template.addClass("is--template");
  $sec.find('[sa-results-element="map"]').not($template).remove();

  if (!played.length) {
    saResultsClear();
    return;
  }

  played.forEach(function (m) {
    var $clone = $template.clone(true, true);
    $clone.removeClass("is--template");
    $clone.attr("sa-results-slug", m.slug);
    $clone.attr("data-map-index", m.mapIndex);
    $clone.attr("data-vote-index", m.voteIndex);

    var $nameEl = $clone.find('[sa-results-map="name"]').first();
    setTextIfExists($nameEl, m.name);

    // Prefill scores from game if available
    var t1Key = "t1_score_m" + m.mapIndex;
    var t2Key = "t2_score_m" + m.mapIndex;

    var t1Score = game[t1Key];
    var t2Score = game[t2Key];

    var $input1 = $clone.find('[sa-results-input="1"]').first();
    var $input2 = $clone.find('[sa-results-input="2"]').first();

    if (isFiniteNum(t1Score)) {
      $input1.val(String(t1Score));
    } else {
      $input1.val("");
    }

    if (isFiniteNum(t2Score)) {
      $input2.val(String(t2Score));
    } else {
      $input2.val("");
    }

    // Insert each row before the template so template stays last
    $clone.insertBefore($template);
  });

  saResultsRecalculateTotals();
}

// INPUT HELPERS --------------------------------------------------------------
function saClampResultsInput($input) {
  if (!$input || !$input.length) return;

  var raw = String($input.val() || "");
  var digits = raw.replace(/[^\d]/g, "");

  if (!digits) {
    // Allow empty input but treat as 0 in calculations
    $input.val("");
    return;
  }

  var n = parseInt(digits, 10);
  if (!Number.isFinite(n) || n < 0) n = 0;
  if (n > 50) n = 50;

  $input.val(String(n));
}

function saReadResultsInput($input) {
  if (!$input || !$input.length) return 0;
  var raw = String($input.val() || "");
  if (!raw) return 0;

  var n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return 0;
  if (n > 50) return 50;
  return n;
}

// TOTALS & WINNER CALCULATION -----------------------------------------------
function saResultsRecalculateTotals() {
  var $root = SA.$root && SA.$root.length ? SA.$root : $("#streamadmin");
  if (!$root.length) return;

  var $sec = $root.find(saCFG.sec.results).first();
  if (!$sec.length) return;

  var wins1 = 0;
  var wins2 = 0;

  $sec
    .find('[sa-results-element="map"]')
    .not(".is--template")
    .each(function () {
      var $row = $(this);
      var $i1 = $row.find('[sa-results-input="1"]').first();
      var $i2 = $row.find('[sa-results-input="2"]').first();

      var s1 = saReadResultsInput($i1);
      var s2 = saReadResultsInput($i2);

      $row.removeClass("is--winner-1 is--winner-2 is--draw");

      if (s1 > s2) {
        wins1 += 1;
        $row.addClass("is--winner-1");
      } else if (s2 > s1) {
        wins2 += 1;
        $row.addClass("is--winner-2");
      } else if (s1 === s2 && (s1 > 0 || s2 > 0)) {
        $row.addClass("is--draw");
      }
    });

  $sec.find('[sa-results-total="1"]').each(function () {
    $(this).text(String(wins1));
  });
  $sec.find('[sa-results-total="2"]').each(function () {
    $(this).text(String(wins2));
  });
}

// DIRTY / COMPLETENESS CHECKS -----------------------------------------------

function saResultsMinimumCompletedMapsRequired(bestOf) {
  var bo = parseInt(bestOf, 10);
  if (!Number.isFinite(bo) || bo <= 0) return 0;
  // In einem BOx muss immer die Hälfte + 1 gewonnen werden
  return Math.floor(bo / 2) + 1;
}

function saResultsHasUnsavedChanges() {
  var game = SA.activeGame;
  if (!game || !game.slug) return false;

  var $root = SA.$root && SA.$root.length ? SA.$root : $("#streamadmin");
  if (!$root.length) return false;

  var $sec = $root.find(saCFG.sec.results).first();
  if (!$sec.length) return false;

  var changed = false;

  $sec
    .find('[sa-results-element="map"]')
    .not(".is--template")
    .each(function () {
      if (changed) return false;

      var $row = $(this);
      var mapIndex = Number($row.attr("data-map-index") || 0);
      if (!mapIndex) return;

      var key1 = "t1_score_m" + mapIndex;
      var key2 = "t2_score_m" + mapIndex;

      var orig1 = game[key1];
      var orig2 = game[key2];

      var $i1 = $row.find('[sa-results-input="1"]').first();
      var $i2 = $row.find('[sa-results-input="2"]').first();

      var v1raw = String($i1.val() || "");
      var v2raw = String($i2.val() || "");

      // Treat empty input as "no value" which matches null/undefined in DB
      if (v1raw === "") {
        if (orig1 != null && typeof orig1 !== "undefined") {
          changed = true;
          return false;
        }
      } else {
        var v1 = parseInt(v1raw, 10);
        if (!Number.isFinite(v1)) v1 = 0;
        if (orig1 !== v1) {
          changed = true;
          return false;
        }
      }

      if (v2raw === "") {
        if (orig2 != null && typeof orig2 !== "undefined") {
          changed = true;
          return false;
        }
      } else {
        var v2 = parseInt(v2raw, 10);
        if (!Number.isFinite(v2)) v2 = 0;
        if (orig2 !== v2) {
          changed = true;
          return false;
        }
      }
    });

  return changed;
}

function saResultsHasTooFewCompletedMaps() {
  var game = SA.activeGame;
  if (!game || !game.slug) return false;

  var required = saResultsMinimumCompletedMapsRequired(game.best_of);
  if (required <= 0) return false;

  var $root = SA.$root && SA.$root.length ? SA.$root : $("#streamadmin");
  if (!$root.length) return false;

  var $sec = $root.find(saCFG.sec.results).first();
  if (!$sec.length) return false;

  var complete = 0;

  $sec
    .find('[sa-results-element="map"]')
    .not(".is--template")
    .each(function () {
      var $row = $(this);
      var v1raw = String(
        $row.find('[sa-results-input="1"]').first().val() || ""
      );
      var v2raw = String(
        $row.find('[sa-results-input="2"]').first().val() || ""
      );

      if (v1raw !== "" && v2raw !== "") {
        complete += 1;
      }
    });

  // Wenn noch gar nichts eingetragen ist, nicht warnen
  if (complete === 0) return false;

  return complete < required;
}

function saResultsShouldWarnBeforeUnload() {
  var $root = SA.$root && SA.$root.length ? SA.$root : $("#streamadmin");
  if (!$root.length) return false;

  var $sec = $root.find(saCFG.sec.results).first();
  if (!$sec.length) return false;

  return saResultsHasUnsavedChanges() || saResultsHasTooFewCompletedMaps();
}

// [PAYLOAD BUILDER] ------------------------------------------------------------
function saCollectResultsPayload() {
  var maps = SA.resultsPlayedMaps || [];
  if (!maps.length) return null;

  var $root = SA.$root && SA.$root.length ? SA.$root : $("#streamadmin");
  if (!$root.length) return null;

  var $sec = $root.find(saCFG.sec.results).first();
  if (!$sec.length) return null;

  var scoresByMapIndex = {};

  // 1. Collect individual map scores
  maps.forEach(function (m) {
    var selector =
      '[sa-results-element="map"][data-map-index="' + m.mapIndex + '"]';
    var $row = $sec.find(selector).first();
    if (!$row.length) return;

    var s1 = saReadResultsInput($row.find('[sa-results-input="1"]').first());
    var s2 = saReadResultsInput($row.find('[sa-results-input="2"]').first());

    scoresByMapIndex[m.mapIndex] = { t1: s1, t2: s2 };
  });

  // 2. Read Totals directly from the UI elements
  var $total1El = $sec.find('[sa-results-total="1"]').first();
  var $total2El = $sec.find('[sa-results-total="2"]').first();

  var total1 = parseInt($total1El.text(), 10);
  var total2 = parseInt($total2El.text(), 10);

  // Fallback to 0 if parsing fails
  if (!Number.isFinite(total1)) total1 = 0;
  if (!Number.isFinite(total2)) total2 = 0;

  var payload = {
    t1_score_total: total1,
    t2_score_total: total2,
  };

  // 3. Add Map scores: m1..m7, unused maps -> null
  for (var i = 1; i <= 7; i++) {
    var scores = scoresByMapIndex[i] || null;
    if (scores) {
      payload["t1_score_m" + i] = scores.t1;
      payload["t2_score_m" + i] = scores.t2;
    } else {
      payload["t1_score_m" + i] = null;
      payload["t2_score_m" + i] = null;
    }
  }

  return payload;
}

// SUPABASE WRITE -------------------------------------------------------------
async function saResultsSendToSupabase() {
  if (!AppAuth.supabase) {
    alert("Supabase-Verbindung fehlt. Bitte Seite neu laden.");
    return;
  }

  var game = SA.activeGame;
  if (!game || !game.slug) {
    alert("Kein aktives Spiel ausgewählt.");
    return;
  }

  var payload = saCollectResultsPayload();
  if (!payload) {
    alert("Keine Ergebnisse zum Speichern gefunden.");
    return;
  }

  try {
    var res = await AppAuth.supabase
      .from("games")
      .update(payload)
      .eq("slug", game.slug);

    if (res.error) {
      console.error("[stream-admin] Failed to save results:", res.error);
      alert(
        "Ergebnisse konnten nicht gespeichert werden. Bitte später erneut versuchen."
      );
      return;
    }

    // Mirror new scores into local state
    Object.keys(payload).forEach(function (key) {
      game[key] = payload[key];
    });

    if (Array.isArray(SA.games) && SA.games.length) {
      SA.games = SA.games.map(function (g) {
        if (!g || g.slug !== game.slug) return g;
        return Object.assign({}, g, payload);
      });
    }

    if (SA.gamesBySlug && SA.gamesBySlug[game.slug]) {
      SA.gamesBySlug[game.slug] = Object.assign(
        {},
        SA.gamesBySlug[game.slug],
        payload
      );
    }

    try {
      if (window.__supabasePreload && window.__supabasePreload.games) {
        window.__supabasePreload.games = window.__supabasePreload.games.map(
          function (g) {
            if (!g || g.slug !== game.slug) return g;
            return Object.assign({}, g, payload);
          }
        );
      }
      if (typeof setCached === "function") {
        var cachedGames =
          (window.__supabasePreload && window.__supabasePreload.games) ||
          SA.games;
        setCached(LS_KEYS.games, cachedGames);
      }
    } catch (e) {
      console.warn(
        "[stream-admin] Failed to update cached games after saving results:",
        e
      );
    }

    alert("Ergebnisse wurden gespeichert.");
  } catch (err) {
    console.error("[stream-admin] Error while saving results:", err);
    alert(
      "Ergebnisse konnten nicht gespeichert werden. Bitte später erneut versuchen."
    );
  }
}

// =============================================================================
// CASTER NAMING SECTION
// =============================================================================

function saRenderCastSection() {
  var $root = SA.$root && SA.$root.length ? SA.$root : $("#streamadmin");
  if (!$root.length) return;

  var $sec = $root.find(saCFG.sec.cast).first();
  if (!$sec.length) return;

  var game = SA.activeGame;
  var val1 = "";
  var val2 = "";

  if (game) {
    val1 = game.prod_cast_1_display || "";
    val2 = game.prod_cast_2_display || "";
  }

  var $input1 = $sec.find('[data-cast="1"]').first();
  var $input2 = $sec.find('[data-cast="2"]').first();

  if ($input1.length) $input1.val(val1);
  if ($input2.length) $input2.val(val2);
}

function saWireCastSection() {
  if (SA._wiredCastSection) return;
  SA._wiredCastSection = true;

  $(document).on("click", '[data-cast-button="1"]', async function (e) {
    e.preventDefault();
    await saSaveCastName(1, $(this));
  });

  $(document).on("click", '[data-cast-button="2"]', async function (e) {
    e.preventDefault();
    await saSaveCastName(2, $(this));
  });

  $(document).on("click", '[data-cast-button="swap"]', async function (e) {
    e.preventDefault();
    await saSwapCastNames($(this));
  });
}

async function saSaveCastName(slot, $btn) {
  if (!AppAuth.supabase) {
    alert("Supabase-Verbindung fehlt. Bitte Seite neu laden.");
    return;
  }

  var game = SA.activeGame;
  if (!game || !game.slug) {
    alert("Kein aktives Spiel ausgewählt.");
    return;
  }

  var $root = SA.$root && SA.$root.length ? SA.$root : $("#streamadmin");
  var $sec = $root.find(saCFG.sec.cast).first();
  var $input = $sec.find('[data-cast="' + slot + '"]').first();
  var newValue = String($input.val() || "").trim();

  // Field mapping
  var dbField = slot === 1 ? "prod_cast_1_display" : "prod_cast_2_display";
  var payload = {};
  payload[dbField] = newValue;

  try {
    var res = await AppAuth.supabase
      .from("games")
      .update(payload)
      .eq("slug", game.slug);

    if (res.error) {
      console.error("[stream-admin] Failed to update caster:", res.error);
      alert(
        "Fehler beim Speichern des Casters. Bitte später erneut versuchen."
      );
      return;
    }

    // Success feedback: Button checkmark
    var originalText = $btn.text();
    $btn.text("✅");
    setTimeout(function () {
      $btn.text(originalText);
    }, 3000);

    // Update local state
    game[dbField] = newValue;

    // Update cache arrays
    if (Array.isArray(SA.games)) {
      SA.games = SA.games.map(function (g) {
        if (g.slug === game.slug) {
          g[dbField] = newValue;
        }
        return g;
      });
    }
    if (SA.gamesBySlug && SA.gamesBySlug[game.slug]) {
      SA.gamesBySlug[game.slug][dbField] = newValue;
    }

    // Sync to global cache
    try {
      if (window.__supabasePreload && window.__supabasePreload.games) {
        window.__supabasePreload.games = window.__supabasePreload.games.map(
          function (g) {
            if (g.slug === game.slug) {
              g[dbField] = newValue;
            }
            return g;
          }
        );
      }
      if (typeof setCached === "function") {
        setCached(LS_KEYS.games, SA.games);
      }
    } catch (e) {
      console.warn("[stream-admin] Failed to sync caster update to cache:", e);
    }
  } catch (err) {
    console.error("[stream-admin] Error saving caster:", err);
    alert("Fehler beim Speichern. Bitte konsole prüfen.");
  }
}

async function saSwapCastNames($btn) {
  if (!AppAuth.supabase) {
    alert("Supabase-Verbindung fehlt. Bitte Seite neu laden.");
    return;
  }

  var game = SA.activeGame;
  if (!game || !game.slug) {
    alert("Kein aktives Spiel ausgewählt.");
    return;
  }

  var $root = SA.$root && SA.$root.length ? SA.$root : $("#streamadmin");
  var $sec = $root.find(saCFG.sec.cast).first();

  var $input1 = $sec.find('[data-cast="1"]').first();
  var $input2 = $sec.find('[data-cast="2"]').first();

  var val1 = String($input1.val() || "").trim();
  var val2 = String($input2.val() || "").trim();

  // Swap logic
  var next1 = val2;
  var next2 = val1;

  var payload = {
    prod_cast_1_display: next1,
    prod_cast_2_display: next2,
  };

  try {
    var res = await AppAuth.supabase
      .from("games")
      .update(payload)
      .eq("slug", game.slug);

    if (res.error) {
      console.error("[stream-admin] Failed to swap casters:", res.error);
      alert("Fehler beim Tauschen der Caster. Bitte später erneut versuchen.");
      return;
    }

    // Success feedback
    var originalText = $btn.text();
    $btn.text("✅");
    setTimeout(function () {
      $btn.text(originalText);
    }, 3000);

    // Update DOM
    $input1.val(next1);
    $input2.val(next2);

    // Update local state
    game.prod_cast_1_display = next1;
    game.prod_cast_2_display = next2;

    // Update caches
    if (Array.isArray(SA.games)) {
      SA.games = SA.games.map(function (g) {
        if (g.slug === game.slug) {
          g.prod_cast_1_display = next1;
          g.prod_cast_2_display = next2;
        }
        return g;
      });
    }
    if (SA.gamesBySlug && SA.gamesBySlug[game.slug]) {
      SA.gamesBySlug[game.slug].prod_cast_1_display = next1;
      SA.gamesBySlug[game.slug].prod_cast_2_display = next2;
    }

    try {
      if (window.__supabasePreload && window.__supabasePreload.games) {
        window.__supabasePreload.games = window.__supabasePreload.games.map(
          function (g) {
            if (g.slug === game.slug) {
              g.prod_cast_1_display = next1;
              g.prod_cast_2_display = next2;
            }
            return g;
          }
        );
      }
      if (typeof setCached === "function") {
        setCached(LS_KEYS.games, SA.games);
      }
    } catch (e) {
      console.warn("[stream-admin] Failed to sync caster swap to cache:", e);
    }
  } catch (err) {
    console.error("[stream-admin] Error swapping casters:", err);
    alert("Fehler beim Speichern. Bitte konsole prüfen.");
  }
}

// =============================================================================
// NEWS EDITOR
// =============================================================================

// INTERNAL HELPERS -----------------------------------------------------------

function saNewsGetRoot() {
  var $root = SA.$root && SA.$root.length ? SA.$root : $("#streamadmin");
  if (!$root.length) return $();
  return $root.find(saCFG.sec.news).first();
}

function saNewsEnsureTemplate() {
  if (SA.newsTemplatePrepared) return;

  var $sec = saNewsGetRoot();
  if (!$sec.length) return;

  var $tpl = $sec.find('[sa-news="entry"]').first();
  if (!$tpl.length) return;

  // Mark original as template so we never remove it accidentally
  $tpl.attr("data-news-template", "true").addClass("is--template");

  SA.$newsTemplate = $tpl.clone(false, false);
  SA.$newsTemplate.removeAttr("data-news-template").removeClass("is--template");
  SA.$newsList = $tpl.parent();
  SA.newsTemplatePrepared = true;
}

function saNewsClearRenderedEntries() {
  if (!SA.$newsList || !SA.$newsList.length) return;

  SA.$newsList
    .find('[sa-news="entry"]')
    .filter(function () {
      return $(this).attr("data-news-template") !== "true";
    })
    .remove();
}

function saNewsRenderEmptyState() {
  saNewsEnsureTemplate();
  saNewsClearRenderedEntries();
}

function saNewsBuildPlayersIndex(players) {
  var map = {};
  if (!Array.isArray(players)) return map;

  players.forEach(function (p) {
    if (!p || !p.slug) return;
    map[String(p.slug)] = p;
  });
  return map;
}

async function saNewsEnsurePlayersIndex() {
  if (SA.newsPlayersBySlug && Object.keys(SA.newsPlayersBySlug).length > 0) {
    return;
  }

  var players =
    (window.__supabasePreload && window.__supabasePreload.players) || null;

  if (!players || !Array.isArray(players) || !players.length) {
    try {
      players = await fetchPlayers();
    } catch (err) {
      console.warn("[stream-admin] Failed to fetch players for news:", err);
      players = [];
    }
  }

  SA.newsPlayersBySlug = saNewsBuildPlayersIndex(players || []);
}

function saNewsGetAuthorName(slug) {
  if (!slug) return "";
  var s = String(slug);
  var map = SA.newsPlayersBySlug || {};
  var row = map[s] || null;
  if (row && row.pname) return row.pname;
  return s;
}

function saNewsSortInPlace() {
  if (!Array.isArray(SA.news)) {
    SA.news = [];
    return;
  }
  SA.news.sort(function (a, b) {
    var ao = typeof a.order === "number" ? a.order : 0;
    var bo = typeof b.order === "number" ? b.order : 0;
    return ao - bo;
  });
}

function saNewsRebuildIndex() {
  SA.newsById = indexBy(SA.news || [], "id");
}

function saNewsSyncSharedCache() {
  try {
    var rows = Array.isArray(SA.news) ? SA.news.slice() : [];
    if (!window.__supabasePreload) {
      window.__supabasePreload = {};
    }
    window.__supabasePreload.news = rows;
    if (typeof setCached === "function") {
      setCached(LS_KEYS.news, rows);
    }
  } catch (err) {
    console.warn("[stream-admin] Failed to sync news cache:", err);
  }
}

function saNewsTriggerTickerRefresh() {
  try {
    if (typeof initNewsticker === "function") {
      initNewsticker(false);
    }
  } catch (err) {
    console.warn(
      "[stream-admin] Failed to trigger newsticker after news change:",
      err
    );
  }
}

function saNewsFindUnusedOrderValue() {
  var used = [];
  (SA.news || []).forEach(function (row) {
    if (!row) return;
    if (typeof row.order === "number" && Number.isFinite(row.order)) {
      used.push(row.order);
    }
  });
  var candidate = 0;
  while (used.indexOf(candidate) !== -1 && candidate > -32768) {
    candidate -= 1;
  }
  return candidate;
}

function saNewsFormatMetaLabel(text) {
  return isNonEmpty(text) ? String(text) : "—";
}

function saNewsHasUnsavedChanges() {
  var $sec = saNewsGetRoot();
  if (!$sec.length) return false;

  // New-entry input not empty?
  var $addInput = $sec.find('[sa-news-add="input"]').first();
  if ($addInput.length) {
    var v = String($addInput.val() || "");
    if (isNonEmpty(v)) {
      return true;
    }
  }

  // Any existing entry marked as dirty?
  var hasDirty =
    $sec.find('[sa-news="entry"][data-news-dirty="true"]').length > 0;

  return hasDirty;
}

function saNewsShouldWarnBeforeUnload() {
  return saNewsHasUnsavedChanges();
}

function saNewsOnEntryInput($input) {
  if (!$input || !$input.length) return;

  var $entry = saNewsFindEntryRoot($input);
  if (!$entry.length) return;

  var id = saNewsParseEntryId($entry);
  if (id == null) return;

  var original = "";
  if (SA.newsById && SA.newsById[id]) {
    original = String(SA.newsById[id].newstext || "");
  } else if (Array.isArray(SA.news)) {
    for (var i = 0; i < SA.news.length; i++) {
      var row = SA.news[i];
      if (row && row.id === id) {
        original = String(row.newstext || "");
        break;
      }
    }
  }

  var current = String($input.val() || "");
  var isDirty = current !== original;

  if (isDirty) {
    $entry.attr("data-news-dirty", "true");
  } else {
    $entry.removeAttr("data-news-dirty");
  }

  var $saveBtn = $entry.find('[sa-news-entry="save"]').first();
  if ($saveBtn.length) {
    if (isDirty) {
      $saveBtn.removeClass("is--disabled");
    } else {
      $saveBtn.addClass("is--disabled");
    }
  }
}

// RENDERING ------------------------------------------------------------------

function saNewsRenderList() {
  saNewsEnsureTemplate();
  if (!SA.$newsList || !SA.$newsTemplate) return;

  saNewsClearRenderedEntries();

  var rows = Array.isArray(SA.news) ? SA.news : [];
  if (!rows.length) return;

  rows.forEach(function (row) {
    if (!row) return;

    var $entry = SA.$newsTemplate.clone(false, false);
    $entry.attr("data-news-id", row.id);
    $entry.removeAttr("data-news-dirty");

    var $input = $entry.find('[sa-news-entry="input"]').first();
    if ($input.length) {
      $input.val(row.newstext || "");
    }

    var createdLabel = row.created_at
      ? convertDateTime(row.created_at, "datetime-short")
      : "";
    var editedLabel = row.edited_at
      ? convertDateTime(row.edited_at, "datetime-short")
      : "";

    var createdAuthorName = saNewsGetAuthorName(row.created_author);
    var editedAuthorName = row.edited_author
      ? saNewsGetAuthorName(row.edited_author)
      : "";

    setTextIfExists(
      $entry.find('[sa-news-entry="created-timestamp"]').first(),
      saNewsFormatMetaLabel(createdLabel)
    );
    setTextIfExists(
      $entry.find('[sa-news-entry="created-author"]').first(),
      saNewsFormatMetaLabel(createdAuthorName)
    );
    setTextIfExists(
      $entry.find('[sa-news-entry="edited-timestamp"]').first(),
      saNewsFormatMetaLabel(editedLabel)
    );
    setTextIfExists(
      $entry.find('[sa-news-entry="edited-author"]').first(),
      saNewsFormatMetaLabel(editedAuthorName)
    );

    var $saveBtn = $entry.find('[sa-news-entry="save"]').first();
    if ($saveBtn.length) {
      // No unsaved changes directly after render
      $saveBtn.addClass("is--disabled");
    }

    SA.$newsList.append($entry);
  });
}

// DATA LOAD / RELOAD --------------------------------------------------------

async function saNewsFetchFromBackend() {
  if (!AppAuth.supabase) {
    console.warn(
      "[stream-admin] saNewsFetchFromBackend called without Supabase client"
    );
    return [];
  }

  var res = await AppAuth.supabase
    .from("news")
    .select(
      "id, created_at, newstext, edited_at, order, created_author, edited_author"
    )
    .order("order", { ascending: true });

  if (res.error) {
    console.error("[stream-admin] Failed to load news:", res.error);
    return [];
  }

  return res.data || [];
}

async function saNewsReloadFromBackend() {
  var $sec = saNewsGetRoot();
  if (!$sec.length) return;
  if (!AppAuth.supabase) return;

  try {
    await saNewsEnsurePlayersIndex();
  } catch (err) {
    console.warn(
      "[stream-admin] Player index for news could not be built:",
      err
    );
  }

  try {
    var rows = await saNewsFetchFromBackend();
    SA.news = Array.isArray(rows) ? rows.slice() : [];
    saNewsSortInPlace();
    saNewsRebuildIndex();
    saNewsRenderList();
    saNewsSyncSharedCache();
  } catch (err) {
    console.warn("[stream-admin] Failed to reload news:", err);
    alert("News konnten nicht geladen werden. Bitte später erneut versuchen.");
  }
}

// ACTIONS: SAVE / DELETE / MOVE / ADD ---------------------------------------

function saNewsFindEntryRoot($btn) {
  if (!$btn || !$btn.length) return $();
  return $btn.closest('[sa-news="entry"]');
}

function saNewsParseEntryId($entry) {
  if (!$entry || !$entry.length) return null;
  var idRaw = $entry.attr("data-news-id");
  if (!idRaw) return null;
  var id = Number(idRaw);
  return Number.isFinite(id) ? id : null;
}

async function saNewsSaveEntry($btn) {
  if (!AppAuth.supabase) {
    alert("Supabase-Verbindung fehlt. Bitte Seite neu laden.");
    return;
  }

  var $entry = saNewsFindEntryRoot($btn);
  var id = saNewsParseEntryId($entry);
  if (id == null) return;

  var $input = $entry.find('[sa-news-entry="input"]').first();
  var text = $input.length ? String($input.val() || "") : "";
  if (!isNonEmpty(text)) {
    alert("Bitte gib einen Newstext ein.");
    return;
  }

  var authorSlug = (SA.player && SA.player.slug) || null;
  if (!authorSlug) {
    alert("Autor-Information fehlt. Bitte melde dich erneut an.");
    return;
  }

  var nowIso = new Date().toISOString();

  try {
    var res = await AppAuth.supabase
      .from("news")
      .update({
        newstext: text,
        edited_at: nowIso,
        edited_author: authorSlug,
      })
      .eq("id", id)
      .select()
      .maybeSingle();

    if (res.error) {
      console.error("[stream-admin] Failed to save news entry:", res.error);
      alert(
        "News-Eintrag konnte nicht gespeichert werden. Bitte später erneut versuchen."
      );
      return;
    }

    var updated = res.data || null;
    if (updated) {
      // Update local state
      if (SA.newsById && SA.newsById[id]) {
        SA.newsById[id] = updated;
      }
      SA.news = (SA.news || []).map(function (row) {
        if (!row || row.id !== id) return row;
        return updated;
      });

      saNewsSortInPlace();
      saNewsRebuildIndex();
      saNewsRenderList();
      saNewsSyncSharedCache();
      saNewsTriggerTickerRefresh();
    }

    alert("News-Eintrag wurde gespeichert.");
  } catch (err) {
    console.error("[stream-admin] Error while saving news entry:", err);
    alert(
      "News-Eintrag konnte nicht gespeichert werden. Bitte später erneut versuchen."
    );
  }
}

async function saNewsDeleteEntry($btn) {
  if (!AppAuth.supabase) {
    alert("Supabase-Verbindung fehlt. Bitte Seite neu laden.");
    return;
  }

  var $entry = saNewsFindEntryRoot($btn);
  var id = saNewsParseEntryId($entry);
  if (id == null) return;

  var ok = window.confirm(
    "Diesen Newseintrag endgültig löschen? Dieser Vorgang kann nicht rückgängig gemacht werden."
  );
  if (!ok) return;

  try {
    var res = await AppAuth.supabase.from("news").delete().eq("id", id);

    if (res.error) {
      console.error("[stream-admin] Failed to delete news entry:", res.error);
      alert(
        "News-Eintrag konnte nicht gelöscht werden. Bitte später erneut versuchen."
      );
      return;
    }

    SA.news = (SA.news || []).filter(function (row) {
      return row && row.id !== id;
    });
    saNewsRebuildIndex();
    saNewsRenderList();
    saNewsSyncSharedCache();
    saNewsTriggerTickerRefresh();
  } catch (err) {
    console.error("[stream-admin] Error while deleting news entry:", err);
    alert(
      "News-Eintrag konnte nicht gelöscht werden. Bitte später erneut versuchen."
    );
  }
}

async function saNewsMoveEntry($btn, direction) {
  if (!AppAuth.supabase) {
    alert("Supabase-Verbindung fehlt. Bitte Seite neu laden.");
    return;
  }

  var dir = direction === "up" ? "up" : "down";
  var $entry = saNewsFindEntryRoot($btn);
  var id = saNewsParseEntryId($entry);
  if (id == null) return;

  var list = Array.isArray(SA.news) ? SA.news : [];
  var idx = list.findIndex(function (row) {
    return row && row.id === id;
  });
  if (idx === -1) return;

  var targetIdx = dir === "up" ? idx - 1 : idx + 1;
  if (targetIdx < 0 || targetIdx >= list.length) {
    return;
  }

  var current = list[idx];
  var neighbor = list[targetIdx];
  if (!current || !neighbor) return;

  var orderA = typeof current.order === "number" ? current.order : 0;
  var orderB = typeof neighbor.order === "number" ? neighbor.order : 0;

  if (orderA === orderB) {
    // Just swap locally and normalize by index
    var tmp = current.order;
    current.order = neighbor.order;
    neighbor.order = tmp;
    saNewsSortInPlace();
    saNewsRebuildIndex();
    saNewsRenderList();
    saNewsSyncSharedCache();
    saNewsTriggerTickerRefresh();
    return;
  }

  var tempOrder = saNewsFindUnusedOrderValue();

  try {
    var step1 = await AppAuth.supabase
      .from("news")
      .update({ order: tempOrder })
      .eq("id", current.id);

    if (step1.error) {
      console.error("[stream-admin] Failed to move news (step1):", step1.error);
      return;
    }

    var step2 = await AppAuth.supabase
      .from("news")
      .update({ order: orderA })
      .eq("id", neighbor.id);

    if (step2.error) {
      console.error("[stream-admin] Failed to move news (step2):", step2.error);
      return;
    }

    var step3 = await AppAuth.supabase
      .from("news")
      .update({ order: orderB })
      .eq("id", current.id);

    if (step3.error) {
      console.error("[stream-admin] Failed to move news (step3):", step3.error);
      return;
    }

    current.order = orderB;
    neighbor.order = orderA;

    saNewsSortInPlace();
    saNewsRebuildIndex();
    saNewsRenderList();
    saNewsSyncSharedCache();
    saNewsTriggerTickerRefresh();
  } catch (err) {
    console.error("[stream-admin] Error while moving news entry:", err);
  }
}

async function saNewsAddEntry($btn) {
  if (!AppAuth.supabase) {
    alert("Supabase-Verbindung fehlt. Bitte Seite neu laden.");
    return;
  }

  var $sec = saNewsGetRoot();
  if (!$sec.length) return;

  var $input = $sec.find('[sa-news-add="input"]').first();
  var text = $input.length ? String($input.val() || "") : "";
  if (!isNonEmpty(text)) {
    alert("Bitte gib einen Newstext ein.");
    return;
  }

  var authorSlug = (SA.player && SA.player.slug) || null;
  if (!authorSlug) {
    alert("Autor-Information fehlt. Bitte melde dich erneut an.");
    return;
  }

  var nowIso = new Date().toISOString();
  var maxOrder = 0;
  (SA.news || []).forEach(function (row) {
    if (!row) return;
    if (typeof row.order === "number" && Number.isFinite(row.order)) {
      if (row.order > maxOrder) maxOrder = row.order;
    }
  });
  var newOrder = maxOrder + 1;

  var payload = {
    newstext: text,
    created_at: nowIso,
    edited_at: nowIso,
    created_author: authorSlug,
    edited_author: authorSlug,
    order: newOrder,
  };

  try {
    var res = await AppAuth.supabase
      .from("news")
      .insert(payload)
      .select()
      .maybeSingle();

    if (res.error) {
      console.error("[stream-admin] Failed to add news entry:", res.error);
      alert(
        "News-Eintrag konnte nicht angelegt werden. Bitte später erneut versuchen."
      );
      return;
    }

    var created = res.data || payload;
    SA.news = Array.isArray(SA.news) ? SA.news.slice() : [];
    SA.news.push(created);
    saNewsSortInPlace();
    saNewsRebuildIndex();
    saNewsRenderList();
    saNewsSyncSharedCache();
    saNewsTriggerTickerRefresh();

    if ($input.length) {
      $input.val("");
    }
  } catch (err) {
    console.error("[stream-admin] Error while adding news entry:", err);
    alert(
      "News-Eintrag konnte nicht angelegt werden. Bitte später erneut versuchen."
    );
  }
}

// WIRING ---------------------------------------------------------------------

function saWireNewsSection() {
  if (SA._wiredNewsSection) return;
  SA._wiredNewsSection = true;

  // Refresh button
  $(document).on("click", '[sa-news="refresh"]', async function (e) {
    e.preventDefault();
    await saNewsReloadFromBackend();
    await initNewsticker(false);
  });

  // Add new entry
  $(document).on("click", '[sa-news-add="send"]', async function (e) {
    e.preventDefault();
    await saNewsAddEntry($(this));
  });

  // Save existing entry
  $(document).on("click", '[sa-news-entry="save"]', async function (e) {
    e.preventDefault();
    // Button ist nur bei Änderungen aktiv, aber wir checken trotzdem
    await saNewsSaveEntry($(this));
  });

  // Delete existing entry
  $(document).on("click", '[sa-news-entry="delete"]', async function (e) {
    e.preventDefault();
    await saNewsDeleteEntry($(this));
  });

  // Move up
  $(document).on("click", '[sa-news-entry="up"]', async function (e) {
    e.preventDefault();
    await saNewsMoveEntry($(this), "up");
  });

  // Move down
  $(document).on("click", '[sa-news-entry="down"]', async function (e) {
    e.preventDefault();
    await saNewsMoveEntry($(this), "down");
  });

  // Track unsaved changes for existing entries
  $(document).on("input", '[sa-news-entry="input"]', function () {
    saNewsOnEntryInput($(this));
  });

  // Warn if there are unsaved changes in the news editor
  saRegisterBeforeUnloadGuard(
    "news",
    saNewsShouldWarnBeforeUnload,
    "Es gibt ungespeicherte Änderungen im Newsticker. " +
      "Wenn du die Seite verlässt, gehen diese verloren."
  );
}