// =============================================================================
// [PAGE ESSENTIALS]
// =============================================================================

// RUN ON PAGE LOAD ------------------------------------------------------------
$(document).ready(function () {
  // Initialize wheel + button
  kwRandomizerInit();

  // Ensure page wrap starts in "zg" or "mv" state
  kwRandomizerSetViewState("zg");

  // Load active game from database and apply team assets
  kwRandomizerInitFromDatabase();

  // Initialize mapvote UI (team logos, selector, slots) from database
  mvInitFromDatabase();

  // Initialize auth lifecycle (from script-auth.js) and warn if not signed in
  // so that the user knows they cannot persist the final vote.
  mvInitAuthGuard();
});

// RUN ON WINDOW RESIZE --------------------------------------------------------
$(window).resize(
  debounce(function () {
    // reserved for future layout-dependent adjustments
  }, 250)
);

// RUN ON SCROLL ---------------------------------------------------------------
$(window).scroll(
  debounce(function () {
    // reserved for future scroll-dependent effects
  }, 100)
);

// =============================================================================
// [RANDOM STARTING TEAM GENERATOR]
// =============================================================================

// VARIABLES -------------------------------------------------------------------
var kwRandomizerConfig = {
  sectionsPerTeam: 6, // number of sections per team (total sections = sectionsPerTeam * 2)
  minSpinSeconds: 4,
  maxSpinSeconds: 8,
  wheelOutlineWidth: 44,
  wheelSizeVW: 120, // wheel size: 120vw x 120vw
  sliceRadiusPercent: 100, // >50 so slices extend beyond the wheel edge
  gradients: {
    team1:
      "linear-gradient(90deg, var(--Violett--Hell, #C271B5) 0%, var(--Violett--Hell, #C271B5) 100%)",
    team2:
      "linear-gradient(90deg, var(--Blau--Hell, #6196C2) 0%, var(--Blau--Hell, #6196C2) 100%)",
    outline: "var(--Blau-Hintergrund, #212B34)",
  },
  selectors: {
    wrap: '[kw-randomizer="wrap"]',
    wheel: '[kw-randomizer="wheel"]',
    button: '[kw-randomizer="button"]',
    logo1: '[kw-randomizer="logo-1"]',
    logo2: '[kw-randomizer="logo-2"]',
    teambg1: '[kw-randomizer="teambg-1"]',
    teambg2: '[kw-randomizer="teambg-2"]',
    pageWrap: "#wrap",
  },
  localStorageKey: "stream_mapvote_start",
  buttonLabelInitial: "Starte Zufallsgenerator",
  buttonLabelAfterSpin: "Starte Kartenwahl",
};

var kwRandomizerState = {
  $wrap: null,
  $wheel: null,
  $wheelInner: null,
  $button: null,
  slices: [],
  totalSections: 0,
  currentRotation: 0,
  activeIndex: null,
  currentTeam: 0,
  isSpinning: false,
  hasSpunOnce: false,
  animationFrameId: null,
};

// [INITIALIZATION] ------------------------------------------------------------
function kwRandomizerInit() {
  var cfg = kwRandomizerConfig;
  var st = kwRandomizerState;

  st.$wrap = $(cfg.selectors.wrap).first();
  if (!st.$wrap.length) return;

  st.$wheel = st.$wrap.find(cfg.selectors.wheel).first();
  st.$button = st.$wrap.find(cfg.selectors.button).first();

  if (!st.$wheel.length || !st.$button.length) return;

  // Ensure initial button label
  if (cfg.buttonLabelInitial) {
    st.$button.text(cfg.buttonLabelInitial);
  }

  var wheelSize = String(cfg.wheelSizeVW || 120) + "vw";

  // basic wheel styling (size + outline + background)
  st.$wheel.css({
    width: wheelSize,
    // height: wheelSize,
    borderWidth: cfg.wheelOutlineWidth + "px",
    borderStyle: "solid",
    borderColor: cfg.gradients.outline,
    borderRadius: "9999px",
    position: "relative",
    overflow: "hidden",
    margin: "0 auto",
    boxSizing: "border-box",
    backgroundColor: cfg.gradients.outline,
  });

  kwRandomizerBuildWheel();
  kwRandomizerBindButton();
}

// [VIEW STATE HELPER] ---------------------------------------------------------
/**
 * Switch the outer page wrapper between "Zufallsgenerator" and "Kartenwahl".
 *
 * @param {"zg"|"mv"} [targetState] - if omitted, toggle between the two states
 */
function kwRandomizerSetViewState(targetState) {
  var cfg = kwRandomizerConfig || {};
  var selector =
    (cfg.selectors && cfg.selectors.pageWrap) || cfg.selectors.wrap || "#wrap";

  var $wrap = $(selector).first();
  if (!$wrap.length) return;

  var state = targetState;
  if (!state) {
    var isZG = $wrap.hasClass("is--zg");
    var isMV = $wrap.hasClass("is--mv");
    if (isZG && !isMV) {
      state = "mv";
    } else if (isMV && !isZG) {
      state = "zg";
    } else {
      state = "zg";
    }
  }

  if (state === "zg") {
    $wrap.removeClass("is--mv").addClass("is--zg");
  } else if (state === "mv") {
    $wrap.removeClass("is--zg").addClass("is--mv");

    // When switching into mapvote, ensure the starting team matches
    // the randomizer result stored in localStorage.
    if (typeof mvReinitVotingFromRandomizerIfIdle === "function") {
      mvReinitVotingFromRandomizerIfIdle();
    }

    // After rebuilding the vote from randomizer, reflect it in the skeleton UI
    if (typeof mvBuildSkeletonFromVote === "function") {
      mvBuildSkeletonFromVote();
    }
  }
}

// [DATA BINDING FROM DATABASE] -----------------------------------------------
/**
 * Initialize team logos and backgrounds from the active game in "games".
 * Uses the cached/preloaded games from base.js (localStorage-backed).
 */
async function kwRandomizerInitFromDatabase() {
  if (typeof fetchGames !== "function" || typeof buildAssetUrl !== "function") {
    console.warn(
      "[kwRandomizer] fetchGames or buildAssetUrl not available; skipping DB binding."
    );
    return;
  }

  var games;
  try {
    games = await fetchGames();
  } catch (err) {
    console.warn("[kwRandomizer] fetchGames threw:", err);
    return;
  }

  if (!Array.isArray(games) || games.length === 0) {
    console.warn("[kwRandomizer] No games available for randomizer.");
    return;
  }

  var activeGame =
    games.find(function (g) {
      return kwRandomizerIsActiveGame(g);
    }) || null;

  if (!activeGame) {
    console.warn("[kwRandomizer] No active game found for randomizer.");
    return;
  }

  kwRandomizerApplyTeamAssetsFromGame(activeGame);
}

/**
 * Determine if a game row should be treated as "active".
 */
function kwRandomizerIsActiveGame(game) {
  if (!game) return false;
  var v = game.active;
  return v === true || v === 1 || v === "1" || v === "true";
}

/**
 * Safely set a new image URL and remove responsive attributes that would
 * otherwise override the explicit src value.
 */
function kwRandomizerSetImageSource($img, url) {
  if (!$img || !$img.length || !url) return;
  $img.attr("src", url);
  // Remove responsive attributes so the browser does not override src
  $img.removeAttr("srcset");
  $img.removeAttr("sizes");
}

/**
 * Apply team logos and backgrounds to the randomizer UI based on a game row.
 *
 * @param {object} game - game row from "games" (expects t1_slug, t2_slug)
 */
function kwRandomizerApplyTeamAssetsFromGame(game) {
  if (!game) return;

  var cfg = kwRandomizerConfig;

  var t1Slug = (game.t1_slug || "").toLowerCase();
  var t2Slug = (game.t2_slug || "").toLowerCase();

  if (!t1Slug || !t2Slug) {
    console.warn(
      "[kwRandomizer] Active game missing team slugs for randomizer:",
      game
    );
    return;
  }

  if (typeof buildAssetUrl !== "function") {
    console.warn("[kwRandomizer] buildAssetUrl is not available.");
    return;
  }

  var logo1Url = buildAssetUrl("teams", t1Slug, "logo-800-iso");
  var logo2Url = buildAssetUrl("teams", t2Slug, "logo-800-iso");
  var bg1Url = buildAssetUrl("teams", t1Slug, "teambg");
  var bg2Url = buildAssetUrl("teams", t2Slug, "teambg");

  var $logo1 = $(cfg.selectors.logo1).first();
  var $logo2 = $(cfg.selectors.logo2).first();
  var $bg1 = $(cfg.selectors.teambg1).first();
  var $bg2 = $(cfg.selectors.teambg2).first();

  kwRandomizerSetImageSource($logo1, logo1Url);
  kwRandomizerSetImageSource($logo2, logo2Url);
  kwRandomizerSetImageSource($bg1, bg1Url);
  kwRandomizerSetImageSource($bg2, bg2Url);
}

// [WHEEL BUILD] ---------------------------------------------------------------
// All slices:
// - share the same radius (sliceRadiusPercent)
// - share the same angular width (sliceAngle)
// - start in the exact center (50%/50%)
// - extend slightly beyond the circle edge and are cropped by overflow: hidden
function kwRandomizerBuildWheel() {
  var cfg = kwRandomizerConfig;
  var st = kwRandomizerState;

  st.$wheel.empty();
  st.slices = [];
  st.totalSections = cfg.sectionsPerTeam * 2;

  if (!st.totalSections || st.totalSections <= 0) return;

  var $inner = $('<div class="kw-wheel-inner"></div>');
  $inner.css({
    width: "100%",
    height: "100%",
    position: "absolute",
    left: 0,
    top: 0,
    borderRadius: "9999px",
    transformOrigin: "50% 50%",
  });

  st.$wheelInner = $inner;
  st.$wheel.append($inner);

  var sliceAngle = 360 / st.totalSections;
  var radius = cfg.sliceRadiusPercent || 60; // in % of box, >50 so it goes beyond the circle

  for (var i = 0; i < st.totalSections; i++) {
    var team = i % 2 === 0 ? 2 : 1;

    // angles for this slice (start/end), 0° = right, -90° = top
    var angleStart = -90 + i * sliceAngle;
    var angleEnd = angleStart + sliceAngle;

    var radStart = (angleStart * Math.PI) / 180;
    var radEnd = (angleEnd * Math.PI) / 180;

    // points on a *virtual* circle with radius "radius"
    // all slices use the exact same radius => same length
    var x1 = 50 + radius * Math.cos(radStart);
    var y1 = 50 + radius * Math.sin(radStart);
    var x2 = 50 + radius * Math.cos(radEnd);
    var y2 = 50 + radius * Math.sin(radEnd);

    var clipPathVal =
      "polygon(50% 50%, " +
      x1.toFixed(4) +
      "% " +
      y1.toFixed(4) +
      "%, " +
      x2.toFixed(4) +
      "% " +
      y2.toFixed(4) +
      "%)";

    var $slice = $('<div class="kw-slice kw-slice--team' + team + '"></div>');
    $slice.attr("data-team", String(team));
    $slice.attr("data-index", String(i));

    // IMPORTANT:
    // - width/height are exactly 100% so the clipPath coordinates (0–100%)
    //   match the actual box
    // - all slices are identical except for clipPath and background
    $slice.css({
      position: "absolute",
      width: "100%",
      height: "100%",
      left: 0,
      top: 0,
      clipPath: clipPathVal,
      backgroundImage: team === 1 ? cfg.gradients.team1 : cfg.gradients.team2,
    });

    st.slices.push({
      $el: $slice,
      team: team,
      index: i,
      angleStart: angleStart,
      angleEnd: angleEnd,
    });

    $inner.append($slice);
  }

  // starting position: pointer at top exactly on a boundary between two slices
  st.currentRotation = 0;
  st.$wheelInner.css("transform", "rotate(0deg) scale(1.5)");

  st.activeIndex = null;
  st.currentTeam = 0;
  st.$wrap.attr("kw-randomizer-current", "0");
}

// [BUTTON BINDING] ------------------------------------------------------------
function kwRandomizerBindButton() {
  var st = kwRandomizerState;

  st.$button.on("click", function (e) {
    e.preventDefault();
    if (st.isSpinning) return;

    // After a completed spin, second click switches into map voting
    var doneAttr = String(st.$wrap.attr("kw-randomizer-done") || "false");
    var isDone = doneAttr === "true";

    if (st.hasSpunOnce && isDone) {
      kwRandomizerSetViewState("mv");
      return;
    }

    // First click (or any click before selection): start spin
    kwRandomizerStartSpin();
  });
}

// [SPIN LOGIC] ----------------------------------------------------------------
function kwRandomizerStartSpin() {
  var cfg = kwRandomizerConfig;
  var st = kwRandomizerState;

  if (!st.$wheelInner || !st.slices.length) return;

  st.isSpinning = true;
  st.hasSpunOnce = true;
  st.$button.addClass("is--disabled");
  st.$wrap.attr("kw-randomizer-done", false);

  var minMs = cfg.minSpinSeconds * 1000;
  var maxMs = cfg.maxSpinSeconds * 1000;
  var totalDuration = kwRandomizerRandomInRange(minMs, maxMs);

  var backDuration = Math.min(400, totalDuration * 0.18);
  var mainDuration = totalDuration - backDuration;

  var startRotation = st.currentRotation || 0;
  var backTarget = startRotation - (15 + Math.random() * 10); // small backward swing

  kwRandomizerAnimateRotation(
    startRotation,
    backTarget,
    backDuration,
    kwRandomizerEaseInOutQuad,
    function () {
      var extraSpins = 4 + Math.floor(Math.random() * 4); // 4–7 full spins
      var randomOffset = Math.random() * 360;
      var forwardTarget = backTarget + extraSpins * 360 + randomOffset;

      kwRandomizerAnimateRotation(
        backTarget,
        forwardTarget,
        mainDuration,
        kwRandomizerEaseOutCubic,
        function () {
          kwRandomizerOnSpinComplete(forwardTarget);
        }
      );
    }
  );
}

function kwRandomizerOnSpinComplete(finalRotation) {
  var st = kwRandomizerState;
  var cfg = kwRandomizerConfig;

  st.isSpinning = false;
  st.currentRotation = finalRotation;

  st.$button.removeClass("is--disabled");

  // After first spin, change button label to start map voting
  if (cfg && cfg.buttonLabelAfterSpin) {
    st.$button.text(cfg.buttonLabelAfterSpin);
  }

  // final update & winner
  kwRandomizerUpdateActiveSlice(true);
  kwRandomizerFinalizeSelection();
}

// [ANIMATION HELPERS] ---------------------------------------------------------
function kwRandomizerAnimateRotation(
  start,
  end,
  duration,
  easingFn,
  onComplete
) {
  var st = kwRandomizerState;

  if (st.animationFrameId) {
    window.cancelAnimationFrame(st.animationFrameId);
    st.animationFrameId = null;
  }

  var startTime = null;

  function step(timestamp) {
    if (!startTime) startTime = timestamp;
    var elapsed = timestamp - startTime;
    var t = duration > 0 ? Math.min(1, elapsed / duration) : 1;
    var eased = typeof easingFn === "function" ? easingFn(t) : t;

    st.currentRotation = start + (end - start) * eased;
    kwRandomizerApplyRotation();

    if (t < 1) {
      st.animationFrameId = window.requestAnimationFrame(step);
    } else {
      st.animationFrameId = null;
      if (typeof onComplete === "function") onComplete();
    }
  }

  st.animationFrameId = window.requestAnimationFrame(step);
}

function kwRandomizerApplyRotation() {
  var st = kwRandomizerState;
  if (!st.$wheelInner) return;

  st.$wheelInner.css(
    "transform",
    "rotate(" + st.currentRotation + "deg) scale(1.5)"
  );
  kwRandomizerUpdateActiveSlice(false);
}

// [ACTIVE SLICE / TEAM TRACKING] ----------------------------------------------
function kwRandomizerUpdateActiveSlice(forceUpdate) {
  var st = kwRandomizerState;
  if (!st.slices.length || !st.$wheelInner) return;

  // avoid pre-highlighting before the first spin
  if (!forceUpdate && !st.isSpinning && !st.hasSpunOnce) return;

  var total = st.totalSections;
  if (!total) return;

  var sliceAngle = 360 / total;
  var rot = kwRandomizerNormalizeAngle(st.currentRotation || 0);

  // pointer is fixed at top (-90° in standard coordinate system)
  // relative to the wheel we subtract the wheel rotation
  var pointerAngle = kwRandomizerNormalizeAngle(-90 - rot); // degrees

  // shift so that 0° corresponds to the top boundary between slices
  var angleRel = kwRandomizerNormalizeAngle(pointerAngle + 90); // 0..360

  var epsilon = 0.0001;
  var idx = Math.floor((angleRel + epsilon) / sliceAngle) % total;

  if (st.activeIndex === idx) {
    var sameSlice = st.slices[idx];
    if (sameSlice) {
      st.currentTeam = sameSlice.team;
      st.$wrap.attr("kw-randomizer-current", String(st.currentTeam));
    }
    return;
  }

  // remove previous highlight
  if (st.activeIndex !== null && typeof st.activeIndex === "number") {
    var prevSlice = st.slices[st.activeIndex];
    if (prevSlice && prevSlice.$el) {
      prevSlice.$el.removeClass("kw-slice--active");
      // prevSlice.$el.css("filter", "");
    }
  }

  var activeSlice = st.slices[idx];
  if (!activeSlice || !activeSlice.$el) return;

  activeSlice.$el.addClass("kw-slice--active");
  // activeSlice.$el.css("filter", "brightness(1.12) saturate(1.1)");

  st.activeIndex = idx;
  st.currentTeam = activeSlice.team;

  st.$wrap.attr("kw-randomizer-current", String(st.currentTeam));
}

// [FINALIZE SELECTION] --------------------------------------------------------
function kwRandomizerFinalizeSelection() {
  var st = kwRandomizerState;
  var cfg = kwRandomizerConfig;

  var winnerTeam = st.currentTeam || 0;

  if (winnerTeam === 1 || winnerTeam === 2) {
    try {
      window.localStorage.setItem(cfg.localStorageKey, String(winnerTeam));
    } catch (e) {
      // ignore storage errors
    }
  }

  st.$wrap.attr("kw-randomizer-done", true);

  kwRandomizerHandleWinner(winnerTeam);
}

// Placeholder for future features (visual reactions, API calls, etc.)
function kwRandomizerHandleWinner(team) {
  // e.g.:
  // - highlight winning team card
  // - trigger analytics event
  // - preload mapvote layout for selected starting team
}

// [UTILITY FUNCTIONS] ---------------------------------------------------------
function kwRandomizerRandomInRange(min, max) {
  return min + Math.random() * (max - min);
}

function kwRandomizerNormalizeAngle(angle) {
  var a = angle % 360;
  if (a < 0) a += 360;
  return a;
}

function kwRandomizerEaseInOutQuad(t) {
  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
}

function kwRandomizerEaseOutCubic(t) {
  var p = t - 1;
  return p * p * p + 1;
}

// =============================================================================
// [MAPVOTE]
// =============================================================================

// CONFIG ----------------------------------------------------------------------
var mvConfig = {
  selectors: {
    wrap: '[mv-element="wrap"]',

    // Status area
    statusLogo1: '[mv-status-logo="1"]',
    statusLogo2: '[mv-status-logo="2"]',
    statusText: '[mv-status="text"]',

    // Map selector (template + inner parts)
    selectorItem: '[mv-element="selector-map"]',
    selectorTitle: '[mv-selector="title"]',
    selectorEmblem: '[mv-selector="emblem"]',
    selectorCover: '[mv-selector="cover"]',

    // Side / revert controls
    sideSelector: '[mv-element="selector-side"]',
    revertButton: '[mv-element="revert"]',

    // Slots (pre-built map votes)
    slotItem: '[mv-element="slot"]',
    slotLogoMap: '[mv-slot="logo-map"]',
    slotLogoTeam1: '[mv-slot="logo-team-1"]',
    slotLogoTeam2: '[mv-slot="logo-team-2"]',
    slotCover: '[mv-slot="cover"]',
    slotCoverDark: '[mv-slot="cover-dark"]',

    // Skeleton rows (text preview of voting flow)
    skeletonItem: '[mv-element="skeleton"]',
    skeletonLogo1: '[mv-skeleton="logo-1"]',
    skeletonLogo2: '[mv-skeleton="logo-2"]',
    skeletonText: '[mv-skeleton="text"]',
  },
  attrs: {
    // selector
    selectorSlug: "mv-selector-slug",
    selectorSide: "mv-selector-side",

    // status tracking on wrap
    statusTeam: "mv-status-team",
    statusPhase: "mv-status-phase",

    // slot attributes
    slotMap: "mv-slot-map",
    slotShowSide: "mv-slot-show-side",
    slotPhase: "mv-slot-phase",
    slotTeam: "mv-slot-team",
    slotNumber: "mv-slot-number",
    slotIsLast: "mv-slot-is-last",

    // skeleton attributes
    skeletonSlot: "mv-skeleton-slot",
    skeletonPhase: "mv-skeleton-phase",
    skeletonTeam: "mv-skeleton-team",
  },

  // Voting patterns: A = starting team, B = opposing team
  // These base patterns will be expanded with side steps after each pick.
  votePatterns: {
    1: [
      { type: "ban", team: "A" },
      { type: "ban", team: "B" },
      { type: "ban", team: "B" },
      { type: "ban", team: "A" },
      { type: "ban", team: "A" },
      { type: "ban", team: "B" },
      { type: "decider", team: null },
    ],
    3: [
      { type: "ban", team: "A" },
      { type: "ban", team: "B" },
      { type: "pick", team: "B" },
      { type: "pick", team: "A" },
      { type: "ban", team: "A" },
      { type: "ban", team: "B" },
      { type: "decider", team: null },
    ],
    5: [
      { type: "ban", team: "A" },
      { type: "ban", team: "B" },
      { type: "pick", team: "B" },
      { type: "pick", team: "A" },
      { type: "pick", team: "A" },
      { type: "pick", team: "B" },
      { type: "decider", team: null },
    ],
    7: [
      { type: "pick", team: "A" },
      { type: "pick", team: "B" },
      { type: "pick", team: "B" },
      { type: "pick", team: "A" },
      { type: "pick", team: "A" },
      { type: "pick", team: "B" },
      { type: "decider", team: null },
    ],
  },

  // Names for later Supabase integration (vote_1 ... vote_7)
  voteFieldNames: [
    "vote_1",
    "vote_2",
    "vote_3",
    "vote_4",
    "vote_5",
    "vote_6",
    "vote_7",
  ],
};

// STATE -----------------------------------------------------------------------
var mvState = {
  initialized: false,

  // Data
  activeGame: null,
  maps: [],
  mapBySlug: {},

  // DOM caches
  $wrap: null,
  $statusText: null,
  slotByMap: {},

  // Voting state
  vote: null, // { steps, history, mapOrder, voteFields, startingTeam, bestOf }
};

// INITIALIZATION FROM DATABASE -----------------------------------------------
/**
 * Initialize mapvote UI:
 * - status team logos
 * - map selector items
 * - pre-built slots for all maps with "mid" set
 * - vote flow (status, handlers, internal state)
 */
async function mvInitFromDatabase() {
  var cfg = mvConfig;

  // Only run on pages that actually have the mapvote markup
  var $wrap = $(cfg.selectors.wrap).first();
  if (!$wrap.length) {
    return;
  }

  if (mvState.initialized) {
    return;
  }
  mvState.initialized = true;

  mvState.$wrap = $wrap;
  mvState.$statusText = $wrap.find(cfg.selectors.statusText).first();

  if (
    typeof fetchGames !== "function" ||
    typeof fetchMaps !== "function" ||
    typeof buildAssetUrl !== "function"
  ) {
    console.warn("[mapvote] mvInitFromDatabase: missing dependencies", {
      hasFetchGames: typeof fetchGames === "function",
      hasFetchMaps: typeof fetchMaps === "function",
      hasBuildAssetUrl: typeof buildAssetUrl === "function",
    });
    return;
  }

  var games;
  var maps;

  try {
    var results = await Promise.all([fetchGames(), fetchMaps()]);
    games = results[0];
    maps = results[1];
  } catch (err) {
    console.warn("[mapvote] mvInitFromDatabase: failed to load data", err);
    return;
  }

  if (!Array.isArray(games) || games.length === 0) {
    console.warn("[mapvote] mvInitFromDatabase: no games available");
    return;
  }

  // Reuse randomizer's "active game" logic
  var activeGame =
    games.find(function (g) {
      return kwRandomizerIsActiveGame(g);
    }) || null;

  if (!activeGame) {
    console.warn("[mapvote] mvInitFromDatabase: no active game found");
    return;
  }

  // Filter maps: only those with a "mid" value set
  var playableMaps = (maps || []).filter(function (m) {
    if (!m) return false;
    var mid = m.mid;
    if (mid === null || mid === undefined) return false;
    if (typeof mid === "string" && mid.trim() === "") return false;
    if (mid === 0 || mid === "0") return false;
    return true;
  });

  if (!playableMaps.length) {
    console.warn("[mapvote] mvInitFromDatabase: no maps with 'mid' set", {
      mapsCount: Array.isArray(maps) ? maps.length : 0,
    });
    return;
  }

  // Stable order: sort by mid numerically
  var sorted = playableMaps.slice().sort(function (a, b) {
    var toNum = function (v) {
      var n = Number(v);
      return isNaN(n) ? 0 : n;
    };
    return toNum(a.mid) - toNum(b.mid);
  });

  mvState.activeGame = activeGame;
  mvState.maps = sorted;
  mvState.mapBySlug = mvBuildMapIndex(sorted);
  mvState.slotByMap = {};

  mvApplyStatusTeamLogos(activeGame);
  mvBuildSelectorItems(sorted);
  mvBuildSlots(sorted, activeGame);

  // Initialize voting flow (status + handlers)
  mvInitVotingProcess();
}

// TEAM LOGOS (STATUS) --------------------------------------------------------
/**
 * Apply team logos to [mv-status-logo="1"] and [mv-status-logo="2"].
 * Uses the same team logo preset as the randomizer (logo-800-iso).
 */
function mvApplyStatusTeamLogos(game) {
  if (!game) {
    console.warn("[mapvote] mvApplyStatusTeamLogos: no game provided");
    return;
  }

  var cfg = mvConfig;

  var t1Slug = (game.t1_slug || "").toLowerCase();
  var t2Slug = (game.t2_slug || "").toLowerCase();

  if (!t1Slug || !t2Slug) {
    console.warn(
      "[mapvote] mvApplyStatusTeamLogos: missing team slugs on game",
      game
    );
    return;
  }

  if (typeof buildAssetUrl !== "function") {
    console.warn("[mapvote] mvApplyStatusTeamLogos: buildAssetUrl missing");
    return;
  }

  var logo1Url = buildAssetUrl("teams", t1Slug, "logo-800-iso");
  var logo2Url = buildAssetUrl("teams", t2Slug, "logo-800-iso");

  var $logo1 = $(cfg.selectors.statusLogo1).first();
  var $logo2 = $(cfg.selectors.statusLogo2).first();

  if (!$logo1.length || !$logo2.length) {
    console.warn(
      "[mapvote] mvApplyStatusTeamLogos: status logo elements missing",
      {
        hasLogo1: $logo1.length > 0,
        hasLogo2: $logo2.length > 0,
      }
    );
  }

  kwRandomizerSetImageSource($logo1, logo1Url);
  kwRandomizerSetImageSource($logo2, logo2Url);
}

// MAP SELECTOR ---------------------------------------------------------------
/**
 * Build selector items from [mv-element="selector-map"] template.
 */
function mvBuildSelectorItems(maps) {
  var cfg = mvConfig;

  var $template = $(cfg.selectors.selectorItem).first();
  if (!$template.length) {
    console.warn(
      "[mapvote] mvBuildSelectorItems: template not found",
      cfg.selectors.selectorItem
    );
    return;
  }

  // Mark original as template and let CSS hide it
  $template.addClass("is--template");

  var $parent = $template.parent();
  if (!$parent.length) {
    console.warn("[mapvote] mvBuildSelectorItems: template has no parent");
    return;
  }

  // Avoid double-build if non-template items already exist
  var $existing = $parent
    .children(cfg.selectors.selectorItem)
    .not(".is--template");

  if ($existing.length > 0) {
    return;
  }

  maps.forEach(function (mapRow) {
    if (!mapRow || !mapRow.slug) {
      console.warn(
        "[mapvote] mvBuildSelectorItems: skip map without slug",
        mapRow
      );
      return;
    }

    var slug = String(mapRow.slug).toLowerCase();
    var mname = mapRow.mname || slug;
    var emblemUrl = mapRow.urlEmblem || buildAssetUrl("map", slug, "-emblem");
    var coverUrl = mapRow.urlCover || buildAssetUrl("map", slug, "-cover");

    var $item = $template.clone(true, true);
    $item.removeClass("is--template");
    $item.attr(cfg.attrs.selectorSlug, slug);

    var $title = $item.find(cfg.selectors.selectorTitle).first();
    var $emblem = $item.find(cfg.selectors.selectorEmblem).first();
    var $cover = $item.find(cfg.selectors.selectorCover).first();

    if ($title && $title.length) {
      if (typeof setText === "function") {
        setText($title, mname);
      } else {
        $title.text(mname);
      }
    } else {
      console.warn(
        "[mapvote] mvBuildSelectorItems: title element missing for map",
        slug
      );
    }

    kwRandomizerSetImageSource($emblem, emblemUrl);
    kwRandomizerSetImageSource($cover, coverUrl);

    $parent.append($item);
  });
}

// MAP SLOTS (PRE-BUILT VOTES) -----------------------------------------------
/**
 * Build one [mv-element="slot"] per map with default attributes.
 */
function mvBuildSlots(maps, game) {
  var cfg = mvConfig;

  var $template = $(cfg.selectors.slotItem).first();
  if (!$template.length) {
    console.warn(
      "[mapvote] mvBuildSlots: template not found",
      cfg.selectors.slotItem
    );
    return;
  }

  // Mark original template
  $template.addClass("is--template");

  var $parent = $template.parent();
  if (!$parent.length) {
    console.warn("[mapvote] mvBuildSlots: template has no parent");
    return;
  }

  // Avoid double-build if non-template slots already exist
  var $existing = $parent.children(cfg.selectors.slotItem).not(".is--template");
  if ($existing.length > 0) {
    return;
  }

  var t1Slug = (game && game.t1_slug ? game.t1_slug : "").toLowerCase();
  var t2Slug = (game && game.t2_slug ? game.t2_slug : "").toLowerCase();

  if (!t1Slug || !t2Slug) {
    console.warn("[mapvote] mvBuildSlots: missing team slugs on game", {
      t1Slug: t1Slug,
      t2Slug: t2Slug,
      game: game,
    });
  }

  if (typeof buildAssetUrl !== "function") {
    console.warn("[mapvote] mvBuildSlots: buildAssetUrl missing");
    return;
  }

  var team1LogoUrl = t1Slug
    ? buildAssetUrl("teams", t1Slug, "logo-800-iso")
    : "";
  var team2LogoUrl = t2Slug
    ? buildAssetUrl("teams", t2Slug, "logo-800-iso")
    : "";

  maps.forEach(function (mapRow) {
    if (!mapRow || !mapRow.slug) {
      console.warn("[mapvote] mvBuildSlots: skip map without slug", mapRow);
      return;
    }

    var slug = String(mapRow.slug).toLowerCase();
    var emblemUrl = mapRow.urlEmblem || buildAssetUrl("map", slug, "-emblem");
    var coverUrl = mapRow.urlCover || buildAssetUrl("map", slug, "-cover");
    var coverDarkUrl = buildAssetUrl("map", slug, "-cover-dark");

    var $slot = $template.clone(true, true);
    $slot.removeClass("is--template");

    // Default attributes
    $slot.attr(cfg.attrs.slotMap, slug);
    $slot.attr(cfg.attrs.slotShowSide, "false");
    $slot.attr(cfg.attrs.slotPhase, "");
    $slot.attr(cfg.attrs.slotTeam, "");
    $slot.attr(cfg.attrs.slotNumber, "0");
    $slot.attr(cfg.attrs.slotIsLast, "false");

    var $logoMap = $slot.find(cfg.selectors.slotLogoMap).first();
    var $logoTeam1 = $slot.find(cfg.selectors.slotLogoTeam1).first();
    var $logoTeam2 = $slot.find(cfg.selectors.slotLogoTeam2).first();
    var $cover = $slot.find(cfg.selectors.slotCover).first();
    var $coverDark = $slot.find(cfg.selectors.slotCoverDark).first();

    kwRandomizerSetImageSource($logoMap, emblemUrl);
    kwRandomizerSetImageSource($logoTeam1, team1LogoUrl);
    kwRandomizerSetImageSource($logoTeam2, team2LogoUrl);
    kwRandomizerSetImageSource($cover, coverUrl);
    kwRandomizerSetImageSource($coverDark, coverDarkUrl);

    // Cache slots by map slug for quick lookup during voting
    mvState.slotByMap[slug] = $slot;

    $parent.append($slot);
  });
}

// SKELETON BUILDER -----------------------------------------------------------
/**
 * Prepare [mv-element="skeleton"] elements based on the vote structure.
 * - Applies team logos to [mv-skeleton="logo-1"/"logo-2"]
 * - Fills mv-skeleton-phase / mv-skeleton-team attributes
 * - Replaces [mv-skeleton="text"] with "bannt" / "pickt"
 * Only the first six slots (1..6) are affected; the decider row is left untouched.
 */
function mvBuildSkeletonFromVote() {
  var st = mvState;
  var cfg = mvConfig;
  var attrs = cfg.attrs;

  if (!st.$wrap || !st.$wrap.length || !st.vote || !st.activeGame) {
    return;
  }

  var game = st.activeGame;

  var t1Slug = (game.t1_slug || "").toLowerCase();
  var t2Slug = (game.t2_slug || "").toLowerCase();

  if (!t1Slug || !t2Slug) {
    console.warn("[mapvote] mvBuildSkeletonFromVote: missing team slugs", game);
    return;
  }

  if (typeof buildAssetUrl !== "function") {
    console.warn("[mapvote] mvBuildSkeletonFromVote: buildAssetUrl missing");
    return;
  }

  var logo1Url = buildAssetUrl("teams", t1Slug, "logo-800-iso");
  var logo2Url = buildAssetUrl("teams", t2Slug, "logo-800-iso");

  var steps = st.vote.steps || [];
  if (!steps.length) return;

  // Collect all ban/pick steps in chronological order
  var mapSteps = [];
  steps.forEach(function (step) {
    if (!step) return;
    if (step.phase === "ban" || step.phase === "pick") {
      mapSteps.push(step);
    }
  });

  if (!mapSteps.length) {
    return;
  }

  var $skeletons = st.$wrap.find(cfg.selectors.skeletonItem);
  if (!$skeletons.length) {
    return;
  }

  $skeletons.each(function () {
    var $item = $(this);
    var slotAttr = $item.attr(attrs.skeletonSlot);

    // Ignore items without a slot or >= 7 (decider row)
    if (!slotAttr) {
      return;
    }

    var slot = Number(slotAttr);
    if (!slot || slot >= 7) {
      return;
    }

    var step = mapSteps[slot - 1] || null;
    if (!step) {
      // No matching step; clear attributes but keep layout
      $item.attr(attrs.skeletonPhase, "");
      $item.attr(attrs.skeletonTeam, "");
      return;
    }

    var phase = step.phase === "ban" || step.phase === "pick" ? step.phase : "";
    var teamNum = phase ? step.team || 0 : 0;

    $item.attr(attrs.skeletonPhase, phase);
    $item.attr(attrs.skeletonTeam, teamNum ? String(teamNum) : "");

    // Apply team logos
    var $logo1 = $item.find(cfg.selectors.skeletonLogo1).first();
    var $logo2 = $item.find(cfg.selectors.skeletonLogo2).first();

    if ($logo1.length) {
      kwRandomizerSetImageSource($logo1, logo1Url);
    }
    if ($logo2.length) {
      kwRandomizerSetImageSource($logo2, logo2Url);
    }

    // Apply localized text
    var $text = $item.find(cfg.selectors.skeletonText).first();
    if ($text.length) {
      if (phase === "ban") {
        $text.text("bannt");
      } else if (phase === "pick") {
        $text.text("pickt");
      }
    }
  });
}

// -----------------------------------------------------------------------------
// HANDLE VOTING PROCESS
// -----------------------------------------------------------------------------

/**
 * Create a simple lookup {slugLower: mapRow} for status texts etc.
 */
function mvBuildMapIndex(maps) {
  var index = {};
  (maps || []).forEach(function (row) {
    if (!row || !row.slug) return;
    var slug = String(row.slug).toLowerCase();
    index[slug] = row;
  });
  return index;
}

/**
 * Resolve starting team from the randomizer.
 * Reads the same localStorage key used by the wheel.
 */
function mvResolveStartingTeam() {
  var cfg = kwRandomizerConfig || {};
  var key = cfg.localStorageKey || "stream_mapvote_start";
  var val = null;

  try {
    val = window.localStorage.getItem(key);
  } catch (e) {
    val = null;
  }

  var num = Number(val);
  if (num === 1 || num === 2) {
    return num;
  }

  // Fallback: default to team 1
  return 1;
}

/**
 * Resolve best-of value from the active game (1 / 3 / 5 / 7).
 */
function mvResolveBestOf(game) {
  if (!game || game.best_of === undefined || game.best_of === null) {
    return 3;
  }

  var n = Number(game.best_of);
  if (n === 1 || n === 3 || n === 5 || n === 7) {
    return n;
  }

  // Fallback to BO3 if something unexpected is stored
  return 3;
}

/**
 * Build expanded vote steps (including side steps) for a given best-of.
 *
 * Each step:
 * - index: 1-based sequence number
 * - phase: "ban" | "pick" | "side" | "decider"
 * - team: 1 | 2 | 0
 * - mapSlug: filled once a map is chosen (used for "side" and "decider")
 */
function mvBuildVoteSteps(bestOf, startingTeam) {
  var cfg = mvConfig;
  var patternBase = cfg.votePatterns[bestOf] || cfg.votePatterns[3];

  // Map symbolic teams A/B to real team numbers 1/2 depending on starting team
  var teamMap = {
    A: startingTeam === 2 ? 2 : 1,
    B: startingTeam === 2 ? 1 : 2,
  };

  var steps = [];
  var indexCounter = 0;

  patternBase.forEach(function (action) {
    if (!action || !action.type) return;

    if (action.type === "ban" || action.type === "pick") {
      indexCounter++;
      var actingTeam = teamMap[action.team] || 0;

      steps.push({
        index: indexCounter,
        phase: action.type, // "ban" or "pick"
        team: actingTeam,
        mapSlug: null,
      });

      if (action.type === "pick") {
        // After each pick, the opposing team selects the side
        indexCounter++;
        var sideTeam = actingTeam === teamMap.A ? teamMap.B : teamMap.A;

        steps.push({
          index: indexCounter,
          phase: "side",
          team: sideTeam,
          mapSlug: null, // will be filled once the corresponding pick has a map
        });
      }
    } else if (action.type === "decider") {
      indexCounter++;
      steps.push({
        index: indexCounter,
        phase: "decider",
        team: 0,
        mapSlug: null,
      });
    }
  });

  return steps;
}

/**
 * Initialize voting state and event bindings.
 */
function mvInitVotingProcess() {
  var st = mvState;
  var cfg = mvConfig;

  if (!st.$wrap || !st.$wrap.length) {
    return;
  }

  var startingTeam = mvResolveStartingTeam();
  var bestOf = mvResolveBestOf(st.activeGame);
  var steps = mvBuildVoteSteps(bestOf, startingTeam);

  var voteFields = {};
  cfg.voteFieldNames.forEach(function (name) {
    voteFields[name] = null;
  });

  st.vote = {
    steps: steps,
    history: [], // array of { stepIdx, type, slug?, side?, team }
    mapOrder: [], // sequence of map slugs when they are banned/picked/decider
    voteFields: voteFields,
    startingTeam: startingTeam,
    bestOf: bestOf,
    persisted: false, // has this vote already been written to Supabase?
  };

  // Ensure clean UI state for voting
  mvApplyVoteDom();
  mvUpdateStatusView();

  // Bind interactions once
  mvBindVoteEvents();
}

/**
 * Rebuild voting steps based on the latest randomizer result.
 * Called when entering the mapvote view; only runs if no vote has started yet.
 */
function mvReinitVotingFromRandomizerIfIdle() {
  var st = mvState;

  // Require initialized mapvote + an active game
  if (!st.initialized || !st.activeGame) {
    return;
  }

  // Do not override an already running vote
  if (st.vote && st.vote.history && st.vote.history.length > 0) {
    return;
  }

  var startingTeam = mvResolveStartingTeam();
  var bestOf = mvResolveBestOf(st.activeGame);
  var steps = mvBuildVoteSteps(bestOf, startingTeam);

  var voteFields = {};
  mvConfig.voteFieldNames.forEach(function (name) {
    voteFields[name] = null;
  });

  st.vote = {
    steps: steps,
    history: [],
    mapOrder: [],
    voteFields: voteFields,
    startingTeam: startingTeam,
    bestOf: bestOf,
    persisted: false,
  };

  mvApplyVoteDom();
  mvUpdateStatusView();
}

/**
 * Rebuild voting steps based on the latest randomizer result.
 * Called when entering the mapvote view; only runs if no vote has started yet.
 */
function mvReinitVotingFromRandomizerIfIdle() {
  var st = mvState;

  // Require initialized mapvote + an active game
  if (!st.initialized || !st.activeGame) {
    return;
  }

  // Do not override an already running vote
  if (st.vote && st.vote.history && st.vote.history.length > 0) {
    return;
  }

  var startingTeam = mvResolveStartingTeam();
  var bestOf = mvResolveBestOf(st.activeGame);
  var steps = mvBuildVoteSteps(bestOf, startingTeam);

  var voteFields = {};
  mvConfig.voteFieldNames.forEach(function (name) {
    voteFields[name] = null;
  });

  st.vote = {
    steps: steps,
    history: [],
    mapOrder: [],
    voteFields: voteFields,
    startingTeam: startingTeam,
    bestOf: bestOf,
  };

  mvApplyVoteDom();
  mvUpdateStatusView();
}

/**
 * Get the current step based on history length.
 */
function mvGetCurrentStep() {
  var st = mvState;
  if (!st.vote || !st.vote.steps) return null;

  var idx = st.vote.history.length;
  if (idx < 0 || idx >= st.vote.steps.length) return null;

  return st.vote.steps[idx];
}

/**
 * Get slot jQuery element for a given map slug.
 */
function mvGetSlotForSlug(slug) {
  if (!slug) return null;
  var st = mvState;
  var cfg = mvConfig;

  if (st.slotByMap && st.slotByMap[slug]) {
    return st.slotByMap[slug];
  }

  if (!st.$wrap || !st.$wrap.length) return null;

  var $slot = st.$wrap
    .find(cfg.selectors.slotItem + "[" + cfg.attrs.slotMap + '="' + slug + '"]')
    .first();

  if ($slot.length) {
    st.slotByMap[slug] = $slot;
  }

  return $slot;
}

/**
 * Resolve a short team tag for display in the slot side area.
 */
function mvGetTeamTag(teamNumber) {
  var game = mvState.activeGame || {};
  if (teamNumber === 1) {
    return game.t1_tag || game.t1_slug || "Team 1";
  }
  if (teamNumber === 2) {
    return game.t2_tag || game.t2_slug || "Team 2";
  }
  return "";
}

/**
 * Record the order (vote_1 ... vote_7) whenever a map is picked/banned/decider.
 */
function mvRecordMapOrder(slug) {
  if (!slug) return;

  var st = mvState;
  var v = st.vote;
  if (!v) return;

  if (v.mapOrder.indexOf(slug) !== -1) {
    return;
  }

  if (v.mapOrder.length >= mvConfig.voteFieldNames.length) {
    return;
  }

  v.mapOrder.push(slug);
  var index = v.mapOrder.length - 1;
  var fieldName = mvConfig.voteFieldNames[index];
  if (fieldName) {
    v.voteFields[fieldName] = slug;
  }
}

/**
 * Apply full UI state for current history:
 * - reset selectors/slots
 * - reapply all steps from history
 */
function mvApplyVoteDom() {
  var st = mvState;
  var cfg = mvConfig;
  var attrs = cfg.attrs;
  var v = st.vote;

  if (!st.$wrap || !st.$wrap.length || !v) return;

  var $wrap = st.$wrap;

  // Reset selectors
  var $selectors = $wrap.find(cfg.selectors.selectorItem).not(".is--template");
  $selectors.removeClass("is--disabled");

  // Reset slots
  var $slots = $wrap.find(cfg.selectors.slotItem).not(".is--template");

  $slots.each(function () {
    var $slot = $(this);
    $slot.attr(attrs.slotShowSide, "false");
    $slot.attr(attrs.slotPhase, "");
    $slot.attr(attrs.slotTeam, "");
    $slot.attr(attrs.slotNumber, "0");
    $slot.attr(attrs.slotIsLast, "false");
    $slot.attr(attrs.slotMap, "");

    var $tag = $slot.find('[mv-slot-side="tag"]').first();
    var $side = $slot.find('[mv-slot-side="side"]').first();
    var $phaseLabel = $slot.find('[mv-slot="phase"]').first();

    if ($tag.length) $tag.text("");
    if ($side.length) $side.text("");
    if ($phaseLabel.length) $phaseLabel.text("");
  });

  // Reapply history
  var lastSlug = null;

  // Counter for all map-affecting steps (ban/pick) in chronological order.
  // This is used to assign slot numbers 1..6, while decider always gets 7.
  var mapStepCount = 0;

  v.history.forEach(function (entry) {
    if (!entry) return;

    var step = v.steps[entry.stepIdx];
    if (!step) return;

    // -----------------------------------------------------------------------
    // MAP-AFFECTING STEPS: ban / pick / decider
    // -----------------------------------------------------------------------
    if (
      step.phase === "ban" ||
      step.phase === "pick" ||
      step.phase === "decider"
    ) {
      var slug = entry.slug;
      if (!slug) return;

      lastSlug = slug;

      // Disable selector
      var $selector = $wrap
        .find(
          cfg.selectors.selectorItem +
            "[" +
            attrs.selectorSlug +
            '="' +
            slug +
            '"]'
        )
        .not(".is--template")
        .first();

      if ($selector.length) {
        $selector.addClass("is--disabled");
      }

      // Update slot for this map
      var $slot = mvGetSlotForSlug(slug);
      if ($slot && $slot.length) {
        $slot.attr(attrs.slotMap, slug);
        $slot.attr(attrs.slotPhase, step.phase);
        $slot.attr(attrs.slotTeam, String(step.team || 0));

        // Slot numbers count only map-affecting steps (ban/pick/decider).
        // Side steps do NOT increment the numbering.
        var slotNumber = 0;

        if (step.phase === "decider") {
          // Decider always gets slot 7
          slotNumber = 7;
        } else {
          // Each ban/pick increments the map step counter once,
          // so the first ban/pick becomes 1, the second 2, etc.
          mapStepCount += 1;
          slotNumber = mapStepCount;
        }

        $slot.attr(attrs.slotNumber, String(slotNumber));

        var $phaseLabel = $slot.find('[mv-slot="phase"]').first();
        if ($phaseLabel.length) {
          var label = "";
          if (step.phase === "ban") label = "Bann";
          else if (step.phase === "pick") label = "Pick";
          else if (step.phase === "decider") label = "Decider";
          $phaseLabel.text(label);
        }
      }
    }

    // -----------------------------------------------------------------------
    // SIDE STEPS
    // -----------------------------------------------------------------------
    if (step.phase === "side") {
      var sideSlug = entry.slug || step.mapSlug;
      if (!sideSlug) return;

      var $slotSide = mvGetSlotForSlug(sideSlug);
      if ($slotSide && $slotSide.length) {
        $slotSide.attr(attrs.slotShowSide, "true");

        var $tag = $slotSide.find('[mv-slot-side="tag"]').first();
        var $side = $slotSide.find('[mv-slot-side="side"]').first();

        if ($tag.length) {
          $tag.text(mvGetTeamTag(step.team));
        }

        if ($side.length) {
          var sideLabel = entry.side === "ct" ? "CT" : "T";
          $side.text(sideLabel);
        }
      }
      lastSlug = sideSlug || lastSlug;
    }
  });

  // Mark last-affected slot only while the process is still ongoing.
  // If we are at the final step (all steps done, including decider),
  // mv-slot-is-last should be "false" for all maps.
  var isFinished = v.history.length >= v.steps.length;

  if (!isFinished && lastSlug) {
    var $lastSlot = mvGetSlotForSlug(lastSlug);
    if ($lastSlot && $lastSlot.length) {
      $lastSlot.attr(attrs.slotIsLast, "true");
    }
  }
}

/**
 * Update status attributes + text based on the next step.
 * Triggers Supabase write once the vote is fully completed.
 */
function mvUpdateStatusView() {
  var st = mvState;
  var cfg = mvConfig;
  var attrs = cfg.attrs;
  var v = st.vote;
  var $wrap = st.$wrap;

  if (!$wrap || !$wrap.length || !v) return;

  var nextStep = mvGetCurrentStep();

  if (!nextStep) {
    // Voting is done
    $wrap.attr(attrs.statusTeam, "0");
    $wrap.attr(attrs.statusPhase, "done");

    if (st.$statusText && st.$statusText.length) {
      st.$statusText.text("Kartenwahl abgeschlossen");
    }

    // Persist final vote_1..vote_7 once
    mvPersistVoteToSupabase();

    return;
  }

  var phase = nextStep.phase;
  // For the status attribute we only use pick/ban/side as requested
  var phaseForAttr =
    phase === "side" ? "side" : phase === "ban" ? "ban" : "pick";

  $wrap.attr(attrs.statusTeam, String(nextStep.team || 0));
  $wrap.attr(attrs.statusPhase, phaseForAttr);

  if (!st.$statusText || !st.$statusText.length) {
    return;
  }

  if (phaseForAttr === "pick") {
    st.$statusText.text("Wählt Karte");
  } else if (phaseForAttr === "ban") {
    st.$statusText.text("Bannt Karte");
  } else if (phaseForAttr === "side") {
    var slug = nextStep.mapSlug;
    var mapName = "";
    if (slug && st.mapBySlug && st.mapBySlug[slug]) {
      var row = st.mapBySlug[slug];
      mapName = row.mname || row.slug || "";
    }
    if (mapName) {
      st.$statusText.text("Wählt Startseite auf " + mapName);
    } else {
      st.$statusText.text("Wählt Startseite");
    }
  }
}

/**
 * Automatically handle the decider step by assigning the remaining map.
 */
function mvHandleDeciderStepIfNeeded() {
  var st = mvState;
  var v = st.vote;
  if (!v || !v.steps) return;

  var currentIdx = v.history.length;
  var step = v.steps[currentIdx];
  if (!step || step.phase !== "decider") return;

  // Determine remaining map: maps that are not yet in mapOrder
  var remainingSlug = null;
  (st.maps || []).some(function (row) {
    if (!row || !row.slug) return false;
    var slug = String(row.slug).toLowerCase();
    if (v.mapOrder.indexOf(slug) === -1) {
      remainingSlug = slug;
      return true;
    }
    return false;
  });

  if (!remainingSlug) {
    return;
  }

  step.mapSlug = remainingSlug;

  // Record history entry
  v.history.push({
    stepIdx: currentIdx,
    type: "decider",
    slug: remainingSlug,
    side: null,
    team: step.team || 0,
  });

  // Record in vote_1..7
  mvRecordMapOrder(remainingSlug);

  // Re-render UI and update status
  mvApplyVoteDom();
  mvUpdateStatusView();
}

/**
 * Click handler for map selectors (pick / ban steps).
 */
function mvHandleMapSelectorClick($item) {
  var st = mvState;
  var cfg = mvConfig;
  var attrs = cfg.attrs;

  if (!st.vote) return;

  var step = mvGetCurrentStep();
  if (!step) return;

  if (step.phase !== "pick" && step.phase !== "ban") {
    // Map clicks are only relevant during pick/ban
    return;
  }

  var slug = String($item.attr(attrs.selectorSlug) || "").toLowerCase();
  if (!slug) return;

  if ($item.hasClass("is--disabled")) {
    return;
  }

  // Store selected map on this step
  step.mapSlug = slug;

  var currentIdx = st.vote.history.length;
  st.vote.history.push({
    stepIdx: currentIdx,
    type: step.phase,
    slug: slug,
    side: null,
    team: step.team || 0,
  });

  // Track order for vote_1..vote_7
  mvRecordMapOrder(slug);

  // For side step directly after pick, pre-fill mapSlug
  var steps = st.vote.steps;
  var nextIdx = currentIdx + 1;
  if (steps[nextIdx] && steps[nextIdx].phase === "side") {
    steps[nextIdx].mapSlug = slug;
  }

  mvApplyVoteDom();
  mvUpdateStatusView();

  // If next step is the decider, handle it automatically
  mvHandleDeciderStepIfNeeded();
}

/**
 * Click handler for side selectors ("t" / "ct").
 */
function mvHandleSideSelectorClick($item) {
  var st = mvState;
  var cfg = mvConfig;
  var attrs = cfg.attrs;

  if (!st.vote) return;

  var step = mvGetCurrentStep();
  if (!step || step.phase !== "side") {
    return;
  }

  var sideVal = String($item.attr(attrs.selectorSide) || "").toLowerCase();
  if (!sideVal) return;

  var mapSlug = step.mapSlug;
  if (!mapSlug) {
    return;
  }

  var currentIdx = st.vote.history.length;
  st.vote.history.push({
    stepIdx: currentIdx,
    type: "side",
    slug: mapSlug,
    side: sideVal,
    team: step.team || 0,
  });

  mvApplyVoteDom();
  mvUpdateStatusView();

  // If next step is the decider, handle it automatically
  mvHandleDeciderStepIfNeeded();
}

/**
 * Revert last step of the vote.
 */
function mvHandleRevert() {
  var st = mvState;
  if (!st.vote || !st.vote.history.length) {
    return;
  }

  var v = st.vote;

  // As soon as something is reverted, allow re-persisting later
  v.persisted = false;

  // Remove last history entry
  var last = v.history.pop();
  if (!last) {
    return;
  }

  var step = v.steps[last.stepIdx];

  // If we reverted a map-affecting step (ban/pick/decider),
  // also remove it from mapOrder and voteFields.
  if (
    step &&
    (step.phase === "ban" || step.phase === "pick" || step.phase === "decider")
  ) {
    var slug = last.slug;
    if (slug) {
      var idx = v.mapOrder.indexOf(slug);
      if (idx !== -1) {
        v.mapOrder.splice(idx, 1);

        // Rebuild voteFields based on new mapOrder
        var voteFields = {};
        mvConfig.voteFieldNames.forEach(function (name) {
          voteFields[name] = null;
        });
        v.mapOrder.forEach(function (s, i) {
          var fieldName = mvConfig.voteFieldNames[i];
          if (fieldName) {
            voteFields[fieldName] = s;
          }
        });
        v.voteFields = voteFields;
      }
    }
  }

  // If we reverted a pick/ban/decider step, clear mapSlug on this step
  // and for picks also clear mapSlug on the following side step.
  if (
    step &&
    (step.phase === "pick" || step.phase === "ban" || step.phase === "decider")
  ) {
    step.mapSlug = null;

    if (step.phase === "pick") {
      var steps = v.steps;
      var sideIndex = last.stepIdx + 1;
      if (steps[sideIndex] && steps[sideIndex].phase === "side") {
        steps[sideIndex].mapSlug = null;
      }
    }
  }

  // Re-apply UI
  mvApplyVoteDom();
  mvUpdateStatusView();
}

/**
 * Bind click handlers for map selectors, side selectors and revert.
 */
function mvBindVoteEvents() {
  var st = mvState;
  var cfg = mvConfig;

  if (!st.$wrap || !st.$wrap.length) return;

  var $wrap = st.$wrap;

  // Map selector clicks (pick / ban)
  $wrap.on("click", cfg.selectors.selectorItem, function (e) {
    e.preventDefault();

    var $item = $(this);
    if ($item.hasClass("is--template")) {
      return;
    }

    mvHandleMapSelectorClick($item);
  });

  // Side selector clicks
  $wrap.on("click", cfg.selectors.sideSelector, function (e) {
    e.preventDefault();
    mvHandleSideSelectorClick($(this));
  });

  // Revert last step
  $wrap.on("click", cfg.selectors.revertButton, function (e) {
    e.preventDefault();
    mvHandleRevert();
  });
}

function mvShowPersistErrorAlert() {
  if (typeof window !== "undefined" && typeof window.alert === "function") {
    window.alert(
      "Fehler beim Speichern der Kartenwahl.\nBitte Seite neu laden oder die Spielleitung informieren."
    );
  }
}

/**
 * Persist final vote (vote_start + vote_1..vote_7) to Supabase for the active game.
 * Uses mvState.vote.startingTeam and mvState.vote.voteFields.
 * Called once the voting process is fully completed.
 */
function mvPersistVoteToSupabase() {
  var st = mvState;
  var cfg = mvConfig;

  if (!st || !st.activeGame || !st.vote) {
    return;
  }

  var v = st.vote;

  // Only persist once per completed vote state (until reverted or rebuilt)
  if (v.persisted) {
    return;
  }

  // Ensure all steps are done
  if (!v.steps || v.history.length < v.steps.length) {
    return;
  }

  // If the global auth lifecycle is present and clearly reports "no session",
  // skip the write. The user was already warned on page load.
  if (typeof mvHasValidAuthSession === "function") {
    if (!mvHasValidAuthSession()) {
      console.warn(
        "[mapvote] mvPersistVoteToSupabase: no valid auth session; skipping update"
      );
      return;
    }
  }

  var game = st.activeGame;

  // Build payload from voteFields (vote_1..vote_7)
  var payload = {};
  var hasAny = false;

  cfg.voteFieldNames.forEach(function (fieldName) {
    var val = v.voteFields ? v.voteFields[fieldName] : null;
    if (val != null && val !== "") {
      hasAny = true;
    }
    payload[fieldName] = val || null;
  });

  // If no map was recorded at all, skip writing completely
  if (!hasAny) {
    return;
  }

  // Add vote_start from startingTeam -> team slug
  var voteStartSlug = null;
  if (v.startingTeam === 1) {
    voteStartSlug = (game.t1_slug || "").toLowerCase() || null;
  } else if (v.startingTeam === 2) {
    voteStartSlug = (game.t2_slug || "").toLowerCase() || null;
  }
  payload.vote_start = voteStartSlug;

  var client =
    (typeof window !== "undefined" && window.supabaseClient) ||
    (typeof supabaseClient !== "undefined" ? supabaseClient : null);

  if (!client || !client.from) {
    console.warn("[mapvote] mvPersistVoteToSupabase: supabase client missing");
    mvShowPersistErrorAlert();
    return;
  }

  var query = client.from("games").update(payload);

  if (game.id != null) {
    query = query.eq("id", game.id);
  } else if (game.slug) {
    query = query.eq("slug", game.slug);
  } else {
    console.warn("[mapvote] mvPersistVoteToSupabase: no game id/slug");
    mvShowPersistErrorAlert();
    return;
  }

  // Fire-and-forget style update; keep UI responsive
  query
    .select("id")
    .then(function (res) {
      if (!res || res.error) {
        console.warn(
          "[mapvote] mvPersistVoteToSupabase: update failed",
          res && res.error
        );
        mvShowPersistErrorAlert();
        return;
      }

      // Mark as persisted for this vote state
      v.persisted = true;

      // Keep local cache in sync if available
      mvSyncVoteCache(payload);
    })
    .catch(function (err) {
      console.warn("[mapvote] mvPersistVoteToSupabase: update threw", err);
      mvShowPersistErrorAlert();
    });
}

/**
 * Sync updated vote_start + vote_1..vote_7 back into local preload/cache
 * structures. This keeps fetchGames() / cached games consistent after a vote
 * while preserving the overall row structure from base.js.
 */
function mvSyncVoteCache(payload) {
  try {
    if (!payload) {
      return;
    }

    var st = mvState;
    var game = st.activeGame;

    if (!game) {
      return;
    }

    var games =
      (window.__supabasePreload && window.__supabasePreload.games) || null;

    var target = null;

    if (Array.isArray(games) && games.length) {
      for (var i = 0; i < games.length; i++) {
        var row = games[i];
        if (!row) continue;

        if (
          (game.id != null && row.id === game.id) ||
          (game.id == null && game.slug && row.slug === game.slug)
        ) {
          target = row;
          break;
        }
      }
    }

    // If nothing found in preload, at least update the activeGame object
    if (!target) {
      target = game;
    }

    if (!target) {
      return;
    }

    // Only apply the known vote fields to avoid touching structural columns
    // (e.g. active, scores, production fields, etc.).
    var fieldsToApply = [];

    if (mvConfig && Array.isArray(mvConfig.voteFieldNames)) {
      fieldsToApply = mvConfig.voteFieldNames.slice();
    }
    fieldsToApply.push("vote_start");

    fieldsToApply.forEach(function (fieldName) {
      if (!Object.prototype.hasOwnProperty.call(payload, fieldName)) {
        return;
      }
      var val = payload[fieldName];
      target[fieldName] = val;
      game[fieldName] = val;
    });

    // Persist updated games cache back to localStorage if helpers exist
    if (
      Array.isArray(games) &&
      typeof setCached === "function" &&
      typeof LS_KEYS === "object" &&
      LS_KEYS &&
      LS_KEYS.games
    ) {
      setCached(LS_KEYS.games, games);
    }
  } catch (e) {
    console.warn("[mapvote] mvSyncVoteCache: failed", e);
  }
}

// =============================================================================
// [MAPVOTE AUTH GUARD]
// =============================================================================

// Tracks whether we already showed the "not signed in" warning on this page
var mvAuthWarningShown = false;

/**
 * Check whether a valid auth session is available via script-auth.js.
 *
 * This helper only returns false if the global auth lifecycle is initialized
 * and explicitly reports "no user". If auth is not available or not fully
 * initialized yet, we treat it as "unknown" and do not block writes.
 */
function mvHasValidAuthSession() {
  try {
    if (typeof AppAuth === "undefined" || !AppAuth) {
      // Auth system not present on this page; do not block.
      return true;
    }

    // If lifecycle has not finished yet, treat as "unknown" and allow writes.
    if (!AppAuth._initialized) {
      return true;
    }

    return !!(AppAuth.session && AppAuth.user);
  } catch (e) {
    console.warn("[mapvote] mvHasValidAuthSession: failed", e);
    // On any unexpected error, do not block the write.
    return true;
  }
}

/**
 * Show a one-time warning if there is definitely no valid auth session.
 * User-facing text is German by convention.
 */
function mvWarnIfNoAuthSession() {
  if (mvAuthWarningShown) return;

  // Only warn if we know for sure that there is no valid session
  try {
    if (
      typeof AppAuth === "undefined" ||
      !AppAuth ||
      !AppAuth._initialized ||
      (AppAuth.session && AppAuth.user)
    ) {
      return;
    }
  } catch (e) {
    console.warn("[mapvote] mvWarnIfNoAuthSession: check failed", e);
    return;
  }

  mvAuthWarningShown = true;

  if (typeof window !== "undefined" && typeof window.alert === "function") {
    window.alert(
      "Achtung! Du bist nicht angemeldet und wirst daher die Kartenauswahl " +
        "nicht zur Datenbank schicken können. Bitte stelle sicher, dass du " +
        'in demselben Browser aktiv bei "Streamadmin" angemeldet bist.'
    );
  }
}

/**
 * Initialize the auth lifecycle (if available) and then warn once on this
 * page if there is clearly no valid session.
 *
 * This keeps auth centralized in script-auth.js and only consumes its state
 * from the mapvote overlay.
 */
function mvInitAuthGuard() {
  try {
    if (typeof authInitLifecycle === "function") {
      // Ensure global auth lifecycle has run at least once
      authInitLifecycle()
        .then(function () {
          mvWarnIfNoAuthSession();
        })
        .catch(function (err) {
          console.warn(
            "[mapvote] mvInitAuthGuard: authInitLifecycle failed",
            err
          );
          // If auth bootstrap failed, do not spam the user with warnings.
        });
    } else {
      // Auth system not present; nothing to guard here.
    }
  } catch (e) {
    console.warn("[mapvote] mvInitAuthGuard: failed", e);
  }
}
