// GLOBAL VARIABLES  ---------------------------------------------------------
let viewportWidth = window.innerWidth; // Window Width
let viewportHeight = window.innerHeight; // Window Height
let timeConversionFlag = false;

// RUN ON PAGE LOAD ----------------------------------------------------------
$(document).ready(function () {
  document.addEventListener("supabase:ready", insertTeamsToNav, { once: true });
  prepGlitchEffect();
  footerMarquee();
  setupMirrorClick();
  toggleMobileMenu();
  handleSubmenusOnMobile();
  hideWebflowBadge();
});

// RUN ON WINDOW RESIZE ------------------------------------------------------
$(window).resize(
  debounce(function () {
    /* ... */
  }, 250)
);

// RUN ON SCROLL -------------------------------------------------------------
$(window).scroll(
  debounce(function () {
    /* ... */
  }, 100)
);

// =============================================================================
// [GLOBAL UTILITY FUNCTIONS]
// =============================================================================

// DEBOUNCE FUNCTION  --------------------------------------------------------
function debounce(func, wait, immediate) {
  var timeout;
  return function () {
    var context = this,
      args = arguments;
    clearTimeout(timeout);
    timeout = setTimeout(function () {
      timeout = null;
      if (!immediate) func.apply(context, args);
    }, wait);
    if (immediate && !timeout) func.apply(context, args);
  };
}

function indexBy(arr, key) {
  const m = {};
  (arr || []).forEach((o) => {
    const k = o && o[key];
    if (k != null) m[k] = o;
  });
  return m;
}

function groupBy(arr, fn) {
  const m = {};
  (arr || []).forEach((o) => {
    const k = fn(o);
    if (!m[k]) m[k] = [];
    m[k].push(o);
  });
  return m;
}

function mapPlayersToTeams(teams) {
  const map = {};
  (teams || []).forEach((t) => {
    if (t.p1_slug) map[t.p1_slug] = t;
    if (t.p2_slug) map[t.p2_slug] = t;
  });
  return map;
}

function setText($el, val) {
  if (!$el || $el.length === 0) return;
  $el.text(val == null ? "" : String(val));
}

/**
 * Safe text setter:
 * Only set if element exists and value is not null/undefined.
 */
function setTextIfExists($el, value) {
  if (!$el || !$el.length) return;
  if (value === undefined || value === null) return;
  $el.text(value);
}

/**
 * Safe attribute setter:
 * Only set if element exists and value is not empty.
 */
function setAttrIfExists($el, attr, value) {
  if (!$el || !$el.length) return;
  if (value === undefined || value === null || value === "") return;
  $el.attr(attr, value);
}

function num(v) {
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

function isFiniteNum(v) {
  const n = Number(v);
  return Number.isFinite(n);
}

function fixed(v, d) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "0";
  return n.toFixed(d || 0);
}

function cmp(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Return the value of ?slug=... in the current URL, lowercased.
 * Used on the team detail page but generic enough for any "detail by slug" page.
 */
function getSlugFromUrl() {
  var params = new URLSearchParams(window.location.search);
  var s = params.get("slug");
  if (!s) return null;
  return String(s).trim().toLowerCase();
}

/**
 * Simple redirect to the team overview page.
 * Kept generic-ish in case we ever alias /teams somewhere else.
 */
function goTeamsOverview() {
  window.location.href = "/teams";
}

// ============================================================================
// [GLOBAL HELPERS SHARED ACROSS PAGES]
// ============================================================================

/**
 * nowUtcMs
 * Wrapper for current timestamp (ms).
 * We keep it as its own function because multiple modules call it.
 */
function nowUtcMs() {
  return Date.now();
}

/**
 * isNonEmpty
 * True if string-like value has non-whitespace content.
 */
function isNonEmpty(s) {
  return !!(s && String(s).trim().length);
}

/**
 * ytEmbedUrl
 * Build a YouTube embed URL from a stored video identifier/URL fragment.
 * Extend here if DB ever stores full URLs instead of IDs.
 */
function ytEmbedUrl(vod_url) {
  return (
    "https://www.youtube-nocookie.com/embed/" + String(vod_url || "").trim()
  );
}

/**
 * Normalize a slug input that may be a string or an object with { slug }.
 */
function _extractSlug(input) {
  if (!input) return "";
  if (typeof input === "string") {
    return String(input)
      .trim()
      .replace(/^['"]|['"]$/g, "");
  }
  if (typeof input === "object" && input.slug != null) {
    return String(input.slug)
      .trim()
      .replace(/^['"]|['"]$/g, "");
  }
  return "";
}

/**
 * buildGameLink
 * Central place to generate deep links to a match detail page.
 * Accepts either a slug string or a game object with { slug }.
 */
function buildGameLink(gameOrSlug) {
  const slug = _extractSlug(gameOrSlug);
  return "/spiel?slug=" + encodeURIComponent(slug);
}

/**
 * buildTeamLink
 * Central place to generate deep links to a team detail page.
 * Accepts either a slug string or a team object with { slug }.
 */
function buildTeamLink(teamOrSlug) {
  const slug = _extractSlug(teamOrSlug);
  return "/team?slug=" + encodeURIComponent(slug);
}

// TIMESTAMP CONVERTER ------------------------------------------------------------
/**
 * Convert a Supabase timestamp into various German-formatted strings.
 *
 * Relative handling:
 *  - If the date is Yesterday/Today/Tomorrow:
 *      * "weekday-long" -> "Gestern" | "Heute" | "Morgen"
 *      * "date-short"   -> "Gestern" | "Heute" | "Morgen"
 *      * "date-long"    -> "Gestern" | "Heute" | "Morgen"
 *      * "datetime"     -> "Gestern, 20:00 Uhr" | "Heute, 20:00 Uhr" | "Morgen, 20:00 Uhr"
 *      * "time"         -> unaffected (e.g., "20:00 Uhr")
 *      * "weekday-short"-> unaffected (keep locale's "Mo." etc.)
 *
 * Formats:
 *  - "time"          -> "20:00 Uhr"
 *  - "weekday-long"  -> "Donnerstag"
 *  - "weekday-short" -> "Do."       (keep locale punctuation; no stripping)
 *  - "date-short"    -> "20. Nov."
 *  - "date-long"     -> "20. November"
 *  - "datetime"      -> "20. November, 20:00 Uhr"
 *
 * @param {string|number|Date} ts
 * @param {"time"|"weekday-long"|"weekday-short"|"date-short"|"date-long"|"datetime"} format
 * @returns {string}
 */
function convertDateTime(ts, format) {
  if (!ts) return "";
  var d = ts instanceof Date ? ts : new Date(ts);
  if (isNaN(d.getTime())) return "";

  // Helpers ----------------------------------------------------------
  var startOfDay = function (date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  };

  var relativeLabel = (function () {
    // Compare in local time (Europe/Berlin for your environment)
    var todayStart = startOfDay(new Date());
    var thatStart = startOfDay(d);
    var diffMs = thatStart.getTime() - todayStart.getTime();
    var dayDiff = Math.round(diffMs / 86400000); // 86_400_000 ms in a day

    if (dayDiff === -1) return "Gestern";
    if (dayDiff === 0) return "Heute";
    if (dayDiff === 1) return "Morgen";
    return null;
  })();

  // Core formatters ---------------------------------------------------
  var formatTime = function (dateObj) {
    var t = dateObj.toLocaleTimeString("de-DE", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    return t + " Uhr";
  };

  var formatWeekdayLong = function (dateObj) {
    return dateObj.toLocaleDateString("de-DE", { weekday: "long" });
  };

  var formatWeekdayShort = function (dateObj) {
    // Keep locale's punctuation (e.g., "Mo.")
    return dateObj.toLocaleDateString("de-DE", { weekday: "short" });
  };

  var formatDateShort = function (dateObj) {
    return dateObj.toLocaleDateString("de-DE", {
      day: "2-digit",
      month: "short",
    }); // "20. Nov."
  };

  var formatDateLong = function (dateObj) {
    // Keep the day period, then month long; no year per spec
    var day = dateObj.toLocaleDateString("de-DE", { day: "2-digit" });
    var month = dateObj.toLocaleDateString("de-DE", { month: "long" });
    return day + ". " + month; // "20. November"
  };

  // Switch with relative logic ---------------------------------------
  switch (format) {
    case "time": {
      // Never replaced by relative label
      return formatTime(d);
    }
    case "weekday-long": {
      return relativeLabel || formatWeekdayLong(d);
    }
    case "weekday-short": {
      // Keep short weekday as-is even for today/yesterday/tomorrow
      return formatWeekdayShort(d);
    }
    case "date-short": {
      return relativeLabel || formatDateShort(d);
    }
    case "date-long": {
      return relativeLabel || formatDateLong(d);
    }
    case "datetime-short": {
      var datePart = relativeLabel || formatDateShort(d);
      var timePart = formatTime(d);
      return datePart + ", " + timePart;
    }
    case "datetime": {
      var datePart = relativeLabel || formatDateLong(d);
      var timePart = formatTime(d);
      return datePart + ", " + timePart;
    }
    case "datetime-long": {
      var weekdayPart = formatWeekdayShort(d);
      var datePart = relativeLabel || formatDateLong(d);
      var timePart = formatTime(d);
      return weekdayPart + "., " + datePart + ", " + timePart;
    }
    default:
      console.warn("[convertDateTime] Unknown format:", format);
      return "";
  }
}

// ============================================================================
// [GAME SCORE HELPERS - SHARED]
// These help us figure out if a game has been played and what the score is,
// even if total scores are missing but per-map scores exist.
// ============================================================================

/**
 * decorateGameTotals(g)
 * Returns a copy of game g with guaranteed numeric-ish totals:
 * { t1_total, t2_total }
 *
 * Strategy:
 * 1. If t1_score_total / t2_score_total exist and are finite numbers, use them.
 * 2. Otherwise, derive totals by counting per-map wins (best-of-X style).
 *    We compare t1_score_mN vs t2_score_mN for each map and count maps won.
 */
function decorateGameTotals(g) {
  if (!g || typeof g !== "object") return g || {};

  // read direct totals
  let t1 = isFiniteNum(g.t1_score_total) ? num(g.t1_score_total) : null;
  let t2 = isFiniteNum(g.t2_score_total) ? num(g.t2_score_total) : null;

  // if missing, try to infer totals from per-map win counts
  if (t1 === null || t2 === null) {
    // collect all map score pairs [t1_mX, t2_mX]
    const mapPairs = [
      [g.t1_score_m1, g.t2_score_m1],
      [g.t1_score_m2, g.t2_score_m2],
      [g.t1_score_m3, g.t2_score_m3],
      [g.t1_score_m4, g.t2_score_m4],
      [g.t1_score_m5, g.t2_score_m5],
    ];

    // did we get *any* real map score pair?
    let anyMapHasScore = false;
    for (let i = 0; i < mapPairs.length; i++) {
      const a = mapPairs[i][0];
      const b = mapPairs[i][1];
      if (isFiniteNum(a) && isFiniteNum(b)) {
        anyMapHasScore = true;
        break;
      }
    }

    if (anyMapHasScore) {
      let w1 = 0;
      let w2 = 0;
      mapPairs.forEach(([a, b]) => {
        if (!isFiniteNum(a) || !isFiniteNum(b)) return;
        if (a > b) w1++;
        else if (b > a) w2++;
      });
      t1 = w1;
      t2 = w2;
    }
  }

  return Object.assign({}, g, {
    t1_total: t1,
    t2_total: t2,
  });
}

/**
 * isPlayed(g)
 * Returns true if at least one team has a score > 0
 * (meaning: game actually took place / was scored).
 */
function isPlayed(g) {
  var t1 = isFiniteNum(g.t1_total) ? Number(g.t1_total) : 0;
  var t2 = isFiniteNum(g.t2_total) ? Number(g.t2_total) : 0;
  return t1 > 0 || t2 > 0;
}

// DETERMINE AND HIGHLIGHT WINNER ----------------------------------------------
function highlightWinner(spielElement, scoreT1, scoreT2) {
  if (scoreT1 > scoreT2) {
    // Team 1 hat gewonnen, füge .is--w1 hinzu
    spielElement.addClass("is--w1").removeClass("is--w2");
  } else if (scoreT1 < scoreT2) {
    // Team 2 hat gewonnen, füge .is--w2 hinzu
    spielElement.addClass("is--w2").removeClass("is--w1");
  } else {
    return;
  }
}

// ============================================================================
// [TEAM VIEW HELPERS - SHARED]
// Build a render-friendly "team card" bundle from raw team row + players.
// ============================================================================

/**
 * buildTeamViewModel(team, playersBySlug)
 *
 * @param {object} team - row from teams table (slug, tname, tag, group, p1_slug, p2_slug, ...)
 * @param {object} playersBySlug - lookup { playerSlug: { slug, pname, ... }, ... }
 * @returns {object} view model:
 *   {
 *     slug,
 *     tname,
 *     tag,
 *     group,
 *     playerLine,   // "p1 & p2"
 *     logo72,       // 72px flat logo URL
 *     logo150,      // 150px isolated logo URL
 *     bgUrl         // team background URL
 *   }
 */
function buildTeamViewModel(team, playersBySlug) {
  if (!team || typeof team !== "object") return {};

  var p1 = playersBySlug[team.p1_slug] || {};
  var p2 = playersBySlug[team.p2_slug] || {};

  return {
    slug: team.slug || "",
    tname: team.tname || "",
    tag: team.tag || "",
    group: team.group || "",
    playerLine: buildPlayerLine(p1.pname || "", p2.pname || ""),
    logo72: buildAssetUrl("teams", team.slug, "logo-72-flat"),
    logo150: buildAssetUrl("teams", team.slug, "logo-150-iso"),
    bgUrl: buildAssetUrl("teams", team.slug, "teambg"),
  };
}

function setupMirrorClick() {
  $(document).on("click", "[data-mirror-trigger]", function (event) {
    if (event && typeof event.preventDefault === "function") {
      event.preventDefault();
    }

    var $trigger = $(this);
    var triggerValue = $trigger.attr("data-mirror-trigger");

    // Click corresponding tab
    var $targetElement = $(
      '[data-mirror-target="' + String(triggerValue) + '"]'
    ).first();

    if ($targetElement.length) {
      $targetElement.trigger("click");
    }

    // Update active state on the left menu
    tfSetActiveMirrorMenu(triggerValue);
  });
}

// HIDE WEBFLOW BRANDING  ---------------------------------------------------
function hideWebflowBadge() {
  $(".w-webflow-badge").attr("style", function (i, s) {
    return (s || "") + "display: none !important;";
  });
}

// =============================================================================
// [GLITCH ANIMATION]
// =============================================================================

// PREPARE GLITCH ELEMENTS  --------------------------------------------------
function prepGlitchEffect() {
  $("[data-glitch]").each(function () {
    // Read the text inside the current element
    var glitchText = $(this).text();
    // Set the 'data-text' attribute with the text read
    $(this).attr("data-text", glitchText);
    // Give the element the CSS class
    $(this).addClass("glitch");
  });
}

// BASIC ANIMATION  ----------------------------------------------------------
window.onload = function () {
  const t = document.querySelectorAll(".glitch.text.split-effect");
  [].forEach.call(t, (t) => {
    console.log(t);
    var e = document.createElement("canvas"),
      a = e.getContext("2d"),
      n = t,
      o = n.getContext("2d");
    function h() {
      var t = 100 + 100 * Math.random(),
        a = 50 + 50 * Math.random(),
        n = Math.random() * e.width,
        h = Math.random() * e.height,
        i = n + (40 * Math.random() - 20),
        l = h + (30 * Math.random() - 15);
      o.clearRect(n, h, t, a),
        (o.fillStyle = "#4a6"),
        o.drawImage(e, n, h, t, a, i, l, t, a);
    }
    setInterval(function () {
      !(function () {
        (e.width = n.width),
          (e.height = n.height),
          a.clearRect(0, 0, a.width, a.height),
          (a.textAlign = "center"),
          (a.textBaseLine = "middle"),
          (a.font = t.dataset.font + " serif"),
          (a.fillStyle = t.dataset.color),
          a.fillText(t.dataset.text, e.width / 2, e.height / 2),
          o.clearRect(0, 0, n.width, n.height),
          o.drawImage(e, 0, 0);
        for (var i = 10; i--; ) h();
      })();
    }, 1e3 / 15);
  });
};

// =============================================================================
// [FOOTER]
// =============================================================================

function footerMarquee() {
  var $inner = $(".marquee_inner");
  var $marquee = $(".marquee");

  // Inhalt duplizieren
  $inner.append($inner.html());
  $inner.append($inner.html());
  $inner.append($inner.html());

  // Gesamtbreite der Elemente berechnen (nach dem Duplizieren)
  var innerWidth = 0;
  $inner.children(".marquee_sponsor").each(function () {
    innerWidth += $(this).outerWidth(true);
  });

  // Breite des Inhalts setzen
  $inner.css("width", innerWidth);

  // Animation anpassen
  var duration = innerWidth / 100; // Geschwindigkeit anpassen (100 px/s)
  $inner.css("animation-duration", duration + "s");
}

// =============================================================================
// [HELP OVERLAYS]
// =============================================================================

// HELP OVERLAYS  --------------------------------------------------------------
function toggleHelpOverlay() {
  // JSON-Daten von der angegebenen URL laden
  var jsonData = [
    {
      titel: "Wins",
      text: "Wie viele Spiele hat dieses Team gewonnen? Wichtigstes Kriterium für die Qualifikation.",
      id: "win",
    },
    {
      titel: "Losses",
      text: "Wie viele Spiele hat dieses Team verloren?",
      id: "loss",
    },
    {
      titel: "Rundendifferenz",
      text: "Differenz der gewonnenen und verlorenen Einzelrunden.",
      id: "runden",
    },
    {
      titel: "HLTV Rating 2.0",
      text: "Das von HLTV entwickelte Rating bewertet die Gesamtleistung eines Spielers. Dazu werden allerhand Faktoren berücksichtigt wie Schaden, KDR, Impact und vieles mehr. Der Durchschnittswert liegt bei 1.00, alles darüber ist gut, alles ab 1.20 herausragend.",
      id: "hltv",
    },
    {
      titel: "Kill/Death-Ratio",
      text: "Verhältnis von Eliminierungen zu Toden für beide Spieler.",
      id: "kdr",
    },
    {
      titel: "Average Damage per Round",
      text: "Durchschnittliche Schadenspunkte beider Spieler pro Runde.",
      id: "adr",
    },
    {
      titel: "Headshot Percentage",
      text: "Gibt an, wie viele Eliminierungen dieses Spielers durch einen Kopfschuss passierten.",
      id: "hs",
    },
    {
      titel: "Utility Rating",
      text: "Wie gut ist dieser Spieler im Umgang mit Granaten? Für die Berechnung unseres Utility Ratings nehmen wir als Grundlage die Anzahl der geflashten Gegner und Teammates sowie den Utility Damage.",
      id: "utility",
    },
    {
      titel: "Entry Rating",
      text: "Sagt aus, wie oft Eröffnungsduelle, andem der Spieler beteiligt war, gewonnen wurden. Bei unter 3% gibt es einen Punkt, ab 20% volle 10.",
      id: "entries",
    },
    {
      titel: "Clutch Rating",
      text: "Gibt an, wie gut der Spieler in Clutch Situationen (1vX) ist. Bei unter 5% Erfolgsquote gibt es einen Punkt, ab 30% die vollen 10.",
      id: "clutches",
    },
    {
      titel: "Medaillenpunkte",
      text: "Für jede gewonnene Goldmedaille gibt es drei Punkte, für Silber zwei, für Bronze einen Punkt.",
      id: "medaillen",
    },
  ];
  $(".tabelle").each(function () {
    var $tabelle = $(this);

    $tabelle.find(".statistics_column").hover(
      function () {
        var $this = $(this);
        var dataHelp = $this.attr("data-help");

        // Passenden Eintrag aus JSON finden
        var entry = jsonData.find(function (item) {
          return item.id === dataHelp;
        });

        if (entry) {
          var $keyTitle = $tabelle.find(".tabelle_key-title");
          var $keyParagraph = $tabelle.find(".tabelle_key-paragraph");
          var $tabelleKey = $tabelle.find(".tabelle_key");

          $keyTitle.text(entry.titel);
          $keyParagraph.text(entry.text);

          // Positionierung der .tabelle_key
          var columnOffset = $this.offset();
          var tabelleOffset = $tabelle.offset();
          var columnRight = columnOffset.left + $this.outerWidth();
          var relativeLeft = columnRight - tabelleOffset.left;

          $tabelleKey.css({
            position: "absolute",
            // top: columnOffset.top - tabelleOffset.top,
            left: relativeLeft - $tabelleKey.outerWidth(),
          });

          // Klasse hinzufügen
          $tabelleKey.addClass("is--active");
        }
      },
      function () {
        // Klasse entfernen
        $tabelle.find(".tabelle_key").removeClass("is--active");
      }
    );
  });
}

// =============================================================================
// ADJUST SPIELE HEIGHT
// =============================================================================
function adjustSpieleHeight() {
  var $spielList = $(".spiel_list");

  // Remove any previously set inline height
  $spielList.css("height", "");

  // Calculate and set the new height
  var newHeight = $spielList[0].scrollHeight + 60;
  $spielList.height(newHeight);
}

// [NAVIGATION]
// =============================================================================

function closeAllMobileSubmenus() {
  $(".submenu_mask.is--active-mobile").removeClass("is--active-mobile");
  $(".navitem_expand-button.is--active-mobile").removeClass(
    "is--active-mobile"
  );
}

function handleSubmenusOnMobile() {
  $(".navitem_expand-button").on("click", function () {
    // Check if the clicked button is already active
    var isActive = $(this).hasClass("is--active-mobile");

    // Close all submenus
    closeAllMobileSubmenus();

    // If the clicked button was active, don't reopen it
    if (isActive) {
      return;
    } else {
      // Otherwise, open the current submenu
      $(this).addClass("is--active-mobile");
      $(this).siblings(".submenu_mask").addClass("is--active-mobile");
    }
  });
}

function toggleMobileMenu() {
  $("#nav-burger, .submenu_item").on("click", function () {
    // Toggle the "is--active" class for #nav and #nav-burger
    $("#nav, #nav-burger").toggleClass("is--active");
  });
}

async function insertTeamsToNav() {
  try {
    // Pull from the new global preloaded layer (or fallback to fetching if not ready)
    var teams = await fetchTeams();
    if (!Array.isArray(teams) || teams.length === 0) {
      console.warn("[insertTeamsToNav] No teams available to render.");
      return;
    }

    // Sort by tname for stable nav order
    var sorted = teams.slice().sort(function (a, b) {
      return String(a.tname || "").localeCompare(String(b.tname || ""));
    });

    // Group by "group" (expects letters like "a", "b", etc.)
    var byGroup = sorted.reduce(function (acc, t) {
      var g = String(t.group || "")
        .trim()
        .toLowerCase();
      if (!acc[g]) acc[g] = [];
      acc[g].push(t);
      return acc;
    }, {});

    // Render into each nav group list
    $(".subteams_list").each(function () {
      var $list = $(this);
      var groupKeyFull = $list.attr("data-base"); // e.g. "group-a"
      if (!groupKeyFull) return;

      var m = /^group-(.+)$/.exec(groupKeyFull);
      if (!m) return;

      var letter = m[1].toLowerCase();
      var groupTeams = byGroup[letter] || [];

      // Take the first .submenu_item as template
      var $template = $list.children(".submenu_item").first();
      if ($template.length === 0) {
        console.warn(
          "[insertTeamsToNav] Missing .submenu_item template for",
          groupKeyFull
        );
        return;
      }

      // Clear and (re)build
      $list.empty();

      groupTeams.forEach(function (team) {
        var $clone = $template.clone(true, true);

        // data attributes on the anchor
        $clone.attr("data-team-slug", team.slug || "");

        // Fill team name into child with data-base="tname"
        var $nameEl = $clone.find('[data-base="tname"]').first();
        if ($nameEl.length) {
          $nameEl.text(team.tname || "Team");
        } else {
          // Fallback: write to anchor text if template ever changes
          $clone.text(team.tname || "Team");
        }

        // Fill tag into child with data-base="tag"
        var $tagEl = $clone.find('[data-base="tag"]').first();
        if ($tagEl.length) {
          $tagEl.text(team.tag || "");
        }

        // Prefer the global URL helper if present
        if (typeof buildTeamUrl === "function") {
          $clone.attr("href", buildTeamUrl(team.slug));
        } else {
          $clone.attr("href", "/team?slug=" + (team.slug || ""));
        }

        $list.append($clone);
      });
    });
  } catch (err) {
    console.error("[insertTeamsToNav] Failed to build nav:", err);
  }
}
