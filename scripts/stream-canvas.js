// =============================================================================
// STREAM CANVAS - CONTROLLER
// =============================================================================

// 1. CONFIGURATION & SELECTORS
// -----------------------------------------------------------------------------
const CONFIG = {
  selectors: {
    cards: {
      scores: '[data-card="scores"]',
      stats: '[data-card="stats"]',
      maps: '[data-card="maps"]',
      nextMap: '[data-card="nextmap"]',
    },
    base: {
      team1: '[data-base="t1"]',
      team2: '[data-base="t2"]',
      logo800: '[data-base="logo-800-iso"]',
      logo150: '[data-base="logo-150-flat"]',
      teamBg: '[data-base="teambg"]',
      tname: '[data-base="tname"]',
      tag: '[data-base="tag"]',
      score: '[data-base="score"]',
      wins: '[data-base="wins"]',
      losses: '[data-base="losses"]',
      player1: '[data-base="p1"]',
      player2: '[data-base="p2"]',
      avatar: '[data-base="avatar"]',
      pname: '[data-base="pname"]',
      emblem: '[data-base="emblem"]',
      cover: '[data-base="cover"]',
      coverDark: '[data-base="cover-dark"]',
      mapName: '[data-base="mname"]',
    },
    templates: "#templates",
    swiperContainer: "#swiper", // Renamed from swiperWrapper for clarity
  },
  settings: {
    swiperInterval: 15000,
    get halftimeDelay() {
      return this.swiperInterval / 2;
    },
    statLimits: {
      hltv: 2.0,
      kdr: 2.0,
      adr: 150,
      utility: 10,
      entry: 10,
      clutch: 10,
    },
  },
};

// Global State
let canvasState = {
  activeGame: null,
  t1: null,
  t2: null,
  players: [],
  maps: [],
  teams: [],
};

// 2. INIT & DATA FETCHING
// -----------------------------------------------------------------------------
$(document).ready(function () {
  // Check if Supabase is initialized before running.
  if (window.supabaseClient) {
    initCanvasPage();
  } else {
    document.addEventListener("supabase:ready", () => initCanvasPage(), {
      once: true,
    });
  }
});

async function initCanvasPage() {
  console.log("[StreamCanvas] Initializing...");

  try {
    // 1. Get Static Data (Cached via base.js)
    const [allTeams, allPlayers, allMaps] = await Promise.all([
      fetchTeams(),
      fetchPlayers(),
      fetchMaps(),
    ]);

    canvasState.teams = allTeams;
    canvasState.players = allPlayers;
    canvasState.maps = allMaps;

    // 2. Get Live Game Data (Force Refresh)
    const allGames = await window.ensureGamesPreloaded(true);

    // Filter for the active game
    const activeGame = allGames.find((g) => g.active === true);

    if (!activeGame) {
      console.warn("[StreamCanvas] No active game found.");
      return;
    }

    canvasState.activeGame = decorateGameTotals(activeGame); // helper from script.js

    // Resolve Team Objects
    canvasState.t1 = allTeams.find((t) => t.slug === activeGame.t1_slug);
    canvasState.t2 = allTeams.find((t) => t.slug === activeGame.t2_slug);

    if (!canvasState.t1 || !canvasState.t2) {
      console.error("[StreamCanvas] Could not resolve teams for active game.");
      return;
    }

    console.log("[StreamCanvas] Data loaded for:", activeGame.slug);

    // 3. Build Interface
    renderScoresCard();
    renderStatsCard();
    renderMapsCard();
    renderNextMapCard();

    // 4. Init Swiper
    initCanvasSwiper();
  } catch (error) {
    console.error("[StreamCanvas] Init failed:", error);
  }
}

// 3. RENDER FUNCTIONS
// -----------------------------------------------------------------------------

/**
 * Builds the "Scores" card
 */
function renderScoresCard() {
  const $card = $(CONFIG.selectors.cards.scores);
  const game = canvasState.activeGame;
  const { t1, t2 } = canvasState;

  // Helper to fill basic team data inside a specific wrapper
  const fillTeam = ($wrapper, team, score) => {
    $wrapper
      .find(CONFIG.selectors.base.logo800)
      .attr("src", buildAssetUrl("teams", team.slug, "logo-800-iso"))
      .removeAttr("srcset");
    $wrapper
      .find(CONFIG.selectors.base.teamBg)
      .attr("src", buildAssetUrl("teams", team.slug, "teambg"))
      .removeAttr("srcset");
    setTextIfExists($wrapper.find(CONFIG.selectors.base.tname), team.tname);
    setTextIfExists($wrapper.find(CONFIG.selectors.base.score), score);
  };

  // Fill T1
  const $t1Wrapper = $card.find(CONFIG.selectors.base.team1);
  fillTeam($t1Wrapper, t1, game.t1_total);

  // Fill T2
  const $t2Wrapper = $card.find(CONFIG.selectors.base.team2);
  fillTeam($t2Wrapper, t2, game.t2_total);

  // Determine Leader
  $t1Wrapper.removeClass("is--lead");
  $t2Wrapper.removeClass("is--lead");

  if (game.t1_total > game.t2_total) {
    $t1Wrapper.addClass("is--lead");
  } else if (game.t2_total > game.t1_total) {
    $t2Wrapper.addClass("is--lead");
  }
}

/**
 * Builds the "Stats" card.
 * Creates a duplicate card for Team 2 so we have one card per team.
 */
function renderStatsCard() {
  const $template = $(CONFIG.selectors.cards.stats);
  const { t1, t2 } = canvasState;

  // Function to populate a stats card for a specific team
  const populateStats = ($card, team) => {
    // Basic Team Info
    setTextIfExists($card.find(CONFIG.selectors.base.tag), team.tag);
    $card
      .find(CONFIG.selectors.base.teamBg)
      .attr("src", buildAssetUrl("teams", team.slug, "teambg"))
      .removeAttr("srcset");

    // Players
    const p1 = canvasState.players.find((p) => p.slug === team.p1_slug);
    const p2 = canvasState.players.find((p) => p.slug === team.p2_slug);

    // Fill Player Basics
    [p1, p2].forEach((p, idx) => {
      if (!p) return;
      const pSelector =
        idx === 0
          ? CONFIG.selectors.base.player1
          : CONFIG.selectors.base.player2;
      const $pWrap = $card.find(pSelector);

      $pWrap
        .find(CONFIG.selectors.base.avatar)
        .attr(
          "src",
          buildAssetUrl(
            "players",
            p.slug,
            idx === 0 ? "p1-800" : "p2-800",
            team.slug
          )
        )
        .removeAttr("srcset");
      setTextIfExists($pWrap.find(CONFIG.selectors.base.pname), p.pname);
    });

    // Fill Stats
    const statsMap = [
      { key: "stat_hltv", label: "hltv", max: CONFIG.settings.statLimits.hltv },
      { key: "stat_kdr", label: "kdr", max: CONFIG.settings.statLimits.kdr },
      { key: "stat_adr", label: "adr", max: CONFIG.settings.statLimits.adr },
      {
        key: "stat_utility",
        label: "utility",
        max: CONFIG.settings.statLimits.utility,
      },
      {
        key: "stat_entry",
        label: "entry",
        max: CONFIG.settings.statLimits.entry,
      },
      {
        key: "stat_clutch",
        label: "clutch",
        max: CONFIG.settings.statLimits.clutch,
      },
    ];

    statsMap.forEach((stat) => {
      // P1
      if (p1) updateStatBar($card, "p1", stat, p1[stat.key]);
      // P2
      if (p2) updateStatBar($card, "p2", stat, p2[stat.key]);
    });
  };

  // Process T1 (Original Card)
  populateStats($template, t1);

  // Process T2 (Cloned Card)
  const $t2Card = $template.clone();
  populateStats($t2Card, t2);

  // Insert T2 card after T1 card in templates (will be moved to swiper later)
  $template.after($t2Card);
}

/**
 * Builds the "Maps" card.
 * Handles BO1, BO3, BO5, BO7 logic and rendering.
 */
function renderMapsCard() {
  const $template = $(CONFIG.selectors.cards.maps);
  const game = canvasState.activeGame;
  const { t1, t2 } = canvasState;
  const bestOf = game.best_of || 3;

  // 1. Fill Header Logos
  const fillHeaderLogos = ($c) => {
    const setLogo = (base, slug) => {
      $c.find(`[data-base="${base}"]`)
        .attr("src", buildAssetUrl("teams", slug, "logo-150-flat"))
        .removeAttr("srcset");
      $c.find(`[data-base="${base.replace("150-flat", "800-iso")}"]`)
        .attr("src", buildAssetUrl("teams", slug, "logo-800-iso"))
        .removeAttr("srcset");
    };
    setLogo("t1_logo-150-flat", t1.slug);
    setLogo("t2_logo-150-flat", t2.slug);
  };

  fillHeaderLogos($template);

  // 2. Prepare Structure (Clone/Delete based on BO)
  let cardsToRender = [$template];

  if (bestOf === 1) {
    $template.find('[data-base="m2"], [data-base="m3"]').remove();
  } else if (bestOf === 5) {
    const $card2 = $template.clone();
    $card2.find('[data-base="m3"]').remove(); // Remove 3rd slot of 2nd card (total 5)
    // Renumber attributes for logic
    $card2.find('[data-base="m1"]').attr("data-base", "m4");
    $card2.find('[data-base="m2"]').attr("data-base", "m5");
    cardsToRender.push($card2);
  } else if (bestOf === 7) {
    const $card2 = $template.clone();
    const $card3 = $template.clone();
    $card2.find('[data-base="m3"]').remove();
    $card3.find('[data-base="m3"]').remove();

    $card2.find('[data-base="m1"]').attr("data-base", "m4");
    $card2.find('[data-base="m2"]').attr("data-base", "m5");
    $card3.find('[data-base="m1"]').attr("data-base", "m6");
    $card3.find('[data-base="m2"]').attr("data-base", "m7");

    cardsToRender.push($card2, $card3);
  }
  // BO3 is default (keep m1, m2, m3)

  // 3. Determine Map Veto/Pick Logic
  // Returns array: [{ mapSlot: 'vote_X', picker: 't1'|'t2'|'dec' }, ...]
  const mapOrder = getMapPickOrder(bestOf, game.vote_start, t1.slug);

  // 4. Fill Data
  cardsToRender.forEach(($card) => {
    // For each map slot in this card
    $card.find(".cgmaps_map").each(function () {
      const $slot = $(this);
      const slotId = $slot.attr("data-base"); // m1, m2, etc.
      const mapIndex = parseInt(slotId.replace("m", "")) - 1; // 0-based

      const config = mapOrder[mapIndex];
      if (!config) return; // Should not happen if logic is correct

      // Get map slug from game data (e.g. game.vote_3)
      const mapSlug = game[config.mapSlot];
      if (!mapSlug) return;

      const mapData = canvasState.maps.find((m) => m.slug === mapSlug);

      // Set Attributes
      $slot.attr("data-map", mapSlug);
      $slot.attr("data-pick", config.picker);

      // Fill Visuals
      if (mapData) {
        $slot
          .find(CONFIG.selectors.base.emblem)
          .attr("src", mapData.urlEmblem)
          .removeAttr("srcset");
        $slot
          .find(CONFIG.selectors.base.cover)
          .attr("src", mapData.urlCover)
          .removeAttr("srcset");
        $slot
          .find(CONFIG.selectors.base.coverDark)
          .attr("src", buildAssetUrl("map", mapSlug, "-cover-dark"))
          .removeAttr("srcset");
        setTextIfExists(
          $slot.find(CONFIG.selectors.base.mapName),
          mapData.mname
        );
      }

      // Set Picker Logo
      let pickerSlug = null;
      if (config.picker === "t1") pickerSlug = t1.slug;
      if (config.picker === "t2") pickerSlug = t2.slug;

      if (pickerSlug) {
        $slot
          .find(CONFIG.selectors.base.logo800)
          .attr("src", buildAssetUrl("teams", pickerSlug, "logo-800-iso"))
          .removeAttr("srcset")
          .show();
      } else {
        $slot.find(CONFIG.selectors.base.logo800).hide();
      }

      // Scores & States
      const s1 = game[`t1_score_${slotId}`];
      const s2 = game[`t2_score_${slotId}`];

      const $s1El = $slot.find('[data-base="t1_score"]');
      const $s2El = $slot.find('[data-base="t2_score"]');

      setTextIfExists($s1El, s1);
      setTextIfExists($s2El, s2);

      $s1El.removeClass("is--won");
      $s2El.removeClass("is--won");
      $slot.removeClass("is--played");

      // Check if played
      const isValidScore = (s) =>
        s !== null && s !== undefined && parseInt(s) > 0;

      if (isValidScore(s1) || isValidScore(s2)) {
        $slot.addClass("is--played");
        if (parseInt(s1) > parseInt(s2)) $s1El.addClass("is--won");
        if (parseInt(s2) > parseInt(s1)) $s2El.addClass("is--won");
      }
    });

    // If we created extra cards, append them
    if ($card !== $template) {
      $template.after($card);
    }
  });
}

/**
 * Builds the "Next Map" card.
 * Includes logic to REMOVE the card if the match is decided.
 */
function renderNextMapCard() {
  const $card = $(CONFIG.selectors.cards.nextMap);
  const game = canvasState.activeGame;
  const { t1, t2, maps } = canvasState;
  const bestOf = game.best_of || 3;

  // --- NEW LOGIC START ---

  // 1. Check if the Match is Over
  // BO1 needs 1 win, BO3 needs 2, BO5 needs 3, BO7 needs 4.
  const winsNeeded = Math.ceil(bestOf / 2);

  if (game.t1_total >= winsNeeded || game.t2_total >= winsNeeded) {
    console.log("[StreamCanvas] Match decided. Removing Next Map card.");
    $card.remove(); // Remove from DOM so Swiper logic doesn't pick it up
    return;
  }

  // --- NEW LOGIC END ---

  // 2. Find Next Map
  let nextMapId = null;
  let nextMapSlug = null;

  for (let i = 1; i <= bestOf; i++) {
    const s1 = game[`t1_score_m${i}`];
    const s2 = game[`t2_score_m${i}`];

    // Logic: If scores are 0-0 or null/undefined, this is the upcoming map
    if ((!s1 && !s2) || (parseInt(s1) === 0 && parseInt(s2) === 0)) {
      const mapOrder = getMapPickOrder(bestOf, game.vote_start, t1.slug);
      const config = mapOrder[i - 1];
      if (config) {
        nextMapSlug = game[config.mapSlot];
        nextMapId = i;
        break;
      }
    }
  }

  // If we couldn't find a next map (e.g., all maps played but data hasn't updated total score yet),
  // remove the card to be safe.
  if (!nextMapSlug) {
    $card.remove();
    return;
  }

  const mapData = maps.find((m) => m.slug === nextMapSlug);

  // 3. Fill Map Visuals
  $card
    .find(CONFIG.selectors.base.emblem)
    .attr("src", mapData?.urlEmblem || "")
    .removeAttr("srcset");
  $card
    .find(CONFIG.selectors.base.cover)
    .attr("src", mapData?.urlCover || "")
    .removeAttr("srcset");

  // 4. Fill Team Details
  const fillTeamNext = ($wrapper, team) => {
    $wrapper
      .find(CONFIG.selectors.base.logo150)
      .attr("src", buildAssetUrl("teams", team.slug, "logo-150-flat"))
      .removeAttr("srcset");
    setTextIfExists($wrapper.find(CONFIG.selectors.base.tname), team.tname);

    // Win/Loss records on this specific map (mid)
    const mid = mapData?.mid;
    if (mid) {
      const wins = team[`m${mid}_wins`] || 0;
      const losses = team[`m${mid}_losses`] || 0;
      setTextIfExists($wrapper.find(CONFIG.selectors.base.wins), wins);
      setTextIfExists($wrapper.find(CONFIG.selectors.base.losses), losses);
    }
  };

  fillTeamNext($card.find(CONFIG.selectors.base.team1), t1);
  fillTeamNext($card.find(CONFIG.selectors.base.team2), t2);
}

// 4. SWIPER LOGIC
// -----------------------------------------------------------------------------
function initCanvasSwiper() {
  const $templates = $(CONFIG.selectors.templates);
  const $swiperContainer = $(CONFIG.selectors.swiperContainer);

  // FIX: Ensure swiper-wrapper exists.
  // Swiper requires Container > Wrapper > Slides
  let $swiperWrapper = $swiperContainer.find(".swiper-wrapper");

  if ($swiperWrapper.length === 0) {
    // Create wrapper if missing and append it to container
    $swiperWrapper = $('<div class="swiper-wrapper"></div>');
    $swiperContainer.append($swiperWrapper);
  }

  // Move or copy all cards from templates to swiper wrapper
  $templates.children(".cg_card").each(function () {
    // $(this).addClass("swiper-slide").appendTo($swiperWrapper); // move
    $(this).clone().addClass("swiper-slide").appendTo($swiperWrapper); // copy
  });

  // Init Swiper on the container ID (not the wrapper)
  const swiper = new Swiper(CONFIG.selectors.swiperContainer, {
    loop: true,
    speed: 1200,
    effect: "fade",
    fadeEffect: {
      crossFade: true,
    },
    autoplay: {
      delay: CONFIG.settings.swiperInterval,
      disableOnInteraction: false,
    },
    allowTouchMove: false,
    on: {
      slideChangeTransitionEnd: function () {
        handleSlideChange(this);
      },
    },
  });

  // Trigger initial check
  handleSlideChange(swiper);
}

function handleSlideChange(swiper) {
  const activeSlide = swiper.slides[swiper.activeIndex];
  const $slide = $(activeSlide);

  // Halftime Effect for Stats Cards
  if ($slide.attr("data-card") === "stats") {
    setTimeout(() => {
      // Check if still active slide to prevent race conditions
      if ($(swiper.slides[swiper.activeIndex]).is($slide)) {
        $slide.addClass("is--halftime");
      }
    }, CONFIG.settings.halftimeDelay);
  } else {
    // Reset all stats cards
    $('.swiper-slide[data-card="stats"]').removeClass("is--halftime");
  }
}

// 5. HELPER FUNCTIONS
// -----------------------------------------------------------------------------

/**
 * Updates a specific stat bar width and value text.
 */
function updateStatBar($context, playerPrefix, statObj, value) {
  const val = parseFloat(value) || 0;
  const selectorVal = `[data-base="${playerPrefix}_stat_${statObj.label}"]`;
  const selectorBar = `[data-base="${playerPrefix}_stat_${statObj.label}_bar"]`;

  // Set Text
  setTextIfExists($context.find(selectorVal), val);

  // Calculate Width
  // Min 12%, Max 100%. Range is 88%.
  let percentage = (val / statObj.max) * 88;
  if (percentage > 88) percentage = 88;
  if (percentage < 0) percentage = 0;

  const finalWidth = 12 + percentage;

  $context.find(selectorBar).css("width", `${finalWidth}%`);
}

/**
 * Determines Map Order and Pickers based on BO format and Vote Start.
 * Returns Array of objects { mapSlot: 'vote_X', picker: 't1'|'t2'|'dec' }
 */
function getMapPickOrder(bestOf, voteStartTeamSlug, t1Slug) {
  const isStartT1 = voteStartTeamSlug === t1Slug;

  const s = isStartT1 ? "t1" : "t2"; // Starter
  const ns = isStartT1 ? "t2" : "t1"; // Non-Starter
  const dec = "dec";

  if (bestOf === 1) {
    return [{ mapSlot: "vote_7", picker: dec }];
  }

  if (bestOf === 3) {
    return [
      { mapSlot: "vote_3", picker: ns },
      { mapSlot: "vote_4", picker: s },
      { mapSlot: "vote_7", picker: dec },
    ];
  }

  if (bestOf === 5) {
    return [
      { mapSlot: "vote_3", picker: ns },
      { mapSlot: "vote_4", picker: s },
      { mapSlot: "vote_5", picker: s },
      { mapSlot: "vote_6", picker: ns },
      { mapSlot: "vote_7", picker: dec },
    ];
  }

  if (bestOf === 7) {
    return [
      { mapSlot: "vote_1", picker: s },
      { mapSlot: "vote_2", picker: ns },
      { mapSlot: "vote_3", picker: ns },
      { mapSlot: "vote_4", picker: s },
      { mapSlot: "vote_5", picker: s },
      { mapSlot: "vote_6", picker: ns },
      { mapSlot: "vote_7", picker: dec },
    ];
  }

  return [];
}
