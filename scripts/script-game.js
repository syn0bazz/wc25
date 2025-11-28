// =============================================================================
// script-game.js — Game Details Page
// Prereqs: jQuery, base.js, script.js (helpers), anim.js (GSAP helpers)
// =============================================================================

// RUN ON PAGE LOAD ------------------------------------------------------------
$(document).ready(function () {
  if (window.supabaseClient) {
    bootGamePage();
  } else {
    document.addEventListener("supabase:ready", bootGamePage, { once: true });
  }
});

// RUN ON WINDOW RESIZE -------------------------------------------------------
$(window).resize(
  debounce(function () {
    setupMapVoteAnimation();
  }, 250)
);

// =============================================================================
// BOOT
// =============================================================================
async function bootGamePage() {
  try {
    // --- 1) Resolve slug from URL
    const slugRaw = getSlugFromUrl(); // from script.js
    const slug = stripQuotes(slugRaw);

    if (!slug) {
      const ok = window.confirm(
        "Für diese Seite fehlt der Spiel-Slug in der URL.\n\nDu wirst nun zur Ergebnisse-Seite weitergeleitet."
      );
      if (ok) window.location.href = "/ergebnisse";
      return;
    }

    // --- 2) Pull base data
    const [games, teams, players, maps] = await Promise.all([
      fetchGames(),
      fetchTeams(),
      fetchPlayers(),
      fetchMaps(),
    ]);

    const gamesBySlug = indexBy(games || [], "slug");
    const teamsBySlug = indexBy(teams || [], "slug");
    const playersBySlug = indexBy(players || [], "slug");
    const mapsBySlug = indexBy(maps || [], "slug");

    // --- 3) Locate current game
    const game = gamesBySlug[slug];
    if (!game) {
      const ok = window.confirm(
        "Dieses Spiel wurde nicht gefunden (falscher oder veralteter Slug?).\n\nZur Ergebnisse-Seite wechseln?"
      );
      if (ok) window.location.href = "/ergebnisse";
      return;
    }

    // --- 4) Fetch and merge STATS (cached 3h; only stats+scores)
    const statsPatch = await loadGameStats(slug);
    if (statsPatch && typeof statsPatch === "object") {
      Object.assign(game, statsPatch);
    }

    // --- 5) Winner/played detection uses totals (after merge)
    const t1Total = num(game.t1_score_total);
    const t2Total = num(game.t2_score_total);
    const hasBeenPlayed = t1Total !== 0 || t2Total !== 0;

    // --- 6) HERO
    buildHeroSection({
      game,
      t1: teamsBySlug[game.t1_slug] || {},
      t2: teamsBySlug[game.t2_slug] || {},
      playersBySlug,
    });

    // --- 7) Early return if not played
    if (!hasBeenPlayed) return;

    // --- 8) Full page when played
    buildMapGrid({
      game,
      t1: teamsBySlug[game.t1_slug] || {},
      t2: teamsBySlug[game.t2_slug] || {},
      mapsBySlug,
      t1Total,
      t2Total,
    });

    buildVodSection({ game });

    await buildStatsSection({
      game,
      t1: teamsBySlug[game.t1_slug] || {},
      t2: teamsBySlug[game.t2_slug] || {},
      playersBySlug,
      t1Total,
      t2Total,
    });

    await buildMapsVoteSection({
      game,
      t1: teamsBySlug[game.t1_slug] || {},
      t2: teamsBySlug[game.t2_slug] || {},
      mapsBySlug,
    });

    // --- 9) Unhide sections
    $(".page_main").addClass("is--played");
  } catch (err) {
    console.error("[script-game] boot failed:", err);
  }
}

// =============================================================================
// HERO
// =============================================================================
function buildHeroSection({ game, t1, t2, playersBySlug }) {
  const $hero = $("#hero");
  if ($hero.length === 0) return;

  // -- General Game Info
  const $name = $hero.find('[data-base="name"]');
  const $slug = $hero.find('[data-base="slug"]');
  const $datetime = $hero.find('[data-base="datetime"]');

  setTextIfExists($name, game.name || "");
  // keep glitch attribute in sync
  if ($name && $name.length) $name.attr("data-text", game.name || "");
  setTextIfExists($slug, game.slug || "");
  setTextIfExists($datetime, convertDateTime(game.datetime, "datetime"));

  // -- Teams: left/right blocks
  const $team1 = $hero.find('[data-team="1"]');
  const $team2 = $hero.find('[data-team="2"]');

  const t1VM = buildTeamViewModel(t1, playersBySlug); // from script.js/base.js
  const t2VM = buildTeamViewModel(t2, playersBySlug);

  fillHeroTeam($team1, t1VM);
  fillHeroTeam($team2, t2VM);

  // -- Scores & Winner highlight (if available)
  const t1Total = num(game.t1_score_total);
  const t2Total = num(game.t2_score_total);

  setText(
    $hero.find('[data-base="t1_score_total"]'),
    isFiniteNum(t1Total) ? t1Total : ""
  );
  setText(
    $hero.find('[data-base="t2_score_total"]'),
    isFiniteNum(t2Total) ? t2Total : ""
  );

  if (isFiniteNum(t1Total) && isFiniteNum(t2Total)) {
    if (t1Total > t2Total) {
      $team1.addClass("is--highlight");
    } else if (t2Total > t1Total) {
      $team2.addClass("is--highlight");
    }
  }

  // .gameh winner class (only if the game has been played)
  const hasBeenPlayed = t1Total !== 0 || t2Total !== 0;
  if (hasBeenPlayed) {
    const $gameh = $hero.closest(".gameh").length
      ? $hero.closest(".gameh")
      : $(".gameh").first();
    if (t1Total > t2Total) {
      $gameh.removeClass("is--w2").addClass("is--w1");
    } else if (t2Total > t1Total) {
      $gameh.removeClass("is--w1").addClass("is--w2");
    }
  }
}

function fillHeroTeam($el, vm) {
  if (!$el || !$el.length) return;
  // Avatar bg
  const $avatar = $el.find('[data-base="logo-72-flat"]');
  if ($avatar.length) {
    const url = buildAssetUrl("teams", vm.slug, "logo-72-flat");
    // set as background-image to match the HTML structure
    $avatar.css("background-image", url ? 'url("' + url + '")' : "");
  }
  // Texts
  setTextIfExists($el.find('[data-base="tname"]'), vm.tname);
  setTextIfExists($el.find('[data-base="tag"]'), vm.tag);
  setTextIfExists($el.find('[data-base="players"]'), vm.playerLine);
  $el.attr("href", buildTeamUrl(vm.slug));
}

// =============================================================================
// MAP GRID (#hero → .gamemap_grid)
// =============================================================================
function buildMapGrid({ game, t1, t2, mapsBySlug, t1Total, t2Total }) {
  const $grid = $("#mapgrid");
  if ($grid.length === 0) return;

  // Template
  const $template = $grid.find(".gamemap").first();
  if ($template.length === 0) return;

  // Clear & prepare
  $grid.empty();

  const isGF = String(game.slug || "").toLowerCase() === "gf";
  // For BO3: m1=vote_3, m2=vote_4, m3=vote_7 (decider)
  // For GF(BO7): m1=vote_3, m2=vote_4, m3=vote_5, m4=vote_6, m5=vote_7
  const voteOrder = isGF
    ? [game.vote_3, game.vote_4, game.vote_5, game.vote_6, game.vote_7]
    : [game.vote_3, game.vote_4, game.vote_7];

  const overallWinner = t1Total > t2Total ? 1 : t2Total > t1Total ? 2 : 0;

  for (let i = 0; i < voteOrder.length; i++) {
    const mapIndex = i + 1; // 1-based for scores (m1..m5)
    const mapSlug = voteOrder[i];
    const mRow = mapsBySlug[mapSlug] || {};
    const emblemUrl =
      mRow.urlEmblem ||
      (mapSlug ? buildAssetUrl("map", mapSlug, "-emblem") : "");
    const mname = mRow.mname || mapSlug || "";

    const t1MapScore = num(game["t1_score_m" + mapIndex]);
    const t2MapScore = num(game["t2_score_m" + mapIndex]);

    const t1MapScoreHalftime = num(game["t1_score_m" + mapIndex + "_halftime"]);
    const t2MapScoreHalftime = num(game["t2_score_m" + mapIndex + "_halftime"]);

    const $item = $template.clone(true, true);

    // emblem + map name
    if (emblemUrl) {
      setAttrIfExists($item.find('[data-base="emblem"]'), "src", emblemUrl);
      setAttrIfExists($item.find('[data-base="emblem"]'), "alt", mname);
    }
    setTextIfExists($item.find('[data-base="mname"]'), mname);

    // scores (final + halftime)
    setTextIfExists($item.find('[data-base="t1_score_m1"]'), t1MapScore);
    setTextIfExists($item.find('[data-base="t2_score_m1"]'), t2MapScore);
    setTextIfExists(
      $item.find('[data-base="t1_score_m1_halftime"]'),
      t1MapScoreHalftime
    );
    setTextIfExists(
      $item.find('[data-base="t2_score_m1_halftime"]'),
      t2MapScoreHalftime
    );

    // mark maps with no scores yet
    const zeroish = (v) =>
      v == null || v === "" || v === 0 || v === "0" || Number.isNaN(Number(v));
    if (zeroish(t1MapScore) && zeroish(t2MapScore)) {
      $item.addClass("is--notplayed");
    }

    // Determine the map winner
    let mapWinnerTeam = 0;
    if (t1MapScore > t2MapScore) mapWinnerTeam = 1;
    else if (t2MapScore > t1MapScore) mapWinnerTeam = 2;

    const mapWinnerTag =
      mapWinnerTeam === 1
        ? t1.tag || ""
        : mapWinnerTeam === 2
        ? t2.tag || ""
        : "";
    setTextIfExists(
      $item.find('[data-base="determinedMapWinner"]'),
      mapWinnerTag
    );

    // Highlight if this map was won by the overall winner
    if (overallWinner !== 0 && mapWinnerTeam === overallWinner) {
      $item.addClass("is--highlight");
    }

    $grid.append($item);
  }

  // Unhide the map grid once built
  $grid.removeClass("is--hidden");
}

// =============================================================================
// VOD (#vod)
// =============================================================================
function buildVodSection({ game }) {
  const $vod = $("#vod");
  if ($vod.length === 0) return;

  const hasVod = isNonEmpty(game.vod_url);
  if (!hasVod) {
    $vod.addClass("is--hidden");
    return;
  }

  const embed = ytEmbedUrl(game.vod_url); // from script.js
  setAttrIfExists($vod.find('[data-base="vod_url"]'), "src", embed);
  $vod.removeClass("is--hidden");
}

// =============================================================================
// STATS (#stats) — 4 player rows, sorted by HLTV
// =============================================================================
async function buildStatsSection({
  game,
  t1,
  t2,
  playersBySlug,
  t1Total,
  t2Total,
}) {
  const $sect = $("#stats .tabelle_inner");
  if ($sect.length === 0) return;

  const $template = $sect
    .closest("#stats")
    .find(".statrow.statrow-game")
    .first();
  if ($template.length === 0) return;

  // Clear container to rebuild
  $sect.empty();

  // Player meta
  const t1p1 = playersBySlug[(t1 && t1.p1_slug) || ""];
  const t1p2 = playersBySlug[(t1 && t1.p2_slug) || ""];
  const t2p1 = playersBySlug[(t2 && t2.p1_slug) || ""];
  const t2p2 = playersBySlug[(t2 && t2.p2_slug) || ""];

  const rows = [
    buildPlayerRowVM({ teamIdx: 1, pIdx: 1, team: t1, player: t1p1, game }),
    buildPlayerRowVM({ teamIdx: 1, pIdx: 2, team: t1, player: t1p2, game }),
    buildPlayerRowVM({ teamIdx: 2, pIdx: 1, team: t2, player: t2p1, game }),
    buildPlayerRowVM({ teamIdx: 2, pIdx: 2, team: t2, player: t2p2, game }),
  ];

  // Sort by HLTV desc
  rows.sort((a, b) => b.hltv - a.hltv);

  const overallWinner = t1Total > t2Total ? 1 : t2Total > t1Total ? 2 : 0;

  // Render
  rows.forEach((vm) => {
    const $row = $template.clone(true, true);

    // Link to team
    const $link = $row.find('[data-base="link-to-team"]');
    if ($link.length) {
      if (typeof buildTeamUrl === "function")
        $link.attr("href", buildTeamUrl(vm.teamSlug));
      else $link.attr("href", "/team?slug=" + (vm.teamSlug || ""));
    }

    // Avatar (player 60px)
    // Avatar (player 60px)
    const preset = vm.pIdx === 1 ? "p1-60" : "p2-60";
    const avatarUrl = buildAssetUrl(
      "players",
      vm.playerSlug || "",
      preset,
      vm.teamSlug
    );
    setAttrIfExists($row.find('[data-base="p-60"]'), "src", avatarUrl);
    setTextIfExists($row.find('[data-base="pname"]'), vm.pname);
    setTextIfExists($row.find('[data-base="tname"]'), vm.tname);

    // Stats
    setTextIfExists($row.find('[data-base="p_hltv"]'), fixed(vm.hltv, 2));
    setTextIfExists($row.find('[data-base="p_kdr"]'), fixed(vm.kdr, 2));
    setTextIfExists($row.find('[data-base="p_adr"]'), num(vm.adr));
    setTextIfExists($row.find('[data-base="p_headshots"]'), num(vm.headshots));
    setTextIfExists($row.find('[data-base="p_utility"]'), num(vm.utility));
    setTextIfExists($row.find('[data-base="p_entries"]'), num(vm.entries));
    setTextIfExists($row.find('[data-base="p_clutches"]'), num(vm.clutches));

    // Winner highlight
    if (overallWinner && vm.teamIdx === overallWinner) {
      $row.addClass("is--highlight");
    }

    $sect.append($row);
  });

  // Animate statbars
  if (typeof animateStatbars === "function") {
    animateStatbars();
  } else if (typeof animateStatbar === "function") {
    animateStatbar();
  }
}

function buildPlayerRowVM({ teamIdx, pIdx, team, player, game }) {
  const prefix = "t" + teamIdx + "p" + pIdx + "_";
  return {
    teamIdx: teamIdx,
    pIdx: pIdx,
    teamSlug: (team && team.slug) || "",
    tname: (team && team.tname) || "",
    playerSlug: (player && player.slug) || "",
    pname: (player && player.pname) || "",
    hltv: num(game[prefix + "hltv"]),
    kdr: num(game[prefix + "kdr"]),
    adr: num(game[prefix + "adr"]),
    utility: num(game[prefix + "utility"]),
    headshots: num(game[prefix + "headshots"]),
    entries: num(game[prefix + "entries"]),
    clutches: num(game[prefix + "clutches"]),
  };
}

// loadGameStats (cache 3h; stores only stats/scores per game)
async function loadGameStats(slug) {
  const key = `gg:game-stats:${slug}`;
  const TTL_MS = 3 * 60 * 60 * 1000; // 3 hours

  // Try cache first
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const cached = JSON.parse(raw);
      if (
        cached &&
        cached.slug === slug &&
        Date.now() - cached.savedAt < TTL_MS
      ) {
        return cached.data;
      }
    }
  } catch (e) {
    console.warn("[script-game] stats cache read failed:", e);
  }

  // Fetch only the needed columns (stats + per-map scores including halftimes)
  const cols = [
    // totals
    "t1_score_total",
    "t2_score_total",

    // per-map scores
    "t1_score_m1",
    "t1_score_m2",
    "t1_score_m3",
    "t1_score_m4",
    "t1_score_m5",
    "t2_score_m1",
    "t2_score_m2",
    "t2_score_m3",
    "t2_score_m4",
    "t2_score_m5",

    // halftimes
    "t1_score_m1_halftime",
    "t1_score_m2_halftime",
    "t1_score_m3_halftime",
    "t1_score_m4_halftime",
    "t1_score_m5_halftime",
    "t2_score_m1_halftime",
    "t2_score_m2_halftime",
    "t2_score_m3_halftime",
    "t2_score_m4_halftime",
    "t2_score_m5_halftime",

    // player stats (t1p1,t1p2,t2p1,t2p2)
    "t1p1_hltv",
    "t1p1_kdr",
    "t1p1_adr",
    "t1p1_utility",
    "t1p1_headshots",
    "t1p1_entries",
    "t1p1_clutches",
    "t1p2_hltv",
    "t1p2_kdr",
    "t1p2_adr",
    "t1p2_utility",
    "t1p2_headshots",
    "t1p2_entries",
    "t1p2_clutches",
    "t2p1_hltv",
    "t2p1_kdr",
    "t2p1_adr",
    "t2p1_utility",
    "t2p1_headshots",
    "t2p1_entries",
    "t2p1_clutches",
    "t2p2_hltv",
    "t2p2_kdr",
    "t2p2_adr",
    "t2p2_utility",
    "t2p2_headshots",
    "t2p2_entries",
    "t2p2_clutches",
  ].join(",");

  try {
    const { data, error } = await window.supabaseClient
      .from("games")
      .select(cols)
      .eq("slug", slug)
      .maybeSingle();

    if (error) {
      console.warn("[script-game] stats fetch error:", error);
      return null;
    }

    if (data) {
      // Store minimal patch { slug, savedAt, data }
      try {
        localStorage.setItem(
          key,
          JSON.stringify({ slug, savedAt: Date.now(), data })
        );
      } catch (e) {
        console.warn("[script-game] stats cache write failed:", e);
      }
      return data;
    }
  } catch (e) {
    console.warn("[script-game] stats fetch failed:", e);
  }
  return null;
}

// =============================================================================
// MAPS VOTE SECTION (#maps)
// =============================================================================
// Keep tween reference so we can kill/rebuild it (e.g. on resize)
let mapVoteTween = null;

function buildMapsVoteSection({ game, t1, t2, mapsBySlug }) {
  const $section = $("#maps");
  if ($section.length === 0) return;

  const $list = $section.find(".kartenwahl_list");
  const $tpl = $list.find(".kartenwahl").first();
  if ($tpl.length === 0) return;

  // Clear and rebuild
  $list.empty();

  const isGF = String(game.slug || "").toLowerCase() === "gf";

  // Vote sequence, always 7 items present
  const voteSlugs = [
    game.vote_1,
    game.vote_2,
    game.vote_3,
    game.vote_4,
    game.vote_5,
    game.vote_6,
    game.vote_7,
  ];

  // Determine A/B teams per vote_start
  const startSlug = (game.vote_start || "").toLowerCase();
  const aTeam =
    startSlug === (t1.slug || "").toLowerCase()
      ? t1
      : startSlug === (t2.slug || "").toLowerCase()
      ? t2
      : t1;
  const bTeam = aTeam.slug === t1.slug ? t2 : t1;

  // For each vote 1..7 determine action + acting team
  for (let i = 0; i < 7; i++) {
    const idx = i + 1;
    const mapSlug = voteSlugs[i];
    const mRow = mapsBySlug[mapSlug] || {};
    const coverUrl =
      mRow.urlCover || (mapSlug ? buildAssetUrl("map", mapSlug, "-cover") : "");
    const emblemUrl =
      mRow.urlEmblem ||
      (mapSlug ? buildAssetUrl("map", mapSlug, "-emblem") : "");

    const action = voteAction(idx, isGF); // "ban" | "pick" | "decider"
    const actorKey = voteActor(idx, isGF); // "A" | "B" | null
    const actor = actorKey === "A" ? aTeam : actorKey === "B" ? bTeam : null;

    const $row = $tpl.clone(true, true);

    // Tag label (team tag who acted)
    setTextIfExists($row.find('[data-base="tag"]'), actor ? actor.tag : "");

    // Images
    setAttrIfExists($row.find('[data-base="cover"]'), "src", coverUrl);
    setAttrIfExists($row.find('[data-base="emblem"]'), "src", emblemUrl);
    setAttrIfExists(
      $row.find('[data-base="emblem"]'),
      "alt",
      mRow.mname || mapSlug || ""
    );

    // Voting team avatar as background image
    const $avatar = $row.find(".kartenwahl_avatar");
    if ($avatar.length && actor && actor.slug) {
      const logoUrl = buildAssetUrl("teams", actor.slug, "logo-72-flat");
      $avatar.css("background-image", logoUrl ? `url("${logoUrl}")` : "");
    }

    // Mark type on root element
    $row.removeClass("is--ban is--pick is--decider");
    if (action === "ban") $row.addClass("is--ban");
    else if (action === "pick") $row.addClass("is--pick");
    else if (action === "decider") $row.addClass("is--decider");

    $list.append($row);
  }

  // init / re-init animation after DOM is ready
  setupMapVoteAnimation();
}

/**
 * Setup GSAP animation for .kartenwahl cards.
 * Desktop (>768px): vertical (bans DOWN +30, picks/deciders UP -30)
 * Mobile (<=768px): horizontal (bans RIGHT +30, picks/deciders LEFT -30)
 */
function setupMapVoteAnimation() {
  try {
    if (typeof gsap === "undefined" || typeof ScrollTrigger === "undefined") {
      return;
    }

    gsap.registerPlugin(ScrollTrigger);

    const isMobile = window.matchMedia("(max-width: 768px)").matches;

    // Kill previous tween/ScrollTrigger if it exists (e.g. on resize)
    if (mapVoteTween) {
      mapVoteTween.kill();
      mapVoteTween = null;
    }

    // Optional: reset any previous transforms
    gsap.set(".kartenwahl", { x: 0, y: 0 });

    mapVoteTween = gsap.to(".kartenwahl", {
      x: isMobile
        ? (i, el) => (el.classList.contains("is--ban") ? -15 : 15)
        : 0,
      y: !isMobile
        ? (i, el) => (el.classList.contains("is--ban") ? 30 : -30)
        : 0,
      ease: "power1.inOut",
      delay: 0.6,
      duration: 0.4,
      stagger: { each: 0.2, from: "start" }, // left-to-right in DOM order
      scrollTrigger: {
        trigger: "#mapvote",
        start: "top 67%",
        toggleActions: "play reverse play reverse",
      },
    });
  } catch (e) {
    console.warn("[script-game] map vote animation failed:", e);
  }
}

// Decide A/B actor per vote index
function voteActor(idx, isGF) {
  // BO3: 1 A-bans, 2 B-bans, 3 B-picks, 4 A-picks, 5 A-bans, 6 B-bans, 7 Decider
  if (!isGF) {
    if (idx === 1 || idx === 4 || idx === 5) return "A";
    if (idx === 2 || idx === 3 || idx === 6) return "B";
    return null; // 7 = decider
  }
  // BO7 (GF): 1 A-ban, 2 B-ban, 3 B-pick, 4 A-pick, 5 A-pick, 6 B-pick, 7 Decider
  if (idx === 1 || idx === 4 || idx === 5) return "A";
  if (idx === 2 || idx === 3 || idx === 6) return "B";
  return null; // 7 = decider
}

// Decide action per vote index
function voteAction(idx, isGF) {
  if (!isGF) {
    if (idx === 1 || idx === 2 || idx === 5 || idx === 6) return "ban";
    if (idx === 3 || idx === 4) return "pick";
    if (idx === 7) return "decider";
  } else {
    if (idx === 1 || idx === 2) return "ban";
    if (idx === 3 || idx === 4 || idx === 5 || idx === 6) return "pick";
    if (idx === 7) return "decider";
  }
  return null;
}

// =============================================================================
// UTILS
// =============================================================================
function stripQuotes(s) {
  if (s == null) return s;
  const str = String(s).trim();
  if (
    (str.startsWith('"') && str.endsWith('"')) ||
    (str.startsWith("'") && str.endsWith("'"))
  ) {
    return str.substring(1, str.length - 1);
  }
  return str;
}
