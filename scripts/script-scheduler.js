// =============================================================================
// Boot
// =============================================================================

// [STATE] -------------------------------------------------------------------
// Scheduler-local namespace (Terminfinder-specific, not used in global auth).
window.TF = window.TF || {
  supabase: null,
  session: null,
  user: null,
  player: null,
  team: null,
};
var TF = window.TF;

// Optional alias so existing code using tfStatus keeps working:
function tfStatus(message, type) {
  return authStatus(message, type); // authStatus from gg-auth.js
}

// [DATE CONFIG] ------------------------------------------------------
/**
 * Global configuration for the tournament calendar.
 * All dates are in local time (midnight).
 */

// Group stage
var TF_CAL_GROUP_START = new Date(2026, 0, 5); // 05.01.2026
var TF_CAL_GROUP_END = new Date(2026, 1, 20); // 20.02.2026

// K.O. stage
var TF_CAL_KO_START = new Date(2026, 1, 23); // 23.02.2026
var TF_CAL_KO_END = new Date(2026, 2, 1); // 01.03.2026

// Combined overall range (used e.g. for availability calendar)
var TF_CAL_START_DATE = new Date(TF_CAL_GROUP_START.getTime());
var TF_CAL_END_DATE = new Date(TF_CAL_KO_END.getTime());

// Default evening slots within the active phase (18:00 and 20:00)
var TF_CAL_DEFAULT_SLOTS = [
  { hour: 18, minute: 0 },
  { hour: 20, minute: 0 },
];

// Minimum days in the future a group-stage suggestion must be
var TF_CAL_GROUP_MIN_DAYS_IN_FUTURE = 5;

// [DOC READY] ---------------------------------------------------------------
$(document).ready(function () {
  initSchedulerPage();
});

// [INITIALIZE SCHEDULER PAGE] -----------------------------------------------
async function initSchedulerPage() {
  tfInitMirrorMenuFromActiveTab();

  // Register scheduler-specific reaction to auth changes
  if (window.AppAuth) {
    AppAuth.onAuthStateChange = schedulerOnAuthStateChange;
  }

  try {
    // Global auth bootstrap from gg-auth.js
    await authInitLifecycle();
  } catch (e) {
    console.error("[scheduler] auth bootstrap failed:", e);
    tfStatus("Verbindungsfehler. Bitte Seite neu laden.", "error");
    return;
  }

  // Page-specific click bindings (can differ on other pages)
  tfWireAuthUI();

  // Build calendar structure for availability selection (if not already built)
  tfInitCalendarStructure();
}

// =============================================================================
// General Helper Functions
// =============================================================================

// [UNLOAD WARNING] -----------------------------------------------------------
window.addEventListener("beforeunload", function (e) {
  try {
    if (!TF || !TF._suggestorDirty) return;
  } catch (_) {
    return;
  }

  var msg =
    "Du hast ungespeicherte Änderungen. Bist du sicher? Nicht gespeicherte Daten gehen verloren.";
  e.preventDefault();
  e.returnValue = msg;
  return msg;
});

// [TAB HELPERS] --------------------------------------------------------------
function tfActivateTab(tabName) {
  if (!tabName) return false;
  try {
    var safeName = String(tabName);
    var $link = $('.w-tab-link[data-w-tab="' + safeName + '"]').first();
    if ($link.length === 0) {
      $link = $('.tf-tablink[data-w-tab="' + safeName + '"]').first();
    }
    if ($link.length) {
      $link.trigger("click");

      // Sync mirror menu state
      var mirrorValue = $link.attr("data-mirror-target");
      if (mirrorValue) {
        tfSetActiveMirrorMenu(mirrorValue);
      }
      return true;
    }
  } catch (e) {
    console.warn("[terminfinder] tfActivateTab error:", e);
  }
  return false;
}

// [MIRROR MENU HELPERS] ------------------------------------------------------

// Set active state on the left menu (tf-menu)
function tfSetActiveMirrorMenu(triggerValue) {
  try {
    var $menuLinks = $(".tf-menu-link");
    $menuLinks.removeClass("is--active");

    if (!triggerValue && triggerValue !== 0) {
      return;
    }

    var safeValue = String(triggerValue);
    var $active = $menuLinks
      .filter('[data-mirror-trigger="' + safeValue + '"]')
      .first();

    if ($active.length) {
      $active.addClass("is--active");
    }
  } catch (e) {
    console.warn("[terminfinder] tfSetActiveMirrorMenu error:", e);
  }
}

// Initialize active state once based on the currently active tab
function tfInitMirrorMenuFromActiveTab() {
  try {
    var $currentTab = $(
      ".tf-tablink.w--current[data-mirror-target], " +
        '.tf-tablink[aria-selected="true"][data-mirror-target]'
    ).first();

    if (!$currentTab.length) return;

    var mirrorValue = $currentTab.attr("data-mirror-target");
    if (mirrorValue) {
      tfSetActiveMirrorMenu(mirrorValue);
    }
  } catch (e) {
    console.warn("[terminfinder] tfInitMirrorMenuFromActiveTab error:", e);
  }
}

// [MIRROR CLICK BINDINGS] ----------------------------------------------------

// Keep menu in sync when tabs are clicked directly
$(document).on("click", ".tf-tablink[data-mirror-target]", function () {
  var mirrorValue = $(this).attr("data-mirror-target");
  if (mirrorValue) {
    tfSetActiveMirrorMenu(mirrorValue);
  }
});

// [PLAYER HELPERS] -----------------------------------------------------------
function tfGetTeamPlayerSlugs() {
  var slugs = [];

  if (typeof TF !== "undefined" && TF && TF.team) {
    if (TF.team.p1_slug) slugs.push(String(TF.team.p1_slug));
    if (TF.team.p2_slug) slugs.push(String(TF.team.p2_slug));
  }

  if (typeof TF !== "undefined" && TF && TF.player && TF.player.slug) {
    var playerSlug = String(TF.player.slug);
    if (playerSlug && slugs.indexOf(playerSlug) === -1) {
      slugs.push(playerSlug);
    }
  }

  return slugs
    .map(function (s) {
      return s == null ? "" : String(s);
    })
    .filter(function (s) {
      return s !== "";
    });
}

// [CALENDAR BUILDER – GLOBAL] -----------------------------------------------
/**
 * Build weekly calendar structure inside a root element using templates.
 * Options:
 *  - root: jQuery or selector for the calendar container
 *  - weekSelector: selector to find the week template inside root
 *  - daySelector: selector to find the day template inside the week template
 *  - weekTitleSelector: selector inside week to put the "Woche X" title
 *  - dayTitleSelector: selector inside day to put the formatted day title
 *  - mode:
 *      "availability"     → kompletter Zeitraum GROUP_START..KO_END
 *      "suggestor-group"  → Gruppenspiele (dynamischer Start, Ende = GROUP_END)
 *      "suggestor-ko"     → K.O.-Spiele (KO_START..KO_END)
 *
 * Markiert Tage mit .is--unavailable, wenn sie:
 *  - außerhalb der relevanten Phase liegen,
 *  - zwischen GROUP_END und KO_START (implizite Pause) liegen (Availability),
 *  - in der Vergangenheit liegen,
 *  - oder (nur Gruppenspiele) innerhalb von TF_CAL_GROUP_MIN_DAYS_IN_FUTURE Tagen
 *    in der Zukunft liegen.
 *
 * Setzt data-day = Timestamp (ms, lokales Midnight) auf jedem Tag.
 */
function tfBuildWeeklyCalendar(opts) {
  if (!opts) return;
  var $root = opts.root instanceof $ ? opts.root : $(opts.root);
  if (!$root.length) return;

  // Obtain / cache prototypes for week + day
  var $weekProto = $root.data("tf-cal-week-proto");
  var $dayProto = $root.data("tf-cal-day-proto");

  if (!$weekProto || !$dayProto) {
    var $weekTemplate = $root.find(opts.weekSelector).first();
    if (!$weekTemplate.length) return;

    var $dayTemplate = $weekTemplate.find(opts.daySelector).first();
    if (!$dayTemplate.length) return;

    $weekProto = $weekTemplate.clone(true);
    $dayProto = $dayTemplate.clone(true);

    $root.data("tf-cal-week-proto", $weekProto);
    $root.data("tf-cal-day-proto", $dayProto);
  }

  // Clear all current weeks from root
  $root.empty();

  // Normalized phase boundaries (local midnight)
  var groupStart = new Date(TF_CAL_GROUP_START.getTime());
  groupStart.setHours(0, 0, 0, 0);
  var groupEnd = new Date(TF_CAL_GROUP_END.getTime());
  groupEnd.setHours(0, 0, 0, 0);
  var koStart = new Date(TF_CAL_KO_START.getTime());
  koStart.setHours(0, 0, 0, 0);
  var koEnd = new Date(TF_CAL_KO_END.getTime());
  koEnd.setHours(0, 0, 0, 0);

  // Overall range (for availability calendar)
  var overallStart = new Date(groupStart.getTime());
  var overallEnd = new Date(koEnd.getTime());

  var MS_PER_DAY = 24 * 60 * 60 * 1000;

  // Today baseline (local midnight)
  var today = new Date();
  today.setHours(0, 0, 0, 0);

  // Determine render range depending on mode
  var mode = String(opts.mode || "availability");
  var rangeStart;
  var rangeEnd;

  if (mode === "suggestor-group") {
    // Start mit aktueller Woche (falls schon in/ nach Gruppnphase),
    // sonst mit Woche von GROUP_START
    var baseStart =
      today > groupStart
        ? new Date(today.getTime())
        : new Date(groupStart.getTime());
    rangeStart = baseStart;
    rangeEnd = new Date(groupEnd.getTime());
  } else if (mode === "suggestor-ko") {
    rangeStart = new Date(koStart.getTime());
    rangeEnd = new Date(koEnd.getTime());
  } else {
    // Availability calendar: kompletter Zeitraum GROUP_START..KO_END
    rangeStart = new Date(overallStart.getTime());
    rangeEnd = new Date(overallEnd.getTime());
  }

  // Optional minimum future date for group-stage suggestor
  var minFutureDate = null;
  if (
    mode === "suggestor-group" &&
    typeof TF_CAL_GROUP_MIN_DAYS_IN_FUTURE === "number"
  ) {
    minFutureDate = new Date(
      today.getTime() + TF_CAL_GROUP_MIN_DAYS_IN_FUTURE * MS_PER_DAY
    );
  }

  // Compute first Monday intersecting [rangeStart, rangeEnd]
  var firstWeekStart = new Date(rangeStart.getTime());
  var weekday = (firstWeekStart.getDay() + 6) % 7; // 0=Mon
  firstWeekStart.setDate(firstWeekStart.getDate() - weekday);

  var weekStart = new Date(firstWeekStart.getTime());

  while (true) {
    var weekEnd = new Date(weekStart.getTime());
    weekEnd.setDate(weekEnd.getDate() + 6);

    // Stop once we are beyond the configured range
    if (weekStart > rangeEnd && weekEnd > rangeEnd) break;

    // Only render weeks that overlap the render range
    if (weekEnd >= rangeStart && weekStart <= rangeEnd) {
      var $week = $weekProto.clone(true);

      // Week title "Woche NN"
      if (opts.weekTitleSelector) {
        var isoWeek = tfGetIsoWeek(weekStart);
        $week
          .find(opts.weekTitleSelector)
          .first()
          .text("Woche " + (isoWeek != null ? isoWeek : ""));
      }

      // Remove original inner days
      $week.find(opts.daySelector).remove();

      // Create 7 days Mon..Sun
      for (var i = 0; i < 7; i++) {
        var dayDate = new Date(weekStart.getTime() + i * MS_PER_DAY);
        var $day = $dayProto.clone(true);

        $day.attr("data-day", String(dayDate.getTime()));

        if (opts.dayTitleSelector) {
          $day
            .find(opts.dayTitleSelector)
            .first()
            .text(tfFormatCalendarDayTitle(dayDate));
        }

        var isUnavailable = false;

        if (mode === "availability") {
          // Voller Zeitraum: GROUP_START..KO_END, inkl. Pause
          var beforeOverall = dayDate < overallStart;
          var afterOverall = dayDate > overallEnd;
          var betweenPhases = dayDate > groupEnd && dayDate < koStart;
          var isPast = dayDate < today;

          if (beforeOverall || afterOverall || betweenPhases || isPast) {
            isUnavailable = true;
          }
        } else if (mode === "suggestor-group") {
          // Gruppenspiele: nur GROUP_START..GROUP_END
          var beforeGroup = dayDate < groupStart;
          var afterGroup = dayDate > groupEnd;
          var isPastGroup = dayDate < today;

          if (beforeGroup || afterGroup || isPastGroup) {
            isUnavailable = true;
          }

          if (
            !isUnavailable &&
            minFutureDate &&
            dayDate >= today &&
            dayDate < minFutureDate
          ) {
            // zu nah an "jetzt" für neue Vorschläge
            isUnavailable = true;
          }
        } else if (mode === "suggestor-ko") {
          // K.O.-Spiele: nur KO_START..KO_END
          var beforeKo = dayDate < koStart;
          var afterKo = dayDate > koEnd;
          var isPastKo = dayDate < today;

          if (beforeKo || afterKo || isPastKo) {
            isUnavailable = true;
          }
        }

        if (isUnavailable) {
          $day.addClass("is--unavailable");
        }

        $week.append($day);
      }

      $root.append($week);
    }

    weekStart.setDate(weekStart.getDate() + 7);
  }
}

// =============================================================================
// Authentication
// =============================================================================

// [AUTH STATE HANDLING (SCHEDULER)] ----------------------------------------
async function schedulerOnAuthStateChange(state) {
  var isSignedIn = !!state.isSignedIn;
  var hasPlayer = !!state.player;

  // Mirror AppAuth data into scheduler-local TF for existing code
  TF.supabase = AppAuth.supabase;
  TF.session = AppAuth.session;
  TF.user = AppAuth.user;
  TF.player = AppAuth.player;
  TF.team = AppAuth.team;

  // Scheduler-specific root toggle (Terminfinder UI)
  var $root = $("#terminfinder");
  if ($root.length) {
    $root.toggleClass("is--signed-in", isSignedIn && hasPlayer);
  }

  // If user is not properly signed in / whitelisted, nothing more to do
  if (!isSignedIn || !hasPlayer) {
    return;
  }

  // Populate games tab (list + progress) if helpers exist
  if (typeof tfRefreshGamesSection === "function") {
    try {
      await tfRefreshGamesSection();
    } catch (e) {
      console.warn("[scheduler] tfRefreshGamesSection failed:", e);
    }
  }

  // Ensure calendar DOM exists and wire availability UI if present
  if (typeof tfInitCalendarStructure === "function") {
    var $cal = $("#calendar");
    if ($cal.length && !$cal.data("tf-cal-built")) {
      try {
        tfInitCalendarStructure();
      } catch (e) {
        console.warn("[scheduler] tfInitCalendarStructure failed:", e);
      }
    }
  }

  if (typeof tfWireAvailabilityUI === "function") {
    try {
      tfWireAvailabilityUI();
    } catch (e) {
      console.warn("[scheduler] tfWireAvailabilityUI failed:", e);
    }
  }

  if (typeof tfLoadAvailabilitiesAndPopulate === "function") {
    try {
      await tfLoadAvailabilitiesAndPopulate();
    } catch (e) {
      console.warn("[scheduler] tfLoadAvailabilitiesAndPopulate failed:", e);
    }
  }

  if (typeof tfUpdateProductionRoles === "function") {
    try {
      await tfUpdateProductionRoles();
    } catch (e) {
      console.warn("[scheduler] tfUpdateProductionRoles failed:", e);
    }
  }

  if (typeof tfApplyUrlEvents === "function") {
    try {
      tfApplyUrlEvents();
    } catch (e) {
      console.warn("[scheduler] tfApplyUrlEvents failed:", e);
    }
  }
}

// [AUTH UI WIRING] ----------------------------------------------------------
function tfWireAuthUI() {
  $(document).on("click", '[data-auth="button-login"]', async function (e) {
    e.preventDefault();
    await authOnLoginDiscord();
  });

  $(document).on("click", '[data-auth="button-logout"]', async function (e) {
    e.preventDefault();
    var $root = $("#terminfinder");
    if ($root.length) {
      $root.removeClass("is--signed-in").addClass("is--signed-out");
    }
    await authOnLogout();
  });
}

// =============================================================================
// Notifications
// =============================================================================
// [NOTIFICATIONS STATE] ------------------------------------------------------
TF._notifProducers = TF._notifProducers || [];

// [REGISTRATION] ------------------------------------------------------------
function tfRegisterNotificationProducer(fn) {
  if (typeof fn !== "function") return;
  if (TF._notifProducers.indexOf(fn) !== -1) return;
  TF._notifProducers.push(fn);
}

// [REFRESH] -----------------------------------------------------------------
function tfNotificationsRefresh() {
  try {
    var all = [];
    (TF._notifProducers || []).forEach(function (fn) {
      try {
        var res = fn && fn();
        if (Array.isArray(res)) all = all.concat(res);
      } catch (e) {
        console.warn("[terminfinder] notification producer failed:", e);
      }
    });

    // Deduplicate by id
    var seen = {};
    var list = [];
    (all || []).forEach(function (n, idx) {
      var id = n && n.id ? String(n.id) : "_idx_" + idx;
      if (seen[id]) return;
      seen[id] = true;
      list.push(n);
    });

    tfRenderNotifications(list);
  } catch (e) {
    console.warn("[terminfinder] tfNotificationsRefresh error:", e);
  }
}

// [RENDERER] -----------------------------------------------------------------
function tfRenderNotifications(list) {
  // Locate notifications pane + template card
  var $pane = $('.w-tab-pane[data-w-tab="Benachrichtigungen"]').first();
  if (!$pane.length) {
    $pane = $('[data-w-tab="Benachrichtigungen"]').first();
  }
  if (!$pane.length) return;

  var $tpl = $pane.find(".tf-section.tf-section-notification").first();
  if (!$tpl.length) return;

  var $container = $tpl.parent();
  var $emptyState = $pane.find('[data-notifications="empty"]').first();
  var $count = $('[data-notifications="count"]').first();

  // Always keep the original as hidden template
  $tpl.addClass("is--template").attr("hidden", true);

  // Remove previously rendered notifications, but keep the template
  $container.find(".tf-section.tf-section-notification").not($tpl).remove();

  // Clone list and sort so important notifications are shown first
  var items = Array.isArray(list) ? list.slice() : [];
  items.sort(function (a, b) {
    var aImp = !!(a && a.important);
    var bImp = !!(b && b.important);
    if (aImp === bImp) return 0;
    return aImp ? -1 : 1;
  });

  var count = items.length;

  // EMPTY STATE --------------------------------------------------------------
  if (count === 0) {
    // Hide counter completely
    if ($count.length) {
      $count.text("").addClass("is--hidden");
    }

    // Make sure the template stays hidden
    $tpl.attr("hidden", true);

    // Show empty-state element, if present
    if ($emptyState.length) {
      $emptyState.removeAttr("hidden");
    }

    return;
  }

  // NON-EMPTY STATE ----------------------------------------------------------
  // Show counter and set value
  if ($count.length) {
    $count.text(String(count)).removeClass("is--hidden");
  }

  // Hide empty-state element when we have notifications
  if ($emptyState.length) {
    $emptyState.attr("hidden", true);
  }

  // Render notifications
  items.forEach(function (n) {
    var $card = $tpl.clone(true);

    // Always start from a neutral state
    $card
      .removeAttr("hidden")
      .removeClass("is--template")
      .removeClass("is--important");

    setTextIfExists(
      $card.find('[data-notifications="title"]'),
      n && n.title ? String(n.title) : ""
    );
    setTextIfExists(
      $card.find('[data-notifications="description"]'),
      n && n.description ? String(n.description) : ""
    );

    if (n && n.important) {
      $card.addClass("is--important");
    }

    var $btn = $card.find('[data-notifications="button"]');
    $btn.off("click").on("click", function (e) {
      e.preventDefault();
      tfPerformNotificationAction(n && n.action);
    });

    // Insert after the template (or the last inserted card)
    $card.insertAfter($tpl);
    $tpl = $card;
  });
}

// [ACTIONS] -----------------------------------------------------------------
function tfPerformNotificationAction(action) {
  if (!action || typeof action !== "object") return;
  try {
    if (action.type === "switch-tab" && action.tab) {
      tfActivateTab(action.tab);
    }
  } catch (e) {
    console.warn("[terminfinder] tfPerformNotificationAction error:", e);
  }
}

// [AVAILABILITY NOTIFIER] -----------------------------------------------------
// Registers a producer that warns when no availability row exists.
function notifAvailabilityMissing() {
  try {
    if (!TF || !TF.player) return [];
    if (TF._availabilityRowId) return [];
    return [
      {
        id: "availability-missing",
        title: "Verfügbarkeiten fehlen",
        description:
          "Trage deine Verfügbarkeiten ein, damit wir passende Termine finden.",
        important: true,
        action: { type: "switch-tab", tab: "Verfügbarkeit" },
      },
    ];
  } catch (_) {
    return [];
  }
}
tfRegisterNotificationProducer(notifAvailabilityMissing);

// [GAMES THAT NEED REPLY NOTIFIER] ---------------------------------------------
function notifGamesReply() {
  try {
    if (!window.TF) return [];

    // Ensure player/role data is hydrated from preload (as required)
    if (typeof tfUpdateProductionRoles === "function") {
      try {
        tfUpdateProductionRoles();
      } catch (e) {
        console.warn(
          "[terminfinder] notifGamesReply tfUpdateProductionRoles failed:",
          e
        );
      }
    }
    if (typeof tfUpdatePlayerFromPreload === "function") {
      try {
        tfUpdatePlayerFromPreload();
      } catch (e) {
        console.warn(
          "[terminfinder] notifGamesReply tfUpdatePlayerFromPreload failed:",
          e
        );
      }
    }

    // Resolve team slug
    var teamSlugLower = null;
    if (TF.team && TF.team.slug) {
      teamSlugLower = String(TF.team.slug || "").toLowerCase();
    } else if (TF.player && TF.player.team_slug) {
      teamSlugLower = String(TF.player.team_slug || "").toLowerCase();
    }
    if (!teamSlugLower) return [];

    // Resolve team player slugs
    var teamPlayerSlugs = [];
    if (typeof tfGetTeamPlayerSlugs === "function") {
      var tmp = tfGetTeamPlayerSlugs() || [];
      if (Array.isArray(tmp)) teamPlayerSlugs = tmp;
    }

    // Load games
    var games = Array.isArray(TF._gamesForTeam) ? TF._gamesForTeam.slice() : [];
    if (
      !games.length &&
      window.__supabasePreload &&
      Array.isArray(window.__supabasePreload.games)
    ) {
      games = window.__supabasePreload.games.filter(function (g) {
        if (!g) return false;
        var t1 = String(g.t1_slug || "").toLowerCase();
        var t2 = String(g.t2_slug || "").toLowerCase();
        return t1 === teamSlugLower || t2 === teamSlugLower;
      });
    }
    if (!games.length) return [];

    // Suggestions cache
    var suggestionsByGameSlug = TF._suggestionsByGame || {};
    if (
      (!suggestionsByGameSlug || !Object.keys(suggestionsByGameSlug).length) &&
      window.__supabasePreload &&
      Array.isArray(window.__supabasePreload.tf_suggestions)
    ) {
      suggestionsByGameSlug = {};
      window.__supabasePreload.tf_suggestions.forEach(function (row) {
        if (!row || row.status !== "open") return;
        var key = String(row.game_slug || "").toLowerCase();
        if (!key) return;

        if (!suggestionsByGameSlug[key]) {
          suggestionsByGameSlug[key] = row;
        } else {
          // keep newest
          var existing = suggestionsByGameSlug[key];
          if (
            String(row.created_at || "") > String(existing.created_at || "")
          ) {
            suggestionsByGameSlug[key] = row;
          }
        }
      });
    }

    var opponentInfo = TF._opponentInfo || {};
    var notifications = [];

    games.forEach(function (game) {
      if (!game) return;

      var slugKey = String(game.slug || "").toLowerCase();
      if (!slugKey) return;

      if (game.datetime) return; // scheduled -> skip

      var suggestionRow = suggestionsByGameSlug[slugKey] || null;
      var proposer = suggestionRow
        ? String(suggestionRow.proposer_player_slug || "")
        : null;

      var isFromOwnTeam = proposer && teamPlayerSlugs.indexOf(proposer) !== -1;

      // Determine enemy team
      var enemySlug =
        typeof tfGetEnemyTeamSlug === "function"
          ? tfGetEnemyTeamSlug(game, teamSlugLower)
          : (function () {
              var t1 = String(game.t1_slug || "").toLowerCase();
              var t2 = String(game.t2_slug || "").toLowerCase();
              if (t1 === teamSlugLower) return game.t2_slug;
              if (t2 === teamSlugLower) return game.t1_slug;
              return null;
            })();

      if (!enemySlug) return;
      var enemyKey = String(enemySlug || "");
      var vm = opponentInfo[enemyKey] || {};
      var enemyName = vm.tname || enemyKey;

      // -------------------------------------------------------
      // 1) STATUS = "reply"  → important notification
      // -------------------------------------------------------
      if (suggestionRow && !isFromOwnTeam) {
        notifications.push({
          id: "game-reply-" + slugKey,
          title: "Neue Terminvorschläge",
          description:
            enemyName +
            ' hat neue Vorschläge gemacht. Wechsel jetzt zu "Spiele", um darauf zu antworten.',
          important: true,
          action: { type: "switch-tab", tab: "Spiele" },
        });
        return; // Do NOT double-create notstarted notifications
      }

      // -------------------------------------------------------
      // 2) STATUS = "notstarted"  → not important
      //    Only when no suggestion exists at all.
      // -------------------------------------------------------
      if (!suggestionRow) {
        notifications.push({
          id: "game-notstarted-" + slugKey,
          title: "Noch kein Termin vorgeschlagen",
          description:
            "Für das Spiel gegen " +
            enemyName +
            ' wurde noch kein Terminvorschlag gemacht. Du kannst jederzeit im Tab "Spiele" starten.',
          important: false,
          action: { type: "switch-tab", tab: "Spiele" },
        });
      }
    });

    return notifications;
  } catch (e) {
    console.warn("[terminfinder] notifGamesReply failed:", e);
    return [];
  }
}

if (typeof tfRegisterNotificationProducer === "function") {
  tfRegisterNotificationProducer(notifGamesReply);
}

tfRegisterNotificationProducer(notifGamesReply);

// [PRODUCTION NOTIFIER] -----------------------------------------------------
// Registers a producer that warns about open production roles on upcoming games.
function notifProductionRolesOpen() {
  try {
    if (!TF || !TF.player || !TF.player.slug) return [];

    // -----------------------------------------------------------------------
    // Resolve roles for current player (mirror logic from tfUpdateProductionRoles)
    // -----------------------------------------------------------------------
    var roles = {
      streamer: false,
      caster: false,
      spielleiter: false,
    };

    var playerSlugLower = String(TF.player.slug || "").toLowerCase();

    try {
      if (
        Object.prototype.hasOwnProperty.call(TF.player, "role_streamer") ||
        Object.prototype.hasOwnProperty.call(TF.player, "role_caster") ||
        Object.prototype.hasOwnProperty.call(TF.player, "role_spielleiter")
      ) {
        roles.streamer = !!TF.player.role_streamer;
        roles.caster = !!TF.player.role_caster;
        roles.spielleiter = !!TF.player.role_spielleiter;
      } else {
        var players =
          (window.__supabasePreload && window.__supabasePreload.players) || [];
        if (Array.isArray(players) && players.length) {
          for (var i = 0; i < players.length; i++) {
            var row = players[i];
            if (!row) continue;
            if (String(row.slug || "").toLowerCase() === playerSlugLower) {
              roles.streamer = !!row.role_streamer;
              roles.caster = !!row.role_caster;
              roles.spielleiter = !!row.role_spielleiter;
              break;
            }
          }
        }
      }
    } catch (eRoles) {
      console.warn(
        "[terminfinder] notifProductionRolesOpen role resolution error:",
        eRoles
      );
    }

    var hasStreamerRole = roles.streamer;
    var hasCasterRole = roles.caster;
    var hasSpielleiterRole = roles.spielleiter;

    // If the player has no production roles at all, no notifications
    if (!hasStreamerRole && !hasCasterRole && !hasSpielleiterRole) {
      return [];
    }

    // -----------------------------------------------------------------------
    // Determine games source (prefer production cache, fallback to preload)
    // -----------------------------------------------------------------------
    var games = [];
    if (Array.isArray(TF._productionGames) && TF._productionGames.length) {
      games = TF._productionGames;
    } else if (
      window.__supabasePreload &&
      Array.isArray(window.__supabasePreload.games)
    ) {
      games = window.__supabasePreload.games;
    }

    if (!games.length) return [];

    var nowMs = typeof nowUtcMs === "function" ? nowUtcMs() : Date.now();
    var oneWeekMs = 7 * 24 * 60 * 60 * 1000;

    var $prodList = $('[data-production="list"]').first();
    var notifications = [];

    function hasPlayerRoleForGame(game) {
      function match(val) {
        if (!val) return false;
        return String(val).toLowerCase() === playerSlugLower;
      }
      return (
        match(game.prod_streamer) ||
        match(game.prod_cast_1) ||
        match(game.prod_cast_2) ||
        match(game.prod_spielleiter)
      );
    }

    games.forEach(function (game) {
      if (!game || !game.slug || !game.datetime) return;

      var dtMs = new Date(game.datetime).getTime();
      if (!Number.isFinite(dtMs)) return;

      // Only future games
      if (dtMs <= nowMs) return;

      // Skip games where the user already holds any production role
      if (hasPlayerRoleForGame(game)) return;

      // Determine open roles that match the player's permissions
      var openRoles = [];

      if (hasStreamerRole && !game.prod_streamer) {
        openRoles.push("Streamer");
      }

      if (hasCasterRole && (!game.prod_cast_1 || !game.prod_cast_2)) {
        openRoles.push("Caster");
      }

      if (hasSpielleiterRole && !game.prod_spielleiter) {
        openRoles.push("Spielleitung");
      }

      if (!openRoles.length) return;

      // Determine warning (same semantics as "is--warning": within one week)
      var isWarning = dtMs - nowMs <= oneWeekMs;

      // Resolve team names (DOM first, fallback to slugs)
      var t1Name = game.t1_slug || "";
      var t2Name = game.t2_slug || "";

      if ($prodList && $prodList.length) {
        var $card = $prodList
          .find('[data-game="' + String(game.slug) + '"]')
          .first();

        if ($card && $card.length) {
          var $t1 = $card.find('[data-base="t1"] [data-base="tname"]').first();
          var $t2 = $card.find('[data-base="t2"] [data-base="tname"]').first();

          var t1Dom = $t1 && $t1.length ? $.trim($t1.text()) : "";
          var t2Dom = $t2 && $t2.length ? $.trim($t2.text()) : "";

          if (t1Dom) t1Name = t1Dom;
          if (t2Dom) t2Name = t2Dom;
        }
      }

      if (!t1Name) t1Name = "Team 1";
      if (!t2Name) t2Name = "Team 2";

      var slugUpper = String(game.slug || "").toUpperCase();
      var t1Upper = String(t1Name || "").toUpperCase();
      var t2Upper = String(t2Name || "").toUpperCase();

      notifications.push({
        id: "production-open-roles-" + String(game.slug),
        title: "Produktion gesucht",
        description:
          "Für das Spiel " +
          slugUpper +
          " zwischen " +
          t1Upper +
          " und " +
          t2Upper +
          " sind noch folgende Rollen offen: " +
          openRoles.join(", ") +
          '. Wechsel jetzt zum Tab "Produktion", um eine Rolle zu übernehmen.',
        // Important only if the game is in warning window
        important: !!isWarning,
        action: { type: "switch-tab", tab: "Produktion" },
      });
    });

    return notifications;
  } catch (eOuter) {
    console.warn("[terminfinder] notifProductionRolesOpen error:", eOuter);
    return [];
  }
}

tfRegisterNotificationProducer(notifProductionRolesOpen);

// =============================================================================
// Availabilities
// =============================================================================

// [AVAILABILITY DATA MODEL] --------------------------------------------------
// Stored in table "tf_availability".jsonb column "availabilities":
// {
//   "<dayMs>": { "slot-1": 0|1|2|3, "slot-2": 0|1|2|3 },
//   ...
// }
// 3 = "✅ Kann ich!", 2 = "❔ Wahrscheinlich", 1 = "❓ Eher nicht", 0 = "❌ Verplant"
// Day keys are local-midnight timestamps (ms since epoch), serialized as strings.

var TF_AVAIL_VALUE_MIN = 0;
var TF_AVAIL_VALUE_MAX = 3;

// Internal runtime state
TF._availabilityPopulating = false; // guard to ignore change-events during populate
TF._availabilityDirty = false; // true when user changed a select after load
TF._availabilityRowId = null; // row id in tf_availability (if existing)
TF._availabilitySnapshot = ""; // JSON string of last-saved/loaded structure

// [DATE HELPERS] ------------------------------------------------------------
/**
 * Returns ISO week number for a given Date.
 * Week starts on Monday; week 1 is the week with the year's first Thursday.
 */
function tfGetIsoWeek(date) {
  if (!date) return null;

  var d = new Date(date.getTime());
  d.setHours(0, 0, 0, 0);

  // Move to Thursday of this week
  var day = (d.getDay() + 6) % 7; // 0 = Monday, 6 = Sunday
  d.setDate(d.getDate() + 3 - day);

  // First Thursday of the year
  var firstThursday = new Date(d.getFullYear(), 0, 4);
  firstThursday.setHours(0, 0, 0, 0);
  var firstDay = (firstThursday.getDay() + 6) % 7;
  firstThursday.setDate(firstThursday.getDate() + 3 - firstDay);

  var week =
    1 +
    Math.round(
      (d.getTime() - firstThursday.getTime()) / (7 * 24 * 60 * 60 * 1000)
    );

  return week;
}

/**
 * Format a calendar day title like "Montag, 7. Januar" in German.
 */
function tfFormatCalendarDayTitle(date) {
  if (!date) return "";

  var weekday = date.toLocaleDateString("de-DE", { weekday: "long" });
  var day = date.getDate();
  var monthName = date.toLocaleDateString("de-DE", { month: "long" });

  return weekday + ", " + day + ". " + monthName;
}

function tfGetSlotNumberFromTimestamp(ts) {
  if (!ts) return null;

  var d = ts instanceof Date ? ts : new Date(ts);
  if (!(d instanceof Date) || isNaN(d.getTime())) return null;

  var minutes = d.getHours() * 60 + d.getMinutes();

  var bestIdx = null;
  var bestDiff = Infinity;

  for (var i = 0; i < TF_CAL_DEFAULT_SLOTS.length; i++) {
    var cfg = TF_CAL_DEFAULT_SLOTS[i];
    if (!cfg) continue;
    var center = (cfg.hour || 0) * 60 + (cfg.minute || 0);
    var diff = Math.abs(minutes - center);
    if (diff <= 30 && diff < bestDiff) {
      bestDiff = diff;
      bestIdx = i;
    }
  }

  // Slot numbers are 1-based (1 = 18 Uhr, 2 = 20 Uhr)
  return bestIdx != null ? bestIdx + 1 : null;
}

function tfCalendarSelects() {
  // Only consider selects inside days that are not .is--unavailable
  return $(
    "#calendar .tf-calendar-day:not(.is--unavailable) .tf-calendar-select"
  );
}

function tfFormatEditedAt(dtIsoOrDate) {
  if (!dtIsoOrDate) return "Noch nie!";
  try {
    var d = dtIsoOrDate instanceof Date ? dtIsoOrDate : new Date(dtIsoOrDate);
    var datePart = d.toLocaleDateString("de-DE", {
      day: "numeric",
      month: "short",
    }); // e.g. "7. Jan."
    var timePart = d.toLocaleTimeString("de-DE", {
      hour: "2-digit",
      minute: "2-digit",
    }); // "15:45"
    return datePart + ", " + timePart + " Uhr";
  } catch (_) {
    return "Noch nie!";
  }
}

function tfSetEditedAtDisplay(isoOrNull) {
  var $label = $('[data-base="edited_at"]');
  if ($label.length) {
    var text = isoOrNull ? tfFormatEditedAt(isoOrNull) : "Noch nie!";
    setTextIfExists($label, text); // from script.js
  }
}

function tfAvailFromDOM() {
  var out = {};
  tfCalendarSelects().each(function () {
    var $sel = $(this);
    var $day = $sel.closest(".tf-calendar-day");
    var dayKey = String($day.attr("data-day") || "").trim();
    if (!dayKey) return;

    var slotKey = String($sel.attr("data-base") || "").trim(); // "slot-1" | "slot-2"
    if (!slotKey) return;

    var val = Number($sel.val());
    if (!Number.isFinite(val)) return;
    val = Math.max(TF_AVAIL_VALUE_MIN, Math.min(TF_AVAIL_VALUE_MAX, val));

    if (!out[dayKey]) out[dayKey] = {};
    out[dayKey][slotKey] = val;
  });
  return out;
}

function tfPopulateDOMFromAvail(av) {
  if (!av || typeof av !== "object") return;

  TF._availabilityPopulating = true;
  try {
    tfCalendarSelects().each(function () {
      var $sel = $(this);
      var $day = $sel.closest(".tf-calendar-day");
      var dayKey = String($day.attr("data-day") || "").trim();
      var slotKey = String($sel.attr("data-base") || "").trim();

      var v = av?.[dayKey]?.[slotKey];
      if (v == null) return; // leave default from HTML
      // Coerce to [0..3]
      var num = Number(v);
      if (!Number.isFinite(num)) return;
      num = Math.max(TF_AVAIL_VALUE_MIN, Math.min(TF_AVAIL_VALUE_MAX, num));
      $sel.val(String(num));
    });
  } finally {
    TF._availabilityPopulating = false;
  }
}

function tfEqualAvail(a, b) {
  try {
    return JSON.stringify(a || {}) === JSON.stringify(b || {});
  } catch (_) {
    return false;
  }
}

function tfMarkDirty(dirty) {
  TF._availabilityDirty = !!dirty;
  var $btn = $('[data-base="send-availabilities"]');
  if ($btn.length) {
    $btn.toggleClass("is--active", TF._availabilityDirty);
  }
}

// [CALENDAR BUILD] ----------------------------------------------------------
function tfInitCalendarStructure() {
  var $calendar = $("#calendar");
  if (!$calendar.length) return;

  tfBuildWeeklyCalendar({
    root: $calendar,
    weekSelector: ".tf-calendar-week",
    daySelector: ".tf-calendar-day",
    weekTitleSelector: ".tf-calendar-week-title",
    dayTitleSelector: ".tf-calendar-day-title",
    mode: "availability",
  });
}

// [AVAILABILITY UI WIRING] ---------------------------------------------------
function tfWireAvailabilityUI() {
  // Only wire once
  if (TF._availabilityUIBound) return;
  TF._availabilityUIBound = true;

  // Any change after populate => mark dirty (guarded)
  $(document).on("change", "#calendar .tf-calendar-select", function () {
    if (TF._availabilityPopulating) return;

    // Compare current DOM state with snapshot; if different, mark dirty
    try {
      var current = tfAvailFromDOM();
      var changed = !tfEqualAvail(
        current,
        JSON.parse(TF._availabilitySnapshot || "{}")
      );
      tfMarkDirty(changed);
    } catch (_) {
      tfMarkDirty(true);
    }
  });

  // Send to Supabase
  $(document).on(
    "click",
    '[data-base="send-availabilities"]',
    async function (e) {
      e.preventDefault();
      await tfSaveAvailabilities();
    }
  );
}

// [AVAILABILITY LOAD/SAVE] ---------------------------------------------------
async function tfLoadAvailabilitiesAndPopulate() {
  // Reset UI state
  tfSetEditedAtDisplay(null);
  tfMarkDirty(false);
  TF._availabilityRowId = null;
  TF._availabilitySnapshot = "";

  if (!TF?.supabase || !TF?.player?.slug) {
    // Not signed in or not whitelisted -> leave defaults and show "Noch nie!"
    tfSetEditedAtDisplay(null);
    // No notifications refresh here: only relevant when signed in.
    return;
  }

  try {
    // Read existing row for this player
    var { data, error } = await TF.supabase
      .from("tf_availability")
      .select("id, updated_at, availabilities")
      .eq("player_slug", TF.player.slug)
      .maybeSingle();

    if (error && error.code !== "PGRST116") {
      console.warn("[terminfinder] tf_availability lookup error:", error);
      tfSetEditedAtDisplay(null);
      tfNotificationsRefresh(); // reflect potential state
      return;
    }

    if (!data) {
      // No row yet -> keep defaults
      tfSetEditedAtDisplay(null); // "Noch nie!"
      TF._availabilitySnapshot = JSON.stringify(tfAvailFromDOM());
      tfNotificationsRefresh(); // will show "availability-missing"
      return;
    }

    TF._availabilityRowId = data.id || null;
    var av = data.availabilities || {};
    tfPopulateDOMFromAvail(av);
    tfSetEditedAtDisplay(data.updated_at || null);
    TF._availabilitySnapshot = JSON.stringify(av || {});
    tfMarkDirty(false);
    tfNotificationsRefresh(); // reflect loaded state (likely hides the warning)
  } catch (e) {
    console.warn("[terminfinder] load availabilities failed:", e);
    tfSetEditedAtDisplay(null);
    tfNotificationsRefresh();
  }
}

// [AVAILABILITY LOAD/SAVE] ---------------------------------------------------
async function tfSaveAvailabilities() {
  if (!TF?.supabase || !TF?.player?.slug) {
    tfStatus("Bitte zuerst anmelden.", "error");
    return;
  }

  const $timestamp = $(".tf-calendar-timestamp");
  const $span = $timestamp.find('[data-base="edited_at"]');
  const originalHtml = $timestamp.html();

  const showTempMessage = (msg, cls = "") => {
    // Preserve label + <br>
    const label = "Zuletzt bearbeitet:<br>";
    $timestamp
      .html(label + `<span class="status-msg ${cls}">${msg}</span>`)
      .addClass("is--flash");
    setTimeout(() => {
      $timestamp.removeClass("is--flash").html(originalHtml);
    }, 5000);
  };

  var payload = tfAvailFromDOM();

  // If nothing changed vs snapshot, nothing to do
  try {
    if (tfEqualAvail(payload, JSON.parse(TF._availabilitySnapshot || "{}"))) {
      tfMarkDirty(false);
      return;
    }
  } catch (_) {}

  try {
    var nowIso = new Date().toISOString();
    var res;

    if (TF._availabilityRowId) {
      res = await TF.supabase
        .from("tf_availability")
        .update({ availabilities: payload, updated_at: nowIso })
        .eq("id", TF._availabilityRowId)
        .select("id, updated_at")
        .single();
    } else {
      res = await TF.supabase
        .from("tf_availability")
        .insert([{ player_slug: TF.player.slug, availabilities: payload }])
        .select("id, updated_at")
        .single();
    }

    if (res.error) throw res.error;

    TF._availabilityRowId = res.data?.id || TF._availabilityRowId;
    TF._availabilitySnapshot = JSON.stringify(payload);
    tfSetEditedAtDisplay(res.data?.updated_at || nowIso);
    tfMarkDirty(false);
    showTempMessage("Gespeichert!", "is--ok");

    // Refresh notifications so "availability-missing" disappears
    tfNotificationsRefresh();
  } catch (e) {
    console.error("[terminfinder] save availabilities failed:", e);
    showTempMessage("Speichern fehlgeschlagen.", "is--error");
  }
}

// =============================================================================
// Games
// =============================================================================

// [GAMES RENDERING] ----------------------------------------------------------
async function tfRefreshGamesSection() {
  var $pane = $('.tf-tab.w-tab-pane[data-w-tab="Spiele"]').first();
  if (!$pane.length) return;

  var $tpl = $pane.find('[data-game="template"]').first();
  if (!$tpl.length) return;

  var $container = $tpl.parent();

  // Remove previously rendered items, keep the template
  $container.find("[data-game]").not($tpl).remove();

  // Ensure template is always hidden
  $tpl.addClass("is--template");
  $tpl.attr("hidden", true);

  // Preconditions: we need a signed-in, whitelisted team and Supabase + fetchGames
  if (!TF || !TF.team || !TF.team.slug || !TF.supabase) {
    tfUpdateGamesProgress($pane, []);
    return;
  }

  if (typeof fetchGames !== "function") {
    console.warn("[terminfinder] fetchGames() not available.");
    tfUpdateGamesProgress($pane, []);
    return;
  }

  var teamSlug = String(TF.team.slug || "").toLowerCase();
  var gamesForTeam = [];

  // Load games for this team
  try {
    var allGames = (await fetchGames()) || [];

    // Cache all games with a datetime for calendar slot blocking
    try {
      TF._calendarGames = allGames.filter(function (g) {
        return g && g.datetime;
      });
    } catch (e) {
      console.warn("[terminfinder] caching calendar games failed:", e);
      TF._calendarGames = [];
    }

    gamesForTeam = allGames.filter(function (g) {
      if (!g) return false;
      var t1 = String(g.t1_slug || "").toLowerCase();
      var t2 = String(g.t2_slug || "").toLowerCase();
      return t1 === teamSlug || t2 === teamSlug;
    });
  } catch (e) {
    console.warn("[terminfinder] games load failed:", e);
    tfUpdateGamesProgress($pane, []);
    return;
  }

  // Pre-resolve own player slugs (player + teammates) for status logic
  var teamPlayerSlugs = tfGetTeamPlayerSlugs();

  // Load latest open suggestions per game (by created_at DESC)
  var suggestionsByGameSlug = {};
  if (gamesForTeam.length && TF.supabase) {
    try {
      var gameSlugs = gamesForTeam
        .map(function (g) {
          return (g.slug || "").toLowerCase();
        })
        .filter(function (s) {
          return !!s;
        });

      var uniqueSlugs = Array.from(
        new Set(
          gameSlugs.filter(function (s) {
            return !!s;
          })
        )
      );

      if (uniqueSlugs.length) {
        var res = await TF.supabase
          .from("tf_suggestions")
          .select(
            [
              "id",
              "game_slug",
              "proposer_player_slug",
              "status",
              "created_at",
              "suggestion_1",
              "suggestion_2",
              "suggestion_3",
              "note",
            ].join(", ")
          )
          .in("game_slug", uniqueSlugs)
          .eq("status", "open")
          .order("created_at", { ascending: false });

        if (res.error) {
          console.warn("[terminfinder] tf_suggestions load error:", res.error);
        } else {
          (res.data || []).forEach(function (row) {
            var key = String(row.game_slug || "").toLowerCase();
            if (!key) return;
            // keep only the most recent (first row due to order desc)
            if (!suggestionsByGameSlug[key]) {
              suggestionsByGameSlug[key] = row;
            }
          });
        }
      }
    } catch (e) {
      console.warn("[terminfinder] tf_suggestions query failed:", e);
    }
  }

  // If no games for this team, just update progress and stop
  if (!gamesForTeam.length) {
    tfUpdateGamesProgress($pane, gamesForTeam);
    return;
  }

  // Cache opponent bundles per slug to avoid duplicate lookups
  var opponentCache = {};

  // Sort games by status and then by slug
  const statusPriority = { reply: 1, notstarted: 2, waiting: 3, scheduled: 4 };

  gamesForTeam.sort(function (a, b) {
    // determine each status
    const getStatus = (game) => {
      const slugKey = String(game.slug || "").toLowerCase();
      const suggestionRow = suggestionsByGameSlug[slugKey] || null;

      if (game.datetime) return "scheduled";
      if (suggestionRow) {
        const proposer = String(suggestionRow.proposer_player_slug || "");
        const isFromOwnTeam = teamPlayerSlugs.indexOf(proposer) !== -1;
        return isFromOwnTeam ? "waiting" : "reply";
      }
      return "notstarted";
    };

    const statusA = getStatus(a);
    const statusB = getStatus(b);
    const prioA = statusPriority[statusA] || 99;
    const prioB = statusPriority[statusB] || 99;

    if (prioA !== prioB) return prioA - prioB;

    // fallback: sort by slug alphabetically
    return String(a.slug || "").localeCompare(String(b.slug || ""));
  });

  for (var i = 0; i < gamesForTeam.length; i++) {
    var game = gamesForTeam[i];
    if (!game) continue;

    var t1Slug = String(game.t1_slug || "").toLowerCase();
    var t2Slug = String(game.t2_slug || "").toLowerCase();
    var enemySlug =
      t1Slug === teamSlug
        ? game.t2_slug
        : t2Slug === teamSlug
        ? game.t1_slug
        : null;

    if (!enemySlug) continue;

    var enemyKey = String(enemySlug || "");
    if (!enemyKey) continue;

    if (!Object.prototype.hasOwnProperty.call(opponentCache, enemyKey)) {
      opponentCache[enemyKey] = null;

      try {
        if (typeof fetchTeamBundle === "function") {
          var bundle = await fetchTeamBundle(enemyKey);
          if (bundle && bundle.team) {
            var team = bundle.team;

            // Use precomputed players line from base_teams (__supabasePreload.teams)
            var playerLine = "";
            if (typeof team.players === "string" && team.players.length) {
              playerLine = team.players;
            } else {
              // Fallback: derive from bundle if players is unexpectedly missing
              var p1Name = (bundle.p1 && bundle.p1.pname) || team.p1_slug || "";
              var p2Name = (bundle.p2 && bundle.p2.pname) || team.p2_slug || "";
              if (p1Name && p2Name) {
                playerLine = p1Name + " & " + p2Name;
              } else {
                playerLine = p1Name || p2Name || "";
              }
            }

            var logo72 = "";
            if (typeof buildAssetUrl === "function" && team.slug) {
              try {
                logo72 = buildAssetUrl("teams", team.slug, "logo-72-flat");
              } catch (eLogo) {
                console.warn(
                  "[terminfinder] team logo asset url error:",
                  eLogo
                );
              }
            }

            opponentCache[enemyKey] = {
              slug: team.slug || "",
              tname: team.tname || "",
              playerLine: playerLine || "",
              logo72: logo72 || "",
            };
          }
        }
      } catch (err) {
        console.warn("[terminfinder] fetchTeamBundle error:", err);
      }
    }

    var vm = opponentCache[enemyKey];

    if (!vm) continue;

    var $item = $tpl.clone(true);
    $item.removeClass("is--template");
    $item.attr("hidden", false);
    $item.attr("data-game", game.slug);

    // Game slug (e.g. "A1")
    setTextIfExists($item.find('[data-base="slug"]'), game.slug || "");

    // Opponent team name
    setTextIfExists($item.find('[data-base="tname"]'), vm.tname || "");

    // Players line "P1 & P2"
    setTextIfExists($item.find('[data-base="players"]'), vm.playerLine || "");

    // Avatar: div with background-image
    var $logoEl = $item.find('[data-base="logo-72-flat"]');
    if ($logoEl.length && vm.logo72) {
      $logoEl.css("background-image", 'url("' + vm.logo72 + '")');
    }

    // Determine game status + suggestions
    var slugKey = String(game.slug || "").toLowerCase();
    var suggestionRow = suggestionsByGameSlug[slugKey] || null;
    var statusName = "notstarted";

    if (game.datetime) {
      statusName = "scheduled";
      suggestionRow = null; // ignore suggestions once scheduled
    } else if (suggestionRow) {
      var proposer = String(suggestionRow.proposer_player_slug || "");
      var isFromOwnTeam = teamPlayerSlugs.indexOf(proposer) !== -1;
      statusName = isFromOwnTeam ? "waiting" : "reply";
    }

    if (typeof tfApplyGameStatus === "function") {
      tfApplyGameStatus($item, game, statusName, suggestionRow);
    }

    $container.append($item);
  }

  // Persist caches for Suggestor
  TF._gamesForTeam = gamesForTeam.slice(); // keep filtered list for current team
  TF._opponentInfo = Object.assign({}, opponentCache); // reuse resolved opponent data
  TF._suggestionsByGame = Object.assign({}, suggestionsByGameSlug);

  // Hydrate game selector UI in Suggestor
  if (typeof tfSuggestorSyncFromGames === "function") {
    tfSuggestorSyncFromGames();
  }

  tfUpdateGamesProgress($pane, gamesForTeam);
  if (typeof tfNotificationsRefresh === "function") {
    tfNotificationsRefresh();
  }

  // Kalender-Events nach Games-Refresh aktualisieren
  if (typeof tfCalendarRenderEvents === "function") {
    try {
      await tfCalendarRenderEvents();
    } catch (eCal) {
      console.warn("[terminfinder] tfCalendarRenderEvents failed:", eCal);
    }
  }
}

// [GAMES STATUS] -------------------------------------------------------------
function tfApplyGameStatus($card, game, statusName, suggestionRow) {
  if (!$card || !$card.length) return;

  var known = ["scheduled", "waiting", "reply", "notstarted"];
  if (known.indexOf(statusName) === -1) statusName = "notstarted";

  var allClasses = known
    .map(function (s) {
      return "is--" + s;
    })
    .join(" ");
  $card.removeClass(allClasses).addClass("is--" + statusName);

  var $title = $card.find('[data-game-status="title"]').first();
  var $desc = $card.find('[data-game-status="description"]').first();
  var $btn = $card.find('[data-game-status="button"]').first();
  var $suggestions = $card.find('[data-game-status="suggestions"]').first();

  if ($btn && $btn.length) {
    $btn.off("click");
    $btn.removeAttr("hidden");
    $btn.prop("disabled", false);
  }
  if ($suggestions && $suggestions.length) {
    $suggestions.attr("hidden", true);
  }

  var hasSuggestions = false;

  var gameDate = convertDateTime(game.datetime, "datetime-short");

  if (statusName === "scheduled") {
    setTextIfExists($title, "Alles erledigt");
    setTextIfExists(
      $desc,
      "Für dieses Spiel steht der Termin fest: " +
        gameDate +
        ". Im Notfall absagen kannst du ihn über Deine Termine."
    );
    if ($btn && $btn.length) {
      $btn.attr("hidden", true);
    }
  } else if (statusName === "waiting") {
    hasSuggestions = suggestionRow
      ? tfFillGameSuggestions($card, suggestionRow)
      : false;
    if (hasSuggestions && $suggestions && $suggestions.length) {
      $suggestions.removeAttr("hidden");
    }

    setTextIfExists($title, "Jetzt sind die anderen dran");
    setTextIfExists(
      $desc,
      "Ihr habt Terminvorschläge verschickt. Dein Gegner-Team ist jetzt am Zug."
    );
    if ($btn && $btn.length) {
      setTextIfExists($btn, "Auf Antwort warten");
      $btn.prop("disabled", true); // wird ggf. per CSS versteckt
    }
  } else if (statusName === "reply") {
    hasSuggestions = suggestionRow
      ? tfFillGameSuggestions($card, suggestionRow)
      : false;
    if (hasSuggestions && $suggestions && $suggestions.length) {
      $suggestions.removeAttr("hidden");
    }

    var proposer = suggestionRow.proposer_player_slug || "";
    setTextIfExists($title, "Jetzt bist du dran!");
    setTextIfExists(
      $desc,
      proposer +
        " hat Terminvorschläge gemacht. Wenn sie nicht passen, kannst du neue Termine einreichen."
    );
    if ($btn && $btn.length) {
      setTextIfExists($btn, "❌ Termine ablehnen und neue vorschlagen");
      $btn.prop("disabled", false);
      $btn.on("click", function (evt) {
        evt.preventDefault();
        tfOnGameStatusAction(game, statusName);
      });
    }
  } else if (statusName === "notstarted") {
    setTextIfExists($title, "Noch keine Terminvorschläge");
    setTextIfExists(
      $desc,
      "Für dieses Spiel sind noch keine Terminvorschläge eingereicht. Starte jetzt und schlag die ersten Termine vor."
    );
    if ($btn && $btn.length) {
      setTextIfExists($btn, "Erste Terminvorschläge einreichen");
      $btn.prop("disabled", false);
      $btn.on("click", function (evt) {
        evt.preventDefault();
        tfOnGameStatusAction(game, statusName);
      });
    }
  }
}

function tfFillGameSuggestions($card, suggestionRow) {
  if (!$card || !$card.length || !suggestionRow) return false;

  var $root = $card.find('[data-game-status="suggestions"]').first();
  if (!$root || !$root.length) return false;

  var hasAny = false;

  for (var idx = 1; idx <= 3; idx++) {
    var key = "suggestion_" + idx;
    var ts = suggestionRow[key];
    var $wrap = $root
      .find('[data-suggestion="wrap"][data-suggestion-number="' + idx + '"]')
      .first();
    if (!$wrap || !$wrap.length) continue;

    var $slotSuggestion = $wrap.find('[data-suggestion="suggestion"]').first();
    var $slotEmpty = $wrap.find('[data-suggestion="empty"]').first();

    if (!ts) {
      $wrap.removeClass("is--active");
      if ($slotSuggestion && $slotSuggestion.length) {
        $slotSuggestion.attr("hidden", true);
      }
      if ($slotEmpty && $slotEmpty.length) {
        $slotEmpty.removeAttr("hidden");
      }
      continue;
    }

    var d = ts instanceof Date ? ts : new Date(ts);
    if (!(d instanceof Date) || isNaN(d.getTime())) {
      $wrap.removeClass("is--active");
      if ($slotSuggestion && $slotSuggestion.length) {
        $slotSuggestion.attr("hidden", true);
      }
      if ($slotEmpty && $slotEmpty.length) {
        $slotEmpty.removeAttr("hidden");
      }
      continue;
    }

    var weekdayShort = convertDateTime(d, "weekday-short");
    var dateLong = convertDateTime(d, "date-long");
    var dateLabel = "";

    if (weekdayShort && dateLong && weekdayShort !== dateLong) {
      dateLabel = weekdayShort + ", " + dateLong;
    } else {
      dateLabel = dateLong || weekdayShort || "";
    }

    var hours = d.getHours();
    var minutes = d.getMinutes();
    var timeLabel =
      minutes && minutes !== 0
        ? String(hours) + ":" + String(minutes).padStart(2, "0")
        : String(hours);

    var slotNumber = tfGetSlotNumberFromTimestamp(d);
    var slotLabel = slotNumber == null ? "" : String(slotNumber);

    setTextIfExists($wrap.find('[data-base="date-long"]').first(), dateLabel);
    setTextIfExists($wrap.find('[data-base="time"]').first(), timeLabel + " ");
    setTextIfExists($wrap.find('[data-base="slot"]').first(), slotLabel);

    hasAny = true;
  }

  // Handle optional note
  var note = suggestionRow.note || "";
  var $noteEl = $root.find('[data-base="note"]').first();
  var $noteWrap = $root.find('[data-base="note-wrap"]').first();

  if (note && note.trim() !== "") {
    setTextIfExists($noteEl, note);
    $noteWrap.removeAttr("hidden");
  } else {
    $noteWrap.attr("hidden", true);
  }

  $wrap.addClass("is--active");
  if ($slotSuggestion && $slotSuggestion.length) {
    $slotSuggestion.removeAttr("hidden");
  }
  if ($slotEmpty && $slotEmpty.length) {
    $slotEmpty.attr("hidden", true);
  }

  return hasAny;
}

// [GAMES ACTIONS] ------------------------------------------------------------
function tfOnGameStatusAction(game, statusName) {
  if (!game) return;

  // Accept object or slug
  var slug =
    typeof game === "string"
      ? String(game)
      : String(game.slug || game.id || "");
  if (!slug) return;

  // 1) Switch to "Vorschlag" tab
  tfActivateTab("Vorschlag");

  // 2) Set active game for suggestor
  if (typeof tfSetActiveSuggestorGame === "function") {
    tfSetActiveSuggestorGame(slug);
  }

  // Optional logging
  console.log("[terminfinder] suggestor opened for game", {
    status: statusName,
    game: slug,
  });
}

// [GAMES SUGGESTION ACCEPT] --------------------------------------------------
/**
 * Handle click on a suggestion button:
 * - Read game + opponent info from the card
 * - Read human-readable date/time from the suggestion row
 * - Ask for confirmation
 * - If confirmed, write the suggestion timestamp into games.datetime in Supabase
 * - Set the suggestion status to "accepted"
 * - Update local cache (__supabasePreload + localStorage)
 * - Then reload the games section to reflect the new status
 */
$(document).on("click", '[data-suggestion="button"]', async function (event) {
  event.preventDefault();

  var $btn = $(this);

  // Find the suggestion wrapper and number (1..3)
  var $wrap = $btn.closest('[data-suggestion="wrap"]');
  if (!$wrap.length) return;

  var suggestionNumberRaw = $wrap.attr("data-suggestion-number") || "";
  var suggestionIndex = parseInt(suggestionNumberRaw, 10);
  if (!suggestionIndex || suggestionIndex < 1 || suggestionIndex > 3) {
    console.warn(
      "[terminfinder] invalid suggestion index:",
      suggestionNumberRaw
    );
    return;
  }

  // Find the game card and slug
  var $card = $btn.closest("[data-game]");
  if (!$card.length) return;

  var gameSlug = String($card.attr("data-game") || "");
  if (!gameSlug) return;

  // Read display values from DOM for the confirm text
  var gameLabel =
    $.trim(
      $card.find('[data-base="slug"]').first().text().toUpperCase() || ""
    ) || gameSlug;
  var opponentName =
    $.trim($card.find('[data-base="tname"]').first().text() || "") ||
    "dein Gegnerteam";

  var dateLabel = $.trim(
    $wrap.find('[data-base="date-long"]').first().text() || ""
  );
  var timeLabel = $.trim($wrap.find('[data-base="time"]').first().text() || "");
  var dateTimeLabel = "";

  if (dateLabel && timeLabel) {
    dateTimeLabel = dateLabel + ", " + timeLabel;
  } else {
    dateTimeLabel = dateLabel || timeLabel || "";
  }

  var confirmText =
    "Euer Spiel " +
    gameLabel +
    " gegen " +
    opponentName +
    " wird am " +
    dateTimeLabel +
    ' Uhr stattfinden. Möchtest du das verbindlich eintragen? Spiele können im Notfall über "Termine" abgesagt werden.';

  var ok = window.confirm(confirmText);
  if (!ok) return;

  // Guards for Supabase + suggestion cache
  if (!TF || !TF.supabase || !TF.supabase.from) {
    console.warn("[terminfinder] no Supabase client available");
    return;
  }

  var suggestionsByGame = TF._suggestionsByGame || {};
  var slugKey = String(gameSlug || "").toLowerCase();
  var suggestionRow = suggestionsByGame[slugKey];

  if (!suggestionRow) {
    console.warn(
      "[terminfinder] no suggestionRow found for game slug:",
      gameSlug
    );
    return;
  }

  var tsKey = "suggestion_" + suggestionIndex;
  var tsRaw = suggestionRow[tsKey];

  if (!tsRaw) {
    console.warn(
      "[terminfinder] no timestamp found for",
      tsKey,
      "in suggestionRow"
    );
    return;
  }

  var tsDate = tsRaw instanceof Date ? tsRaw : new Date(tsRaw);
  if (!(tsDate instanceof Date) || isNaN(tsDate.getTime())) {
    console.warn("[terminfinder] invalid suggestion timestamp:", tsRaw);
    return;
  }

  var iso = tsDate.toISOString();

  // Prevent double-submits
  $btn.prop("disabled", true);

  try {
    // 1) Supabase: update datetime on games
    var res = await TF.supabase
      .from("games")
      .update({ datetime: iso })
      .eq("slug", gameSlug)
      .select("id")
      .single();

    if (res.error) {
      console.warn("[terminfinder] failed to update game datetime:", res.error);
      alert(
        "Beim Speichern ist ein Fehler aufgetreten. Bitte versuch es später erneut."
      );
      $btn.prop("disabled", false);
      return;
    }

    // 2) Supabase: mark the suggestion as accepted
    try {
      if (suggestionRow.id) {
        var suggRes = await TF.supabase
          .from("tf_suggestions")
          .update({ status: "accepted" })
          .eq("id", suggestionRow.id);

        if (suggRes.error) {
          console.warn(
            "[terminfinder] failed to update suggestion status to accepted:",
            suggRes.error
          );
          // kein Hard-Fail: Spiel ist trotzdem terminiert
        }
      } else {
        console.warn(
          "[terminfinder] suggestionRow has no id, cannot set status=accepted"
        );
      }
    } catch (suggErr) {
      console.warn(
        "[terminfinder] exception while updating suggestion status:",
        suggErr
      );
    }

    // 3) Local cache: __supabasePreload.games + localStorage
    try {
      var games =
        (window.__supabasePreload &&
          Array.isArray(window.__supabasePreload.games) &&
          window.__supabasePreload.games) ||
        null;

      if (games) {
        var lowerSlug = String(gameSlug || "").toLowerCase();

        for (var i = 0; i < games.length; i++) {
          var g = games[i];
          if (!g) continue;
          if (String(g.slug || "").toLowerCase() === lowerSlug) {
            g.datetime = iso;
            break;
          }
        }

        // Persist back to localStorage using the same helper as in base.js
        if (
          typeof setCached === "function" &&
          typeof LS_KEYS !== "undefined" &&
          LS_KEYS &&
          LS_KEYS.games
        ) {
          setCached(LS_KEYS.games, games);
        } else {
          // Fallback, falls setCached / LS_KEYS mal nicht verfügbar sein sollten
          try {
            localStorage.setItem("base_games", JSON.stringify(games));
            localStorage.setItem("base_games_timestamp", String(Date.now()));
          } catch (eLocal) {
            console.warn(
              "[terminfinder] fallback localStorage update for games failed:",
              eLocal
            );
          }
        }

        // Optional: auch TF._gamesForTeam aktualisieren, falls vorhanden
        if (Array.isArray(TF._gamesForTeam)) {
          for (var j = 0; j < TF._gamesForTeam.length; j++) {
            var gg = TF._gamesForTeam[j];
            if (!gg) continue;
            if (String(gg.slug || "").toLowerCase() === lowerSlug) {
              gg.datetime = iso;
              break;
            }
          }
        }
      }
    } catch (cacheErr) {
      console.warn(
        "[terminfinder] updating local games cache failed:",
        cacheErr
      );
    }

    // 4) Reload games section so that the new status ("scheduled") is shown
    if (typeof tfRefreshGamesSection === "function") {
      await tfRefreshGamesSection();
    }
  } catch (e) {
    console.warn("[terminfinder] exception while updating game datetime:", e);
    alert(
      "Beim Speichern ist ein unerwarteter Fehler aufgetreten. Bitte versuch es später erneut."
    );
    $btn.prop("disabled", false);
  }
});

// [GAMES PROGRESS] -----------------------------------------------------------
function tfUpdateGamesProgress($pane, gamesForTeam) {
  if (!$pane || !$pane.length) {
    $pane = $('.tf-tab.w-tab-pane[data-w-tab="Spiele"]').first();
    if (!$pane.length) return;
  }

  var list = Array.isArray(gamesForTeam) ? gamesForTeam : [];
  var total = list.length;
  var scheduled = 0;

  for (var i = 0; i < list.length; i++) {
    var g = list[i];
    if (!g) continue;

    // A game counts as "scheduled" if it has a datetime set
    if (g.datetime) {
      scheduled++;
    }
  }

  var pct = total > 0 ? (scheduled / total) * 100 : 0;

  var $bar = $pane.find('[data-progress="bar"]');
  var $count = $pane.find('[data-progress="count"]');
  var $total = $pane.find('[data-progress="total"]');

  if ($bar.length) {
    $bar.css("width", pct + "%");
  }

  if ($count.length) {
    setTextIfExists($count, String(scheduled));
  }

  if ($total.length) {
    setTextIfExists($total, String(total));
  }
}

// =============================================================================
// Suggestor – Game Selector
// =============================================================================

// [STATE] ---------------------------------------------------------------------
TF._gamesForTeam = TF._gamesForTeam || [];
TF._opponentInfo = TF._opponentInfo || {}; // { enemyTeamSlug: { slug,tname,playerLine,logo72 } }
TF._suggestionsByGame = TF._suggestionsByGame || {}; // { gameSlugLower: latestOpenSuggestionRow }
TF._activeGameSlug = TF._activeGameSlug || null; // currently selected game (slug)
TF._suggestorDirty = TF._suggestorDirty === true; // unsaved changes flag (set later in the flow)
TF._suggestorSlots = TF._suggestorSlots || [null, null, null]; // up to three local suggestions
TF._suggestorReadyToSend = TF._suggestorReadyToSend === true; // true when all three suggestions are filled
TF._suggestorUIBound = TF._suggestorUIBound === true; // guard for UI wiring

// [INIT] ----------------------------------------------------------------------
function tfInitSuggestorGameSelector() {
  var $root = $("#game-selector");
  if (!$root.length) return;

  // Wire interaction UI (only once)
  if (!TF._suggestorUIBound) {
    tfInitSuggestorInteractionUI();
    TF._suggestorUIBound = true;
  }

  // Reset local suggestion state + button state
  tfSuggestorResetAll();
  tfSuggestorUpdateFlags();

  // Populate dropdown from games cache
  tfSuggestorPopulateDropdown();

  // Wire "Spiel wechseln" button
  $(document).off("click", '[data-suggestor="game-select-button"]');
  $(document).on(
    "click",
    '[data-suggestor="game-select-button"]',
    function (e) {
      e.preventDefault();

      var prevSlug = TF._activeGameSlug || null;

      // Wenn etwas "dirty" ist, nachfragen
      if (TF._suggestorDirty) {
        var ok = window.confirm(
          "Du hast ungespeicherte Änderungen. Bist du sicher? Nicht gespeicherte Daten gehen verloren."
        );
        if (!ok) return;

        // Benutzer will die ungespeicherten Vorschläge dieses Spiels verwerfen
        if (TF.player && TF.player.slug && prevSlug) {
          tfSuggestorClearCacheForGame(TF.player.slug, prevSlug);
        }
      }

      // In-Memory-State + UI leeren (vor Wechsel)
      tfSuggestorResetAll();

      var $dd = $('[data-suggestor="game-select-dropdown"]').first();
      var slug = String($dd.val() || "").trim();
      if (!slug) return;

      tfSetActiveSuggestorGame(slug);
    }
  );

  // First render (no active game yet)
  tfSuggestorRenderActiveCard(null);
}

// [DROPDOWN] ------------------------------------------------------------------
function tfSuggestorPopulateDropdown() {
  var $dd = $('[data-suggestor="game-select-dropdown"]').first();
  if (!$dd.length) return;

  // Clear options
  $dd.empty();

  // Source: games already filtered to current user's team
  var list = Array.isArray(TF._gamesForTeam) ? TF._gamesForTeam.slice() : [];

  // Build own-team player slug set (like in Games section)
  var teamPlayerSlugs = tfGetTeamPlayerSlugs();

  // Suggestions cache (latest open suggestions per game slug)
  var suggestionsByGameSlug = TF._suggestionsByGame || {};

  // Helper to determine status identically to the Games section
  function computeStatus(game) {
    var slugKey = String(game?.slug || "").toLowerCase();
    var suggestionRow = suggestionsByGameSlug[slugKey] || null;

    if (game && game.datetime) return "scheduled";
    if (suggestionRow) {
      var proposer = String(suggestionRow.proposer_player_slug || "");
      var fromOwnTeam = teamPlayerSlugs.indexOf(proposer) !== -1;
      return fromOwnTeam ? "waiting" : "reply";
    }
    return "notstarted";
  }

  // Filter by allowed statuses
  var filtered = list.filter(function (g) {
    var st = computeStatus(g);
    return st === "notstarted" || st === "reply";
  });

  // Sort alphabetically by slug (case-insensitive)
  filtered.sort(function (a, b) {
    var as = String(a?.slug || "").toLowerCase();
    var bs = String(b?.slug || "").toLowerCase();
    if (as < bs) return -1;
    if (as > bs) return 1;
    return 0;
  });

  // Handle empty result
  if (!filtered.length) {
    $dd.append(
      $("<option></option>")
        .attr("value", "")
        .text("Zurzeit keine offenen Spiele")
    );
    $dd.prop("disabled", true);

    // Reset active UI
    var $wrap = $('[data-suggestor="wrap"]').first();
    $wrap.removeClass("is--active");
    $('[data-suggestor="game-active"]').attr("hidden", true);
    $('[data-suggestor="game-active-empty"]').removeAttr("hidden");
    return;
  }

  // Ensure enabled
  $dd.prop("disabled", false);

  // Build option labels: "SLUG: Gegnerteam"
  filtered.forEach(function (g) {
    if (!g || !g.slug) return;

    var own = String(TF?.team?.slug || "").toLowerCase();
    var t1 = String(g.t1_slug || "").toLowerCase();
    var t2 = String(g.t2_slug || "").toLowerCase();
    var enemySlug = t1 === own ? g.t2_slug : t2 === own ? g.t1_slug : null;

    var vm = enemySlug ? TF._opponentInfo[String(enemySlug)] || {} : {};
    var label =
      String(g.slug || "").toUpperCase() +
      ": " +
      String(vm.tname || "Gegner unbekannt");

    $dd.append($("<option></option>").attr("value", g.slug).text(label));
  });

  // Preselect current active if still present, else first
  if (
    TF._activeGameSlug &&
    filtered.some(function (g) {
      return String(g.slug) === String(TF._activeGameSlug);
    })
  ) {
    $dd.val(TF._activeGameSlug);
  } else {
    $dd.val(filtered[0].slug);
  }
}

// [ACTIVE CARD] ---------------------------------------------------------------
async function tfSuggestorRenderActiveCard(gameOrNull) {
  var $wrap = $('[data-suggestor="wrap"]').first();
  var $card = $('[data-suggestor="game-active-card"]').first();
  if (!$card.length) return;

  if (!gameOrNull) {
    // No selection -> show empty
    $wrap.removeClass("is--active");
    $('[data-suggestor="game-active"]').attr("hidden", true);
    $('[data-suggestor="game-active-empty"]').removeAttr("hidden");
    return;
  }

  var game = gameOrNull;

  // opponent VM
  var own = String(TF?.team?.slug || "").toLowerCase();
  var t1 = String(game.t1_slug || "").toLowerCase();
  var t2 = String(game.t2_slug || "").toLowerCase();
  var enemySlug = t1 === own ? game.t2_slug : t2 === own ? game.t1_slug : null;

  var vm = enemySlug ? TF._opponentInfo[String(enemySlug)] : null;

  // Fill data-base targets
  setTextIfExists(
    $card.find('[data-base="name"]').first(),
    String(game.name || "")
  );

  setTextIfExists(
    $card.find('[data-base="tname"]').first(),
    vm && vm.tname ? String(vm.tname) : ""
  );

  setTextIfExists(
    $card.find('[data-base="players"]').first(),
    vm && vm.playerLine ? String(vm.playerLine) : ""
  );

  // Logo background-image
  var $logoEl = $card.find('[data-base="logo-72-flat"]').first();
  if ($logoEl.length) {
    if (vm && vm.logo72) {
      $logoEl.css("background-image", 'url("' + vm.logo72 + '")');
    } else {
      $logoEl.css("background-image", "");
    }
  }

  // Toggle states
  $('[data-suggestor="game-active-empty"]').attr("hidden", true);
  $('[data-suggestor="game-active"]').removeAttr("hidden");
  $wrap.addClass("is--active");
}

// [SET ACTIVE] ----------------------------------------------------------------
function tfSetActiveSuggestorGame(gameOrSlug) {
  var slug =
    typeof gameOrSlug === "string"
      ? String(gameOrSlug)
      : String(gameOrSlug?.slug || "");
  if (!slug) return;

  // Aktives Spiel merken
  TF._activeGameSlug = slug;

  // Dropdown spiegeln
  var $dd = $('[data-suggestor="game-select-dropdown"]').first();
  if ($dd.length) $dd.val(slug);

  // Game-Objekt auflösen
  var game = (TF._gamesForTeam || []).find(function (g) {
    return String(g.slug || "") === slug;
  });

  // Zustand für dieses Spiel zunächst leeren (in-memory + UI)
  tfSuggestorResetAll();

  // Karte rendern
  tfSuggestorRenderActiveCard(game);

  // Kalender initialisieren + füllen
  tfInitSuggestorCalendarStructure();
  tfSuggestorRefreshCalendarForActiveGame();

  // Gecachte Vorschläge + Notiz für dieses Spiel (dieser Spieler) wiederherstellen
  tfSuggestorRestoreFromCacheForActiveGame();
}

// [SYNC ENTRYPOINT] -----------------------------------------------------------
function tfSuggestorSyncFromGames() {
  // Called after games section refresh to hydrate the selector UI
  tfInitSuggestorGameSelector();

  // If we already have an active slug, re-render
  if (TF._activeGameSlug) {
    tfSetActiveSuggestorGame(TF._activeGameSlug);
  }
}

// =============================================================================
// Suggestor – Calendar & Slots
// =============================================================================

// [STATE] ---------------------------------------------------------------------
TF._suggestorCalendarReady = TF._suggestorCalendarReady || false;

// [INIT] ----------------------------------------------------------------------
function tfInitSuggestorCalendarStructure() {
  // Root: any container that holds a week template with data-suggestor="week"
  var $root = $('[data-suggestor="calendar"]');
  if (!$root.length) return;

  // Determine game type based on current active game
  var mode = "suggestor-group"; // default: Gruppenspiel
  if (TF._activeGameSlug && Array.isArray(TF._gamesForTeam)) {
    var game = TF._gamesForTeam.find(function (g) {
      return String(g.slug || "") === String(TF._activeGameSlug || "");
    });
    if (game && String(game.group || "").toLowerCase() === "ko") {
      mode = "suggestor-ko";
    }
  }

  tfBuildWeeklyCalendar({
    root: $root,
    weekSelector: '[data-suggestor="week"]',
    daySelector: '[data-suggestor="day"]',
    weekTitleSelector: ".tf-calendar-week-title",
    dayTitleSelector: ".tf-calendar-day-title",
    mode: mode,
  });

  // Ensure each day has two slot-wraps labeled with data-slot="1" and "2"
  // (the template does not carry these attributes)
  $root.find('[data-suggestor="day"]').each(function () {
    var $day = $(this);
    var $wraps = $day.find('[data-suggestor="slot-wrap"]');
    // Label first two wraps defensively
    $wraps.each(function (idx) {
      if (idx < 2) {
        $(this).attr("data-slot", String(idx + 1));
      }
    });
  });

  // Wire accordion: only one day open at a time (once)
  if (!TF._suggestorCalendarReady) {
    $(document).off("click", ".tf-calendar-day-trigger");
    $(document).on("click", ".tf-calendar-day-trigger", function (e) {
      e.preventDefault();
      var $day = $(this).closest('[data-suggestor="day"]');
      if (!$day.length) return;

      // Close others
      $('[data-suggestor="day"].is--active')
        .not($day)
        .removeClass("is--active");
      // Toggle this one open
      $day.toggleClass("is--active");
    });

    TF._suggestorCalendarReady = true;
  }
}

// [REFRESH] -------------------------------------------------------------------
/**
 * Load availabilities for the 4 players of the active game
 * and fill all slot buttons (two per day) with summed status.
 * Missing players get 🙊 and 50% opacity; counted as 0 points but do not hard-zero the slot.
 */
async function tfSuggestorRefreshCalendarForActiveGame() {
  if (!TF._activeGameSlug) return;

  // Resolve game
  var game = (TF._gamesForTeam || []).find(function (g) {
    return String(g.slug || "") === String(TF._activeGameSlug || "");
  });
  if (!game) return;

  // Collect open suggestions for ALL games to mark reserved slots
  // Structure: [{ date: Date, slug: 'B4' }, ...]
  var reservedSuggestionSlots = [];

  try {
    var suggestionsMap = TF._suggestionsByGame || {};

    Object.keys(suggestionsMap).forEach(function (slugKey) {
      var row = suggestionsMap[slugKey];
      if (!row) return;

      // Only open suggestions count as reserved
      if (String(row.status || "").toLowerCase() !== "open") return;

      // Determine game slug (from row or key)
      var gameSlug = row.game_slug || row.slug || slugKey || "";
      var gameSlugUpper = String(gameSlug).trim().toUpperCase();
      if (!gameSlugUpper) return;

      ["suggestion_1", "suggestion_2", "suggestion_3"].forEach(function (key) {
        var iso = row[key];
        if (!iso) return;

        var dt = new Date(iso);
        if (isNaN(dt.getTime())) return;

        reservedSuggestionSlots.push({
          date: dt,
          slug: gameSlugUpper,
        });
      });
    });
  } catch (e) {
    console.warn(
      "[terminfinder] suggestor reserved slots – suggestions parsing failed:",
      e
    );
  }

  // Determine team slugs
  var ownTeam = TF.team || {};
  var ownSlug = String(ownTeam.slug || "").toLowerCase();
  var t1 = String(game.t1_slug || "").toLowerCase();
  var t2 = String(game.t2_slug || "").toLowerCase();
  var enemySlug =
    t1 === ownSlug ? game.t2_slug : t2 === ownSlug ? game.t1_slug : null;

  // Fetch opponent + ensure own bundle (for player names)
  var ownBundle = null,
    oppBundle = null;
  try {
    if (typeof fetchTeamBundle === "function") {
      if (ownTeam && ownTeam.slug)
        ownBundle = await fetchTeamBundle(String(ownTeam.slug));
      if (enemySlug) oppBundle = await fetchTeamBundle(String(enemySlug));
    }
  } catch (e) {
    console.warn("[terminfinder] suggestor team bundle error:", e);
  }

  // Helpers to resolve side info (slugs + names)
  function resolveSide(sideSlugLower, bundleIfSide, fallbackTeam) {
    var res = { p1_slug: null, p2_slug: null, p1_name: "", p2_name: "" };
    if (
      bundleIfSide &&
      bundleIfSide.team &&
      String(bundleIfSide.team.slug || "").toLowerCase() === sideSlugLower
    ) {
      res.p1_slug = bundleIfSide.p1?.slug || null;
      res.p2_slug = bundleIfSide.p2?.slug || null;
      res.p1_name = bundleIfSide.p1?.pname || "";
      res.p2_name = bundleIfSide.p2?.pname || "";
    } else if (
      fallbackTeam &&
      String(fallbackTeam.slug || "").toLowerCase() === sideSlugLower
    ) {
      res.p1_slug = fallbackTeam.p1_slug || null;
      res.p2_slug = fallbackTeam.p2_slug || null;
      // names may be unknown here; keep empty
    }
    return res;
  }

  var side1 = resolveSide(
    t1,
    ownSlug === t1 ? ownBundle : oppBundle,
    ownSlug === t1 ? ownTeam : null
  );
  var side2 = resolveSide(
    t2,
    ownSlug === t2 ? ownBundle : oppBundle,
    ownSlug === t2 ? ownTeam : null
  );

  // Collect the four player slugs (nullable)
  var playerSlugs = [
    side1.p1_slug,
    side1.p2_slug,
    side2.p1_slug,
    side2.p2_slug,
  ].map(function (s) {
    return s ? String(s) : null;
  });

  // Fetch availabilities for players that actually have a slug
  var availByPlayer = {}; // { slug: { "<dayMs>": { "slot-1": n, "slot-2": n } } }
  var presentSlugs = playerSlugs.filter(Boolean);
  if (presentSlugs.length && TF.supabase) {
    try {
      var res = await TF.supabase
        .from("tf_availability")
        .select("player_slug, availabilities")
        .in("player_slug", presentSlugs);

      if (!res.error && Array.isArray(res.data)) {
        res.data.forEach(function (row) {
          var ps = String(row.player_slug || "");
          availByPlayer[ps] = row.availabilities || {};
        });
      } else if (res.error) {
        console.warn("[terminfinder] tf_availability query error:", res.error);
      }
    } catch (e) {
      console.warn("[terminfinder] tf_availability fetch failed:", e);
    }
  }

  // Determine missing players (no or empty availabilities)
  var playerMeta = [
    { slug: side1.p1_slug, name: side1.p1_name },
    { slug: side1.p2_slug, name: side1.p2_name },
    { slug: side2.p1_slug, name: side2.p1_name },
    { slug: side2.p2_slug, name: side2.p2_name },
  ];

  var missingPlayersNames = [];

  playerMeta.forEach(function (pm) {
    var slug = pm.slug ? String(pm.slug) : null;

    if (!slug) {
      // No slug at all -> treated as missing
      if (pm.name) missingPlayersNames.push(String(pm.name));
      return;
    }

    var availObj = availByPlayer[slug];
    var hasAnyAvail =
      availObj &&
      typeof availObj === "object" &&
      Object.keys(availObj).length > 0;

    if (!hasAnyAvail) {
      var label = pm.name || slug;
      missingPlayersNames.push(String(label));
    }
  });

  var hasMissingAnyPlayerAvailability = missingPlayersNames.length > 0;

  // Toggle visibility of availability warning + fill players string
  var $availabilityWarning = $(
    '[data-suggestor="availability-warning"]'
  ).first();
  var $availabilityWarningPlayers = $(
    '[data-suggestor="availability-warning-players"]'
  ).first();

  if ($availabilityWarning.length) {
    if (hasMissingAnyPlayerAvailability) {
      $availabilityWarning.removeClass("is--hidden");
    } else {
      $availabilityWarning.addClass("is--hidden");
    }
  }

  if ($availabilityWarningPlayers.length) {
    if (hasMissingAnyPlayerAvailability) {
      var txt =
        missingPlayersNames.join(", ") +
        (missingPlayersNames.length === 1 ? " hat" : " haben");
      $availabilityWarningPlayers.text(txt);
    } else {
      $availabilityWarningPlayers.text("");
    }
  }

  // Helpers for value/flags per player/day/slot
  function readPlayerDaySlot(slug, dayKey, slotKey) {
    if (!slug) return { missing: true, val: 0, verplant: false };
    var hasDay = !!availByPlayer[slug]?.[dayKey];
    var raw = hasDay ? availByPlayer[slug][dayKey][slotKey] : undefined;
    if (raw === undefined || raw === null) {
      // player exists but no entry for that day/slot
      return { missing: true, val: 0, verplant: false };
    }
    var num = Number(raw);
    if (!Number.isFinite(num)) num = 0;
    num = Math.max(0, Math.min(3, num));
    return {
      missing: false,
      val: num,
      verplant: num === 0, // only real 0 counts as "verplant"
    };
  }

  // Status texts for combined slot results (0..9)
  var SLOT_STATUS_TEXT = [
    "0: Nicht möglich", // 0  (hard zero)
    "1: Sehr schwierig", // 1  (Summe 1..4 -> 1; 4 exakt -> 1)
    "2: Eher schwierig", // 2  (5)
    "3: Grenzwertig", // 3  (6)
    "4: Mittel", // 4  (7)
    "5: Ganz okay", // 5  (8)
    "6: Gut", // 6  (9)
    "7: Sehr gut", // 7  (10)
    "8: Top", // 8  (11)
    "9: Perfekt", // 9  (12)
  ];

  function emojiFor(v, missing) {
    if (missing) return "🙊";
    if (v === 3) return "✅";
    if (v === 2) return "❔";
    if (v === 1) return "❓";
    return "❌"; // real 0
  }

  // Fill each day
  var $calRoot = $('[data-suggestor="calendar"]');
  if (!$calRoot.length) return;

  $calRoot.find('[data-suggestor="day"]').each(function () {
    var $day = $(this);
    var dayKey = String($day.attr("data-day") || "").trim();
    if (!dayKey) return;

    [1, 2].forEach(function (slotNum) {
      var slotKey = "slot-" + slotNum;

      // Prefer by data-slot="1|2"; fallback to positional index
      var $slotWrap = $day
        .find('[data-suggestor="slot-wrap"][data-slot="' + slotNum + '"]')
        .first();

      if (!$slotWrap.length) {
        var $allWraps = $day.find('[data-suggestor="slot-wrap"]');
        $slotWrap = $allWraps.eq(slotNum - 1); // 0-based index fallback
      }
      if (!$slotWrap.length) return;

      var $btn = $slotWrap.find('[data-suggestor="slot"]').first();
      var $status = $slotWrap.find('[data-suggestor="slot-status"]').first();
      if (!$btn.length) return;

      // Precompute day + time window for this slot
      var dayMsNum = Number(dayKey);
      var dayDate = null;
      var baseMinutes = null;
      var minMinutes = null;
      var maxMinutes = null;

      if (Number.isFinite(dayMsNum)) {
        dayDate = new Date(dayMsNum);
        dayDate.setHours(0, 0, 0, 0);

        var slotCfg = TF_CAL_DEFAULT_SLOTS[slotNum - 1] || {
          hour: 18,
          minute: 0,
        };
        baseMinutes = (slotCfg.hour || 0) * 60 + (slotCfg.minute || 0);
        minMinutes = baseMinutes - 30;
        maxMinutes = baseMinutes + 30;
      }

      // ---------------------------------------------------------------------
      // 1) Spielerwerte lesen + Icons/Namen rendern (IMMER, auch bei taken)
      // ---------------------------------------------------------------------
      var p_t1p1 = readPlayerDaySlot(side1.p1_slug, dayKey, slotKey);
      var p_t1p2 = readPlayerDaySlot(side1.p2_slug, dayKey, slotKey);
      var p_t2p1 = readPlayerDaySlot(side2.p1_slug, dayKey, slotKey);
      var p_t2p2 = readPlayerDaySlot(side2.p2_slug, dayKey, slotKey);

      var anyVerplant =
        p_t1p1.verplant ||
        p_t1p2.verplant ||
        p_t2p1.verplant ||
        p_t2p2.verplant;

      // Missing Spieler: zählen als 0 Punkte, aber härten den Slot NICHT auf 0
      var score = p_t1p1.val + p_t1p2.val + p_t2p1.val + p_t2p2.val;

      var statusIdx;
      if (anyVerplant) {
        statusIdx = 0; // hart geblockt
      } else if (score === 0) {
        // niemand hat Daten & niemand verplant -> sehr niedriger Score
        statusIdx = 1;
      } else {
        // Mappe Summe (4..12) auf 1..9  => (score - 3), geklammert
        statusIdx = Math.max(1, Math.min(9, score - 3));
      }

      // Basisklasse is--N setzen (wird ggf. später von is--taken überschrieben)
      $btn
        .removeClass(function (i, cls) {
          return (cls || "")
            .split(" ")
            .filter(function (c) {
              return /^is--\d$/.test(c);
            })
            .join(" ");
        })
        .addClass("is--" + statusIdx);

      // Basis-Statustext (wird bei besetzt/reserviert überschrieben)
      if ($status.length) {
        $status.text(SLOT_STATUS_TEXT[statusIdx] || "");
      }

      // Icons + Namen der vier Spieler (IMMER rendern)
      var map = [
        { key: "t1p1", obj: p_t1p1, name: side1.p1_name },
        { key: "t1p2", obj: p_t1p2, name: side1.p2_name },
        { key: "t2p1", obj: p_t2p1, name: side2.p1_name },
        { key: "t2p2", obj: p_t2p2, name: side2.p2_name },
      ];

      map.forEach(function (m) {
        var $iconEl = $slotWrap
          .find('[data-suggestor="slot-' + m.key + '-icon"]')
          .first();
        var $nameEl = $slotWrap
          .find('[data-suggestor="slot-' + m.key + '-player"]')
          .first();

        if ($iconEl.length) $iconEl.text(emojiFor(m.obj.val, m.obj.missing));
        if ($nameEl.length) $nameEl.text(m.name || "");

        // 50% Opacity für fehlende Spieler
        var opacity = m.obj.missing ? 0.5 : 1;
        if ($iconEl.length) $iconEl.css("opacity", opacity);
        if ($nameEl.length) $nameEl.css("opacity", opacity);
      });

      // ---------------------------------------------------------------------
      // 2) Danach: Besetzt / Reserviert prüfen und ggf. Slot sperren
      //    (Icons bleiben erhalten, nur Klasse + Text werden überschrieben)
      // ---------------------------------------------------------------------

      // Check if this slot is already taken by any scheduled game
      var takenGameSlug = null;

      if (
        dayDate &&
        Array.isArray(TF._calendarGames) &&
        TF._calendarGames.length
      ) {
        TF._calendarGames.some(function (g) {
          if (!g || !g.datetime) return false;

          var dt = new Date(g.datetime);

          // Same calendar day?
          var dtDay = new Date(dt.getTime());
          dtDay.setHours(0, 0, 0, 0);
          if (dtDay.getTime() !== dayDate.getTime()) return false;

          // Minutes since midnight of the game
          var mins = dt.getHours() * 60 + dt.getMinutes();
          if (mins < minMinutes || mins > maxMinutes) return false;

          var slug = String(g.slug || "").trim();
          if (!slug) return false;

          takenGameSlug = slug.toUpperCase();
          return true;
        });
      }

      // Check if this slot is reserved by open suggestions (ANY game)
      var reservedGameSlug = null;

      if (
        dayDate &&
        Array.isArray(reservedSuggestionSlots) &&
        reservedSuggestionSlots.length
      ) {
        reservedSuggestionSlots.some(function (entry) {
          if (!entry || !entry.date) return false;
          var dt = entry.date;

          // Same calendar day?
          var dtDay = new Date(dt.getTime());
          dtDay.setHours(0, 0, 0, 0);
          if (dtDay.getTime() !== dayDate.getTime()) return false;

          // Minutes since midnight
          var mins = dt.getHours() * 60 + dt.getMinutes();
          if (mins < minMinutes || mins > maxMinutes) return false;

          reservedGameSlug = entry.slug;
          return true;
        });
      }

      if (takenGameSlug || reservedGameSlug) {
        // Alle is--N Klassen entfernen und als genommen markieren
        $btn
          .removeClass(function (i, cls) {
            return (cls || "")
              .split(" ")
              .filter(function (c) {
                return /^is--\d$/.test(c);
              })
              .join(" ");
          })
          .addClass("is--taken");

        // Statustext überschreiben
        if ($status.length) {
          if (takenGameSlug) {
            $status.text("Besetzt von " + takenGameSlug);
          } else {
            $status.text("Reserviert von " + reservedGameSlug);
          }
        }

        // Icons + Spielernamen bleiben wie oben gerendert
        return;
      }
    });
  });
}

// [UI HANDLERS] ---------------------------------------------------------------
$(document).on(
  "click",
  '[data-suggestor="availability-warning-close"]',
  function (event) {
    event.preventDefault();
    $('[data-suggestor="availability-warning"]').addClass("is--hidden");
  }
);

// =============================================================================
// Suggestor – Active Suggestions & Send
// =============================================================================

// [STATE HELPERS] -------------------------------------------------------------
function tfSuggestorComputeDate(entry) {
  if (!entry || !entry.dayKey) return null;

  var dayMs = Number(entry.dayKey);
  if (!Number.isFinite(dayMs)) return null;

  var d = new Date(dayMs);
  var baseMinutes = Number(entry.baseMinutes || 0);
  var offsetMinutes = Number(entry.offsetMinutes || 0);
  var totalMinutes = baseMinutes + offsetMinutes;

  var hours = Math.floor(totalMinutes / 60);
  var minutes = totalMinutes % 60;

  d.setHours(hours, minutes, 0, 0);
  return d;
}

function tfSuggestorApplySlotToWrap(index, entry) {
  var $root = $("#active-suggestions");
  if (!$root.length) return;

  var $wrap = $root
    .find(
      '[data-suggestion="wrap"][data-suggestion-number="' +
        String(index + 1) +
        '"]'
    )
    .first();
  if (!$wrap.length) return;

  var $suggestion = $wrap.find('[data-suggestion="suggestion"]').first();
  var $empty = $wrap.find('[data-suggestion="empty"]').first();
  var $dateEl = $wrap.find('[data-suggestion="date"]').first();
  var $slotEl = $wrap.find('[data-suggestion="slot"]').first();
  var $timeEl = $wrap.find('[data-suggestion="time"]').first();
  var $btnPlus = $wrap.find('[data-suggestion="time-plus"]').first();
  var $btnMinus = $wrap.find('[data-suggestion="time-minus"]').first();

  if (!entry) {
    $wrap.removeClass("is--active");

    if ($suggestion.length) $suggestion.attr("hidden", true);
    if ($empty.length) $empty.removeAttr("hidden");

    if ($dateEl.length) $dateEl.text("");
    if ($slotEl.length) $slotEl.text("");
    if ($timeEl.length) $timeEl.text("");

    if ($btnPlus.length) $btnPlus.removeClass("is--disabled");
    if ($btnMinus.length) $btnMinus.removeClass("is--disabled");

    return;
  }

  var d = tfSuggestorComputeDate(entry);
  if (!d) return;

  var weekdayShort =
    typeof convertDateTime === "function"
      ? convertDateTime(d, "weekday-short")
      : "";
  var dateLong =
    typeof convertDateTime === "function"
      ? convertDateTime(d, "date-long")
      : "";
  var dateLabel = "";

  if (weekdayShort && dateLong && weekdayShort !== dateLong) {
    dateLabel = weekdayShort + ", " + dateLong;
  } else {
    dateLabel = dateLong || weekdayShort || "";
  }

  var totalMinutes =
    Number(entry.baseMinutes || 0) + Number(entry.offsetMinutes || 0);
  var hours = Math.floor(totalMinutes / 60);
  var minutes = totalMinutes % 60;

  var timeLabel =
    minutes && minutes !== 0
      ? String(hours) + ":" + String(minutes).padStart(2, "0")
      : String(hours);

  if ($dateEl.length) setTextIfExists($dateEl, dateLabel);
  if ($slotEl.length) setTextIfExists($slotEl, String(entry.slotNumber || ""));
  if ($timeEl.length) setTextIfExists($timeEl, timeLabel);

  if ($suggestion.length) $suggestion.removeAttr("hidden");
  if ($empty.length) $empty.attr("hidden", true);
  $wrap.addClass("is--active");

  if ($btnPlus.length) {
    $btnPlus.toggleClass("is--disabled", entry.offsetMinutes >= 30);
  }
  if ($btnMinus.length) {
    $btnMinus.toggleClass("is--disabled", entry.offsetMinutes <= -30);
  }
}

// Sortiert die drei Vorschläge nach Datum/Zeit (frühester zuerst/links)
function tfSuggestorSortSlotsInPlace() {
  if (!Array.isArray(TF._suggestorSlots)) {
    TF._suggestorSlots = [null, null, null];
    return;
  }

  var items = TF._suggestorSlots
    .filter(function (s) {
      return !!s;
    })
    .map(function (s) {
      var d = tfSuggestorComputeDate(s);
      var ts = d ? d.getTime() : Number.POSITIVE_INFINITY;
      return { entry: s, ts: ts };
    });

  items.sort(function (a, b) {
    return a.ts - b.ts;
  });

  var next = [null, null, null];
  for (var i = 0; i < items.length && i < 3; i++) {
    next[i] = items[i].entry;
  }
  TF._suggestorSlots = next;
}

// Rendert alle drei aktiven Vorschlags-Slots neu (auf Basis der sortierten Slots)
function tfSuggestorRefreshActiveSuggestionsUI() {
  for (var i = 0; i < 3; i++) {
    tfSuggestorApplySlotToWrap(i, TF._suggestorSlots[i] || null);
  }
  tfSuggestorUpdateFlags();
}

// LocalStorage Cache ----------------------------------------------------------
var TF_SUGGESTOR_CACHE_KEY = "tf_suggestor_cache_v1";
var TF_SUGGESTOR_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 Tage

function tfSuggestorGetCacheKey(playerSlug, gameSlug) {
  if (!playerSlug || !gameSlug) return null;
  return (
    String(playerSlug).toLowerCase() + "|" + String(gameSlug).toLowerCase()
  );
}

function tfSuggestorReadFullCache() {
  var empty = { version: 1, entries: {} };
  if (typeof window === "undefined" || !window.localStorage) return empty;

  var raw;
  try {
    raw = window.localStorage.getItem(TF_SUGGESTOR_CACHE_KEY);
  } catch (_) {
    return empty;
  }
  if (!raw) return empty;

  var now = Date.now();
  var parsed;
  try {
    parsed = JSON.parse(raw) || {};
  } catch (_) {
    return empty;
  }

  var entries = {};
  if (parsed && parsed.entries && typeof parsed.entries === "object") {
    Object.keys(parsed.entries).forEach(function (k) {
      var e = parsed.entries[k];
      if (!e || typeof e !== "object") return;

      var updatedAt = Number(e.updatedAt || 0);
      if (!Number.isFinite(updatedAt)) return;
      if (now - updatedAt > TF_SUGGESTOR_CACHE_TTL_MS) return; // abgelaufen

      entries[k] = {
        playerSlug: e.playerSlug || null,
        gameSlug: e.gameSlug || null,
        updatedAt: updatedAt,
        slots: Array.isArray(e.slots) ? e.slots.slice(0, 3) : [],
        note: e.note ? String(e.note) : "",
      };
    });
  }

  return { version: 1, entries: entries };
}

function tfSuggestorWriteFullCache(cache) {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    var payload = {
      version: 1,
      entries: cache && cache.entries ? cache.entries : {},
    };
    window.localStorage.setItem(
      TF_SUGGESTOR_CACHE_KEY,
      JSON.stringify(payload)
    );
  } catch (_) {}
}

function tfSuggestorClearCacheForGame(playerSlug, gameSlug) {
  var key = tfSuggestorGetCacheKey(playerSlug, gameSlug);
  if (!key) return;

  var cache = tfSuggestorReadFullCache();
  if (!cache.entries || !cache.entries[key]) return;

  delete cache.entries[key];
  tfSuggestorWriteFullCache(cache);
}

function tfSuggestorPersistCurrentStateToCache() {
  if (
    !TF ||
    !TF.player ||
    !TF.player.slug ||
    !TF._activeGameSlug ||
    typeof window === "undefined" ||
    !window.localStorage
  )
    return;

  var key = tfSuggestorGetCacheKey(TF.player.slug, TF._activeGameSlug);
  if (!key) return;

  var cache = tfSuggestorReadFullCache();
  cache.entries = cache.entries || {};

  var $note = $('[data-suggestor="note"]').first();
  var noteVal = $note.length ? String($note.val() || "") : "";

  var slots = [];
  if (Array.isArray(TF._suggestorSlots)) {
    TF._suggestorSlots.forEach(function (s) {
      if (!s || !s.dayKey || !s.slotNumber) return;
      slots.push({
        dayKey: String(s.dayKey),
        slotNumber: Number(s.slotNumber || 0),
        baseMinutes: Number(s.baseMinutes || 0),
        offsetMinutes: Number(s.offsetMinutes || 0),
      });
    });
  }

  // Nichts zu speichern -> ggf. Eintrag löschen
  if (!slots.length && !noteVal.trim()) {
    if (cache.entries[key]) {
      delete cache.entries[key];
      tfSuggestorWriteFullCache(cache);
    }
    return;
  }

  cache.entries[key] = {
    playerSlug: String(TF.player.slug),
    gameSlug: String(TF._activeGameSlug),
    updatedAt: Date.now(),
    slots: slots,
    note: noteVal,
  };

  tfSuggestorWriteFullCache(cache);
}

function tfSuggestorRestoreFromCacheForActiveGame() {
  if (
    !TF ||
    !TF.player ||
    !TF.player.slug ||
    !TF._activeGameSlug ||
    typeof window === "undefined" ||
    !window.localStorage
  )
    return;

  var key = tfSuggestorGetCacheKey(TF.player.slug, TF._activeGameSlug);
  if (!key) return;

  var cache = tfSuggestorReadFullCache();
  var entry = cache.entries && cache.entries[key];
  if (!entry) return;

  // Slots wiederherstellen
  TF._suggestorSlots = [null, null, null];
  var slots = Array.isArray(entry.slots) ? entry.slots.slice(0, 3) : [];
  for (var i = 0; i < slots.length && i < 3; i++) {
    var s = slots[i];
    if (!s) continue;
    TF._suggestorSlots[i] = {
      dayKey: String(s.dayKey || ""),
      slotNumber: Number(s.slotNumber || 0),
      baseMinutes: Number(s.baseMinutes || 0),
      offsetMinutes: Number(s.offsetMinutes || 0),
    };
  }

  // Notiz wiederherstellen
  var $note = $('[data-suggestor="note"]').first();
  if ($note.length) {
    $note.val(entry.note ? String(entry.note) : "");
  }

  // Sortieren + UI aktualisieren + Timestamp erneuern
  tfSuggestorSortSlotsInPlace();
  tfSuggestorRefreshActiveSuggestionsUI();
  tfSuggestorPersistCurrentStateToCache();
}

function tfSuggestorUpdateFlags() {
  var hasAnySuggestion =
    Array.isArray(TF._suggestorSlots) &&
    TF._suggestorSlots.some(function (s) {
      return !!s;
    });

  var $note = $('[data-suggestor="note"]').first();
  var noteVal = $note.length ? String($note.val() || "").trim() : "";

  TF._suggestorDirty = !!(hasAnySuggestion || noteVal);

  TF._suggestorReadyToSend =
    Array.isArray(TF._suggestorSlots) &&
    TF._suggestorSlots.length === 3 &&
    TF._suggestorSlots.every(function (s) {
      return !!s;
    });

  var $sendBtn = $('[data-suggestor="send"]').first();
  if ($sendBtn.length) {
    $sendBtn.toggleClass("is--disabled", !TF._suggestorReadyToSend);
  }
}

function tfSuggestorResetAll() {
  TF._suggestorSlots = [null, null, null];
  TF._suggestorReadyToSend = false;
  TF._suggestorDirty = false;

  var $note = $('[data-suggestor="note"]').first();
  if ($note.length) {
    $note.val("");
  }

  // UI leeren (Slots + Button-State)
  tfSuggestorRefreshActiveSuggestionsUI();
}

// [UI INTERACTION INIT] ------------------------------------------------------
function tfInitSuggestorInteractionUI() {
  // Click auf einen Slot im Kalender -> Vorschlag hinzufügen
  $(document).off("click", '[data-suggestor="slot"]');
  $(document).on("click", '[data-suggestor="slot"]', function (e) {
    e.preventDefault();

    if (!TF._activeGameSlug) {
      window.alert("Bitte wähle zuerst ein Spiel aus.");
      return;
    }

    var $btn = $(this);
    var $day = $btn.closest('[data-suggestor="day"]');
    if (!$day.length || $day.hasClass("is--unavailable")) return;

    var dayKey = String($day.attr("data-day") || "").trim();
    if (!dayKey) return;

    var $slotWrap = $btn.closest('[data-suggestor="slot-wrap"]');
    var slotNumber = Number($slotWrap.attr("data-slot") || 0);
    if (!(slotNumber === 1 || slotNumber === 2)) return;

    // Duplikate verhindern
    if (Array.isArray(TF._suggestorSlots)) {
      for (var j = 0; j < TF._suggestorSlots.length; j++) {
        var existing = TF._suggestorSlots[j];
        if (
          existing &&
          existing.dayKey === dayKey &&
          existing.slotNumber === slotNumber
        ) {
          window.alert("Dieser Terminvorschlag ist bereits ausgewählt.");
          return;
        }
      }
    }

    // Freien Slot suchen
    var freeIndex = -1;
    for (var i = 0; i < 3; i++) {
      if (!TF._suggestorSlots[i]) {
        freeIndex = i;
        break;
      }
    }

    if (freeIndex === -1) {
      window.alert(
        "Du hast bereits 3 Vorschläge ausgewählt. Bitte lösche einen anderen Vorschlag."
      );
      return;
    }

    // Basiszeit aus Slot-Config
    var cfg = TF_CAL_DEFAULT_SLOTS[slotNumber - 1] || { hour: 18, minute: 0 };
    var baseMinutes = (cfg.hour || 0) * 60 + (cfg.minute || 0);

    TF._suggestorSlots[freeIndex] = {
      dayKey: dayKey,
      slotNumber: slotNumber,
      baseMinutes: baseMinutes,
      offsetMinutes: 0,
    };

    tfSuggestorSortSlotsInPlace();
    tfSuggestorRefreshActiveSuggestionsUI();
    tfSuggestorPersistCurrentStateToCache();
  });

  // Zeit anpassen (+15, max +30)
  $(document).off("click", '#active-suggestions [data-suggestion="time-plus"]');
  $(document).on(
    "click",
    '#active-suggestions [data-suggestion="time-plus"]',
    function (e) {
      e.preventDefault();
      var $btn = $(this);
      var $wrap = $btn.closest('[data-suggestion="wrap"]');
      var idx = Number($wrap.attr("data-suggestion-number") || 0) - 1;
      if (idx < 0 || idx > 2) return;

      var entry = TF._suggestorSlots[idx];
      if (!entry) return;

      var newOffset = Number(entry.offsetMinutes || 0) + 15;
      if (newOffset > 30) newOffset = 30;

      entry.offsetMinutes = newOffset;

      tfSuggestorSortSlotsInPlace();
      tfSuggestorRefreshActiveSuggestionsUI();
      tfSuggestorPersistCurrentStateToCache();
    }
  );

  // Zeit anpassen (-15, max -30)
  $(document).off(
    "click",
    '#active-suggestions [data-suggestion="time-minus"]'
  );
  $(document).on(
    "click",
    '#active-suggestions [data-suggestion="time-minus"]',
    function (e) {
      e.preventDefault();
      var $btn = $(this);
      var $wrap = $btn.closest('[data-suggestion="wrap"]');
      var idx = Number($wrap.attr("data-suggestion-number") || 0) - 1;
      if (idx < 0 || idx > 2) return;

      var entry = TF._suggestorSlots[idx];
      if (!entry) return;

      var newOffset = Number(entry.offsetMinutes || 0) - 15;
      if (newOffset < -30) newOffset = -30;

      entry.offsetMinutes = newOffset;

      tfSuggestorSortSlotsInPlace();
      tfSuggestorRefreshActiveSuggestionsUI();
      tfSuggestorPersistCurrentStateToCache();
    }
  );

  // Vorschlag löschen
  $(document).off("click", '#active-suggestions [data-suggestion="delete"]');
  $(document).on(
    "click",
    '#active-suggestions [data-suggestion="delete"]',
    function (e) {
      e.preventDefault();
      var $btn = $(this);
      var $wrap = $btn.closest('[data-suggestion="wrap"]');
      var idx = Number($wrap.attr("data-suggestion-number") || 0) - 1;
      if (idx < 0 || idx > 2) return;

      var ok = window.confirm("Möchtest du diesen Vorschlag wirklich löschen?");
      if (!ok) return;

      TF._suggestorSlots[idx] = null;

      tfSuggestorSortSlotsInPlace();
      tfSuggestorRefreshActiveSuggestionsUI();
      tfSuggestorPersistCurrentStateToCache();
    }
  );

  // Notiz-Änderungen als "dirty" + in Cache
  $(document).off("input", '[data-suggestor="note"]');
  $(document).on("input", '[data-suggestor="note"]', function () {
    tfSuggestorUpdateFlags();
    tfSuggestorPersistCurrentStateToCache();
  });

  // Senden
  $(document).off("click", '[data-suggestor="send"]');
  $(document).on("click", '[data-suggestor="send"]', async function (e) {
    e.preventDefault();

    var $btn = $(this);
    if ($btn.hasClass("is--disabled")) {
      return;
    }

    await tfSuggestorSendSuggestions();
  });
}

// [SEND] ---------------------------------------------------------------------
async function tfSuggestorSendSuggestions() {
  if (!TF?.supabase || !TF?.player?.slug) {
    window.alert("Bitte zuerst anmelden.");
    return;
  }

  if (!TF._activeGameSlug) {
    window.alert("Bitte wähle zuerst ein Spiel aus.");
    return;
  }

  if (
    !Array.isArray(TF._suggestorSlots) ||
    TF._suggestorSlots.length !== 3 ||
    TF._suggestorSlots.some(function (s) {
      return !s;
    })
  ) {
    window.alert(
      "Bitte wähle drei Terminvorschläge aus, bevor du sie abschickst."
    );
    return;
  }

  var gameSlug = TF._activeGameSlug;

  var timestamps = TF._suggestorSlots.map(function (entry) {
    var d = tfSuggestorComputeDate(entry);
    return d ? d.toISOString() : null;
  });

  var $note = $('[data-suggestor="note"]').first();
  var noteVal = $note.length ? String($note.val() || "").trim() : "";

  try {
    // 1) Alle bestehenden Vorschläge zu diesem Spiel schließen
    var closeRes = await TF.supabase
      .from("tf_suggestions")
      .update({ status: "rejected" })
      .eq("game_slug", gameSlug);

    if (closeRes.error) {
      throw closeRes.error;
    }

    // 2) Neuen Vorschlag als "open" anlegen
    var insertRes = await TF.supabase.from("tf_suggestions").insert([
      {
        game_slug: gameSlug,
        proposer_player_slug: TF.player.slug,
        note: noteVal || null,
        suggestion_1: timestamps[0],
        suggestion_2: timestamps[1],
        suggestion_3: timestamps[2],
        status: "open",
      },
    ]);

    if (insertRes.error) {
      throw insertRes.error;
    }

    window.alert("Vorschläge wurden erfolgreich abgeschickt.");

    // Cache für dieses Spiel/Spieler löschen, damit alte Vorschläge nicht wieder auftauchen
    if (TF.player && TF.player.slug && gameSlug) {
      tfSuggestorClearCacheForGame(TF.player.slug, gameSlug);
    }

    // Lokalen Zustand + UI zurücksetzen
    tfSuggestorResetAll();

    // Aktives Spiel visual zurücksetzen
    TF._activeGameSlug = null;
    tfSuggestorRenderActiveCard(null);

    // Kalender leeren, damit er beim nächsten Mal frisch aufgebaut wird
    var $cal = $('[data-suggestor="calendar"]');
    if ($cal.length) {
      $cal.empty();
      TF._suggestorCalendarReady = false;
    }

    // Games-Section refreshen
    if (typeof tfRefreshGamesSection === "function") {
      try {
        await tfRefreshGamesSection();
      } catch (e) {
        console.warn(
          "[terminfinder] tfRefreshGamesSection after suggestions send failed:",
          e
        );
      }
    }
  } catch (err) {
    console.error("[terminfinder] send suggestions failed:", err);
    window.alert(
      "Das Senden der Vorschläge ist fehlgeschlagen. Bitte versuche es später erneut."
    );
  }
}

// =============================================================================
// Production
// =============================================================================

// [ENTRYPOINT] ---------------------------------------------------------------
/**
 * Refresh the full production section:
 * - render upcoming games
 * - fill game data (names, datetime, teams)
 * - fill staff assignments
 * - compute game-level status flags
 */
async function tfRefreshProductionSection() {
  try {
    await tfProductionRenderGames();
    await tfProductionFillGamesData();
    await tfProductionFillStaff();
    tfProductionDetermineStatus();
  } catch (e) {
    console.warn("[terminfinder] tfRefreshProductionSection error:", e);
  }
}

// [DETERMINE ROLES] ----------------------------------------------------------
/**
 * Update production tab visibility and role flags based on the current player.
 * Uses role_streamer, role_caster and role_spielleiter from the players data.
 */
async function tfUpdateProductionRoles() {
  var $tab = $('[data-production="tab"]');
  var $menuLink = $('[data-production="menu-link"]');
  var $list = $('[data-production="list"]');

  if (!$tab.length && !$list.length) return;

  // Always reset base state first
  if ($tab.length) {
    $tab.addClass("is--hidden");
  }
  if ($menuLink.length) {
    $menuLink.addClass("is--hidden");
  }
  if ($list.length) {
    $list
      .removeClass("is--streamer")
      .removeClass("is--caster")
      .removeClass("is--spielleiter");
  }

  if (!TF || !TF.player || !TF.player.slug) {
    return;
  }

  var slug = String(TF.player.slug || "").toLowerCase();
  var roles = {
    streamer: false,
    caster: false,
    spielleiter: false,
  };

  try {
    // Prefer roles directly on TF.player if available
    if (
      Object.prototype.hasOwnProperty.call(TF.player, "role_streamer") ||
      Object.prototype.hasOwnProperty.call(TF.player, "role_caster") ||
      Object.prototype.hasOwnProperty.call(TF.player, "role_spielleiter")
    ) {
      roles.streamer = !!TF.player.role_streamer;
      roles.caster = !!TF.player.role_caster;
      roles.spielleiter = !!TF.player.role_spielleiter;
    } else {
      // Fallback: look up roles in preloaded players or via fetchPlayers
      var players =
        (window.__supabasePreload && window.__supabasePreload.players) || null;

      if (!Array.isArray(players) || !players.length) {
        if (typeof fetchPlayers === "function") {
          try {
            players = (await fetchPlayers()) || [];
          } catch (e) {
            console.warn(
              "[terminfinder] fetchPlayers for production failed:",
              e
            );
            players = [];
          }
        } else {
          players = [];
        }
      }

      for (var i = 0; i < players.length; i++) {
        var row = players[i];
        if (!row) continue;
        if (String(row.slug || "").toLowerCase() === slug) {
          roles.streamer = !!row.role_streamer;
          roles.caster = !!row.role_caster;
          roles.spielleiter = !!row.role_spielleiter;
          break;
        }
      }
    }
  } catch (e) {
    console.warn("[terminfinder] production roles lookup error:", e);
  }

  var hasAnyRole = roles.streamer || roles.caster || roles.spielleiter;

  // Show or hide production tab based on any role
  if ($tab.length) {
    if (hasAnyRole) {
      $tab.removeClass("is--hidden");
    } else {
      $tab.addClass("is--hidden");
    }
  }

  // Show or hide production menu link based on any role
  if ($menuLink.length) {
    if (hasAnyRole) {
      $menuLink.removeClass("is--hidden");
    } else {
      $menuLink.addClass("is--hidden");
    }
  }

  // Add role-specific classes on the list
  if (!$list.length || !hasAnyRole) {
    return;
  }

  if (roles.streamer) {
    $list.addClass("is--streamer");
  }
  if (roles.caster) {
    $list.addClass("is--caster");
  }
  if (roles.spielleiter) {
    $list.addClass("is--spielleiter");
  }

  // Once roles are resolved, populate production games and staff
  if (typeof tfRefreshProductionSection === "function") {
    try {
      await tfRefreshProductionSection();
    } catch (e) {
      console.warn("[terminfinder] tfRefreshProductionSection failed:", e);
    }
  }
}

// [PRODUCTION STATE] ---------------------------------------------------------
TF._productionGames = TF._productionGames || [];

/**
 * Format a game datetime into "Fr., 14. März, 18:15 Uhr".
 * Falls convertDateTime verfügbar ist, wird es für die Datumsbestandteile genutzt.
 */
function tfProductionFormatDateTime(dtIsoOrDate) {
  if (!dtIsoOrDate) return "";
  try {
    var d = dtIsoOrDate instanceof Date ? dtIsoOrDate : new Date(dtIsoOrDate);
    if (!d || isNaN(d.getTime())) return "";

    var weekdayShort =
      typeof convertDateTime === "function"
        ? convertDateTime(d, "weekday-short")
        : "";
    var dateLong =
      typeof convertDateTime === "function"
        ? convertDateTime(d, "date-long")
        : "";

    var dateLabel = "";
    if (weekdayShort && dateLong && weekdayShort !== dateLong) {
      dateLabel = weekdayShort + ", " + dateLong;
    } else {
      dateLabel = weekdayShort || dateLong || "";
    }

    var timePart = d.toLocaleTimeString("de-DE", {
      hour: "2-digit",
      minute: "2-digit",
    });

    return dateLabel + ", " + timePart + " Uhr";
  } catch (_) {
    return "";
  }
}

/**
 * Resolve a game object for a given slug from the production cache.
 */
function tfProductionGetGameBySlug(slug) {
  if (!slug) return null;
  var list = Array.isArray(TF._productionGames) ? TF._productionGames : [];
  for (var i = 0; i < list.length; i++) {
    var g = list[i];
    if (!g) continue;
    if (String(g.slug || "") === String(slug)) return g;
  }
  return null;
}

// [RENDER GAMES] -------------------------------------------------------------
/**
 * Render upcoming production games into the production tab.
 * Uses games from Supabase, filters to future games and clones the template.
 */
async function tfProductionRenderGames() {
  var $list = $('[data-production="list"]').first();
  if (!$list.length) return;

  var $tpl = $list.find('[data-game="template"]').first();
  if (!$tpl.length) return;

  // Remove previously rendered items, keep the template
  $list.find("[data-game]").not($tpl).remove();

  // Ensure template is always hidden
  $tpl.addClass("is--template").attr("hidden", true);

  if (!TF || !TF.supabase) {
    TF._productionGames = [];
    return;
  }

  if (typeof fetchGames !== "function") {
    console.warn("[terminfinder] fetchGames() not available for production.");
    TF._productionGames = [];
    return;
  }

  var nowMs = typeof nowUtcMs === "function" ? nowUtcMs() : Date.now();
  var upcoming = [];

  try {
    var allGames = (await fetchGames()) || [];

    upcoming = allGames.filter(function (g) {
      if (!g) return false;
      if (!g.datetime) return false;
      try {
        var dtMs = new Date(g.datetime).getTime();
        if (!Number.isFinite(dtMs)) return false;
        return dtMs > nowMs;
      } catch (_) {
        return false;
      }
    });

    // Sort by datetime ascending (closest upcoming first)
    upcoming.sort(function (a, b) {
      var aMs = a && a.datetime ? new Date(a.datetime).getTime() : 0;
      var bMs = b && b.datetime ? new Date(b.datetime).getTime() : 0;
      return aMs - bMs;
    });
  } catch (e) {
    console.warn("[terminfinder] production games load failed:", e);
    upcoming = [];
  }

  TF._productionGames = upcoming.slice();

  if (!upcoming.length) {
    return;
  }

  // Render each upcoming game
  for (var i = 0; i < upcoming.length; i++) {
    var game = upcoming[i];
    if (!game || !game.slug) continue;

    var $item = $tpl.clone(true);
    $item.removeClass("is--template");
    $item.attr("hidden", false);
    $item.attr("data-game", game.slug);

    // Insert after the template (or at the end of the list)
    $item.insertAfter($tpl);
    $tpl = $item;
  }
}

// [STATUS] -------------------------------------------------------------------
/**
 * Determine status classes for all rendered production games.
 * - is--staffed: all production roles are filled
 * - is--warning: game is within one week from now
 * If warning is present, data-production="warning" text is set to "in X Tagen!".
 */
function tfProductionDetermineStatus() {
  var $list = $('[data-production="list"]').first();
  if (!$list.length) return;

  var $cards = $list.find("[data-game]").not('[data-game="template"]');
  if (!$cards.length) return;

  var nowMs = typeof nowUtcMs === "function" ? nowUtcMs() : Date.now();
  var oneWeekMs = 7 * 24 * 60 * 60 * 1000;

  // Only consider the roles the current user actually has
  var hasStreamerRole = $list.hasClass("is--streamer");
  var hasCasterRole = $list.hasClass("is--caster");
  var hasSpielleiterRole = $list.hasClass("is--spielleiter");

  $cards.each(function () {
    var $card = $(this);
    var slug = String($card.attr("data-game") || "").trim();
    if (!slug) return;

    var game = tfProductionGetGameBySlug(slug);
    if (!game) return;

    // Reset status classes on card
    $card.removeClass("is--staffed is--warning");

    // "Staffed" now only refers to the roles the current user holds
    var hasAnyRole = false;
    var rolesFilled = true;

    if (hasStreamerRole) {
      hasAnyRole = true;
      rolesFilled = rolesFilled && !!game.prod_streamer;
    }

    if (hasCasterRole) {
      hasAnyRole = true;
      rolesFilled = rolesFilled && !!game.prod_cast_1 && !!game.prod_cast_2;
    }

    if (hasSpielleiterRole) {
      hasAnyRole = true;
      rolesFilled = rolesFilled && !!game.prod_spielleiter;
    }

    var staffed = hasAnyRole && rolesFilled;

    if (staffed) {
      $card.addClass("is--staffed");
    }

    // Warning when game is within one week from now (unchanged)
    var warning = false;
    var dtMs = null;

    if (game.datetime) {
      try {
        dtMs = new Date(game.datetime).getTime();
        if (Number.isFinite(dtMs) && dtMs > nowMs) {
          if (dtMs - nowMs <= oneWeekMs) {
            warning = true;
          }
        }
      } catch (_) {
        dtMs = null;
      }
    }

    var $warningEl = $card.find('[data-production="warning"]').first();
    if (warning && dtMs) {
      $card.addClass("is--warning");

      var diffDays = Math.ceil((dtMs - nowMs) / (24 * 60 * 60 * 1000));
      if ($warningEl.length) {
        setTextIfExists($warningEl, "in " + String(diffDays) + " Tagen!");
        $warningEl.removeAttr("hidden");
      }
    } else {
      if ($warningEl.length) {
        $warningEl.attr("hidden", true);
      }
    }
  });
}

// [FILL GAME DATA] -----------------------------------------------------------
/**
 * Fill basic game and team data for all rendered production games.
 * Uses fetchTeamBundle + buildPlayerLine + buildAssetUrl.
 */
async function tfProductionFillGamesData() {
  var $list = $('[data-production="list"]').first();
  if (!$list.length) return;

  var $cards = $list.find("[data-game]").not('[data-game="template"]');
  if (!$cards.length) return;

  if (typeof fetchTeamBundle !== "function") {
    console.warn(
      "[terminfinder] fetchTeamBundle() not available for production."
    );
    return;
  }

  var teamCache = {};

  async function ensureTeamVm(slug) {
    var key = String(slug || "").toLowerCase();
    if (!key) return null;

    if (Object.prototype.hasOwnProperty.call(teamCache, key)) {
      return teamCache[key];
    }

    teamCache[key] = null;

    try {
      var bundle = await fetchTeamBundle(key);
      if (bundle && bundle.team) {
        var team = bundle.team;

        // Use precomputed players line from base_teams (__supabasePreload.teams)
        var playerLine = "";
        if (typeof team.players === "string" && team.players.length) {
          playerLine = team.players;
        } else {
          // Fallback: derive from bundle if players is unexpectedly missing
          var p1Name = (bundle.p1 && bundle.p1.pname) || team.p1_slug || "";
          var p2Name = (bundle.p2 && bundle.p2.pname) || team.p2_slug || "";
          if (p1Name && p2Name) {
            playerLine = p1Name + " & " + p2Name;
          } else {
            playerLine = p1Name || p2Name || "";
          }
        }

        var logo72 = "";
        if (typeof buildAssetUrl === "function" && team.slug) {
          try {
            logo72 = buildAssetUrl("teams", team.slug, "logo-72-flat");
          } catch (eLogo) {
            console.warn(
              "[terminfinder] team logo asset url error (production):",
              eLogo
            );
          }
        }

        teamCache[key] = {
          slug: team.slug || "",
          tname: team.tname || "",
          playerLine: playerLine || "",
          logo72: logo72 || "",
        };
      }
    } catch (err) {
      console.warn("[terminfinder] fetchTeamBundle error (production):", err);
    }

    return teamCache[key];
  }

  for (var i = 0; i < $cards.length; i++) {
    var $card = $($cards[i]);
    var slug = String($card.attr("data-game") || "").trim();
    if (!slug) continue;

    var game = tfProductionGetGameBySlug(slug);
    if (!game) continue;

    // Game name
    setTextIfExists(
      $card.find('[data-production="name"]').first(),
      String(game.name || "")
    );

    // Game datetime
    var dtLabel = game.datetime
      ? tfProductionFormatDateTime(game.datetime)
      : "";
    setTextIfExists(
      $card.find('[data-production="datetime"]').first(),
      dtLabel
    );

    // Team 1 + Team 2
    var t1Slug = game.t1_slug || "";
    var t2Slug = game.t2_slug || "";

    var vm1 = t1Slug ? await ensureTeamVm(t1Slug) : null;
    var vm2 = t2Slug ? await ensureTeamVm(t2Slug) : null;

    var $t1 = $card.find('[data-base="t1"]').first();
    var $t2 = $card.find('[data-base="t2"]').first();

    if ($t1.length && vm1) {
      setTextIfExists($t1.find('[data-base="tname"]').first(), vm1.tname || "");
      setTextIfExists(
        $t1.find('[data-base="players"]').first(),
        vm1.playerLine || ""
      );
      var $logo1 = $t1.find('[data-base="logo-72-flat"]').first();
      if ($logo1.length && vm1.logo72) {
        // For production, use src attribute as requested
        $logo1.css("background-image", 'url("' + vm1.logo72 + '")');
      }
    }

    if ($t2.length && vm2) {
      setTextIfExists($t2.find('[data-base="tname"]').first(), vm2.tname || "");
      setTextIfExists(
        $t2.find('[data-base="players"]').first(),
        vm2.playerLine || ""
      );
      var $logo2 = $t2.find('[data-base="logo-72-flat"]').first();
      if ($logo2.length && vm2.logo72) {
        $logo2.css("background-image", 'url("' + vm2.logo72 + '")');
      }
    }
  }
}

// [FILL STAFF] ---------------------------------------------------------------
/**
 * Fill production staff (streamer, caster, spielleiter) for each game.
 * Looks up player names from players data and marks fully staffed roles.
 */
async function tfProductionFillStaff() {
  var $list = $('[data-production="list"]').first();
  if (!$list.length) return;

  var $cards = $list.find("[data-game]").not('[data-game="template"]');
  if (!$cards.length) return;

  if (typeof fetchPlayers !== "function") {
    console.warn("[terminfinder] fetchPlayers() not available for production.");
    return;
  }

  var players =
    (window.__supabasePreload && window.__supabasePreload.players) || null;

  if (!Array.isArray(players) || !players.length) {
    try {
      players = (await fetchPlayers()) || [];
    } catch (e) {
      console.warn(
        "[terminfinder] fetchPlayers for production staff failed:",
        e
      );
      players = [];
    }
  }

  var playerBySlug = {};
  (players || []).forEach(function (p) {
    if (!p || !p.slug) return;
    playerBySlug[String(p.slug)] = p;
  });

  function resolvePlayerName(slug) {
    if (!slug) return "–";
    var p = playerBySlug[String(slug)];
    if (!p || !p.pname) return "–";
    return String(p.pname);
  }

  for (var i = 0; i < $cards.length; i++) {
    var $card = $($cards[i]);
    var slug = String($card.attr("data-game") || "").trim();
    if (!slug) continue;

    var game = tfProductionGetGameBySlug(slug);
    if (!game) continue;

    // Streamer
    var $streamer = $card.find('[data-production-role="streamer"]').first();
    if ($streamer.length) {
      var streamerName = resolvePlayerName(game.prod_streamer);
      setTextIfExists(
        $streamer.find('[data-production="player"]').first(),
        streamerName
      );
      var streamerFull = streamerName !== "–";
      $streamer.toggleClass("is--staffed", streamerFull);
    }

    // Caster (2 slots)
    var $caster = $card.find('[data-production-role="caster"]').first();
    if ($caster.length) {
      var c1Name = resolvePlayerName(game.prod_cast_1);
      var c2Name = resolvePlayerName(game.prod_cast_2);
      var casterLabel = c1Name + ", " + c2Name;

      setTextIfExists(
        $caster.find('[data-production="player"]').first(),
        casterLabel
      );

      var casterFull = c1Name !== "–" && c2Name !== "–";
      $caster.toggleClass("is--staffed", casterFull);
    }

    // Spielleiter
    var $sl = $card.find('[data-production-role="spielleiter"]').first();
    if ($sl.length) {
      var slName = resolvePlayerName(game.prod_spielleiter);
      setTextIfExists($sl.find('[data-production="player"]').first(), slName);
      var slFull = slName !== "–";
      $sl.toggleClass("is--staffed", slFull);
    }
  }
}

// [LOCAL GAMES CACHE] --------------------------------------------------------
/**
 * Update any cached copies of games in localStorage when a production role changes.
 * This scans localStorage for JSON payloads that look like game lists and patches
 * the matching game row by slug.
 */
function tfProductionUpdateLocalGamesCache(gameSlug, columnName, value) {
  if (!gameSlug || !columnName) return;
  if (typeof window === "undefined" || !window.localStorage) return;

  try {
    var ls = window.localStorage;

    for (var i = 0; i < ls.length; i++) {
      var key = ls.key(i);
      if (!key) continue;

      var lowered = String(key).toLowerCase();

      // Only touch keys that likely store games
      if (lowered.indexOf("game") === -1) continue;

      var raw = ls.getItem(key);
      if (!raw) continue;

      var parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (_) {
        continue;
      }

      var changed = false;

      function patchArray(arr) {
        if (!Array.isArray(arr)) return false;
        var didChange = false;

        for (var j = 0; j < arr.length; j++) {
          var row = arr[j];
          if (
            row &&
            String(row.slug || "") === String(gameSlug) &&
            ("t1_slug" in row || "t2_slug" in row || "datetime" in row)
          ) {
            row[columnName] = value;
            didChange = true;
          }
        }

        return didChange;
      }

      if (Array.isArray(parsed)) {
        changed = patchArray(parsed);
      } else if (parsed && typeof parsed === "object") {
        if (Array.isArray(parsed.data) && patchArray(parsed.data)) {
          changed = true;
        }
        if (Array.isArray(parsed.items) && patchArray(parsed.items)) {
          changed = true;
        }
        if (Array.isArray(parsed.value) && patchArray(parsed.value)) {
          changed = true;
        }
      }

      if (changed) {
        try {
          ls.setItem(key, JSON.stringify(parsed));
        } catch (eSet) {
          console.warn(
            "[terminfinder] failed to update localStorage games cache key",
            key,
            eSet
          );
        }
      }
    }
  } catch (eOuter) {
    console.warn(
      "[terminfinder] localStorage games cache update failed:",
      eOuter
    );
  }
}

// [REGISTER ROLE] ------------------------------------------------------------
/**
 * Register the currently logged-in player for a production role on click.
 * - Triggered by clicking elements with data-production="button" inside a game card
 * - Determines the role via the closest [data-production-role] wrapper
 * - Uses the "games" table in Supabase
 * - For caster picks the first free slot among prod_cast_1 / prod_cast_2
 */
$(document).on("click", '[data-production="button"]', async function (event) {
  event.preventDefault();

  // Basic guards: player + Supabase client must exist
  if (
    !TF ||
    !TF.player ||
    !TF.player.slug ||
    !TF.supabase ||
    !TF.supabase.from
  ) {
    return;
  }

  var playerSlug = String(TF.player.slug);
  var $btn = $(this);

  // Prevent double clicks while a request is in flight
  if ($btn.data("productionBusy")) {
    return;
  }
  $btn.data("productionBusy", true);

  // Helper: map roleKey -> label
  function tfProductionGetRoleLabel(roleKey) {
    var key = String(roleKey || "").toLowerCase();
    if (key === "streamer") return "Streamer";
    if (key === "caster") return "Kommentator";
    if (key === "spielleiter") return "Spielleiter";
    return key || "Rolle";
  }

  // Helper: simple game title
  function tfProductionFormatGameTitle(game, slug) {
    var s = String(slug || "").toUpperCase();
    return s || "?";
  }

  // Helper: format date + time (de-DE)
  function tfProductionFormatGameDateTime(game) {
    var dateLabel = "";
    var timeLabel = "";

    if (game && game.datetime) {
      var d = new Date(game.datetime);
      if (!isNaN(d.getTime())) {
        dateLabel = d.toLocaleDateString("de-DE", {
          weekday: "short",
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
        });
        timeLabel = d.toLocaleTimeString("de-DE", {
          hour: "2-digit",
          minute: "2-digit",
        });
      }
    }

    return {
      dateLabel: dateLabel,
      timeLabel: timeLabel,
    };
  }

  // Helper: get team by slug from available caches/preloads
  function tfProductionGetTeamBySlug(slug) {
    if (!slug) return null;
    var slugLower = String(slug).toLowerCase();
    var team = null;

    // 1) TF._teams as array
    if (!team && TF && Array.isArray(TF._teams)) {
      for (var i = 0; i < TF._teams.length; i++) {
        var t = TF._teams[i];
        if (t && String(t.slug || "").toLowerCase() === slugLower) {
          team = t;
          break;
        }
      }
    }

    // 2) TF._teamsBySlug as map
    if (!team && TF && TF._teamsBySlug) {
      var direct = TF._teamsBySlug[slugLower] || TF._teamsBySlug[slug];
      if (direct) {
        team = direct;
      }
    }

    // 3) window.__supabasePreload.teams as array
    if (
      !team &&
      typeof window !== "undefined" &&
      window.__supabasePreload &&
      Array.isArray(window.__supabasePreload.teams)
    ) {
      var arr = window.__supabasePreload.teams;
      for (var j = 0; j < arr.length; j++) {
        var t2 = arr[j];
        if (t2 && String(t2.slug || "").toLowerCase() === slugLower) {
          team = t2;
          break;
        }
      }
    }

    // 4) localStorage base_teams (best-effort, optional)
    if (!team && typeof window !== "undefined" && window.localStorage) {
      try {
        var raw = window.localStorage.getItem("terminfinder_base_teams");
        if (raw) {
          var parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            for (var k = 0; k < parsed.length; k++) {
              var t3 = parsed[k];
              if (t3 && String(t3.slug || "").toLowerCase() === slugLower) {
                team = t3;
                break;
              }
            }
          } else if (parsed && typeof parsed === "object") {
            // sometimes stored as map
            var keys = Object.keys(parsed);
            for (var m = 0; m < keys.length && !team; m++) {
              var tt = parsed[keys[m]];
              if (tt && String(tt.slug || "").toLowerCase() === slugLower) {
                team = tt;
                break;
              }
            }
          }
        }
      } catch (e) {
        // ignore JSON/localStorage errors – this is only a best-effort source
      }
    }

    return team;
  }

  // Helper: check if current player is one of the players in this game
  // Based on DB structure:
  // games.t1_slug / games.t2_slug -> teams.slug
  // teams.p1_slug / teams.p2_slug -> players.slug
  function tfProductionIsPlayerInGame(game, playerSlug) {
    if (!game || !playerSlug) return false;
    var ps = String(playerSlug).toLowerCase();

    // Resolve both teams of this game
    var t1 = game.t1_slug ? tfProductionGetTeamBySlug(game.t1_slug) : null;
    var t2 = game.t2_slug ? tfProductionGetTeamBySlug(game.t2_slug) : null;

    function isPlayerInTeam(team) {
      if (!team) return false;
      var p1 = team.p1_slug ? String(team.p1_slug).toLowerCase() : "";
      var p2 = team.p2_slug ? String(team.p2_slug).toLowerCase() : "";
      return p1 === ps || p2 === ps;
    }

    return isPlayerInTeam(t1) || isPlayerInTeam(t2);
  }

  try {
    // Find the game card and slug
    var $card = $btn.closest("[data-game]").first();
    if (!$card.length) return;

    var gameSlug = String($card.attr("data-game") || "").trim();
    if (!gameSlug) return;

    var game = tfProductionGetGameBySlug(gameSlug);
    if (!game) return;

    // Determine role wrapper and role key
    var $roleWrap = $btn.closest("[data-production-role]").first();
    if (!$roleWrap.length) return;

    var roleKey = String($roleWrap.attr("data-production-role") || "")
      .trim()
      .toLowerCase();
    if (!roleKey) return;

    var roleLabel = tfProductionGetRoleLabel(roleKey);
    var titleLabel = tfProductionFormatGameTitle(game, gameSlug);
    var dtInfo = tfProductionFormatGameDateTime(game);
    var dateLabel = dtInfo.dateLabel || "einen noch offenen Termin";
    var timeLabel = dtInfo.timeLabel || "eine noch offene Uhrzeit";

    // Check whether player is one of the players in this game (via teams)
    var isPlayerInGame = tfProductionIsPlayerInGame(game, playerSlug);

    // Check existing roles in this game
    var alreadyStreamer =
      game.prod_streamer && String(game.prod_streamer) === playerSlug;
    var alreadyCaster =
      (game.prod_cast_1 && String(game.prod_cast_1) === playerSlug) ||
      (game.prod_cast_2 && String(game.prod_cast_2) === playerSlug);
    var alreadySpielleiter =
      game.prod_spielleiter && String(game.prod_spielleiter) === playerSlug;

    var hasOtherRole =
      (roleKey === "streamer" && (alreadyCaster || alreadySpielleiter)) ||
      (roleKey === "caster" && (alreadyStreamer || alreadySpielleiter)) ||
      (roleKey === "spielleiter" && (alreadyStreamer || alreadyCaster));

    var ok;

    // 1) Spieler ist selbst in diesem Spiel eingetragen (höchste Priorität)
    if (isPlayerInGame) {
      ok = window.confirm(
        "ACHTUNG! Du spielst in diesem Spiel selbst. Möchtest du dich wirklich zusätzlich als " +
          roleLabel +
          " eintragen?"
      );
    }
    // 2) Spieler hat bereits eine andere Produktionsrolle
    else if (hasOtherRole) {
      var existingRoles = [];
      if (alreadyStreamer) existingRoles.push("Streamer");
      if (alreadyCaster) existingRoles.push("Kommentator");
      if (alreadySpielleiter) existingRoles.push("Spielleiter");

      var existingRolesLabel = existingRoles.join(" und ");

      ok = window.confirm(
        "Du bist in diesem Spiel bereits als " +
          existingRolesLabel +
          " eingetragen. Möchtest du dich wirklich zusätzlich als " +
          roleLabel +
          " eintragen?"
      );
    }
    // 3) Standarddialog
    else {
      ok = window.confirm(
        "Möchtest du dich als " +
          roleLabel +
          " für " +
          titleLabel +
          " am " +
          dateLabel +
          " um " +
          timeLabel +
          ' eintragen? Du kannst im Notfall später über "Termine" absagen.'
      );
    }

    if (!ok) {
      return;
    }

    var columnName = null;

    if (roleKey === "streamer") {
      columnName = "prod_streamer";
      if (game[columnName]) {
        // Already filled, do not overwrite
        return;
      }
    } else if (roleKey === "spielleiter") {
      columnName = "prod_spielleiter";
      if (game[columnName]) {
        return;
      }
    } else if (roleKey === "caster") {
      // Caster uses two slots: prod_cast_1 + prod_cast_2
      if (!game.prod_cast_1) {
        columnName = "prod_cast_1";
      } else if (!game.prod_cast_2) {
        columnName = "prod_cast_2";
      } else {
        // No free caster slot left
        return;
      }
    } else {
      // Unknown role, nothing to do
      return;
    }

    if (!columnName) return;

    var payload = {};
    payload[columnName] = playerSlug;

    // Update row in Supabase
    var result = await TF.supabase
      .from("games")
      .update(payload)
      .eq("slug", gameSlug);

    if (result && result.error) {
      console.warn(
        "[terminfinder] production role registration failed:",
        result.error
      );
      return;
    }

    // Update in-memory caches
    game[columnName] = playerSlug;

    try {
      if (Array.isArray(TF._productionGames)) {
        TF._productionGames.forEach(function (g) {
          if (g && String(g.slug || "") === gameSlug) {
            g[columnName] = playerSlug;
          }
        });
      }

      if (Array.isArray(TF._calendarGames)) {
        TF._calendarGames.forEach(function (g) {
          if (g && String(g.slug || "") === gameSlug) {
            g[columnName] = playerSlug;
          }
        });
      }

      if (Array.isArray(TF._gamesForTeam)) {
        TF._gamesForTeam.forEach(function (g) {
          if (g && String(g.slug || "") === gameSlug) {
            g[columnName] = playerSlug;
          }
        });
      }
    } catch (eCache) {
      console.warn(
        "[terminfinder] in-memory games cache update failed:",
        eCache
      );
    }

    // Update any cached games in localStorage
    tfProductionUpdateLocalGamesCache(gameSlug, columnName, playerSlug);

    // Refresh staff display and status flags for all cards
    if (typeof tfProductionFillStaff === "function") {
      await tfProductionFillStaff();
    }
    if (typeof tfProductionDetermineStatus === "function") {
      tfProductionDetermineStatus();
    }
  } catch (e) {
    console.warn("[terminfinder] production role registration error:", e);
  } finally {
    $btn.data("productionBusy", false);
  }
});

// =============================================================================
// Events & URL Params
// =============================================================================

// [HELPERS] -------------------------------------------------------------------
function tfNormalizeSlugParam(value) {
  if (value == null) return "";
  var s = String(value).trim();
  if (!s) return "";

  // Strip matching surrounding quotes ("..." or '...')
  var first = s.charAt(0);
  var last = s.charAt(s.length - 1);
  if (
    s.length >= 2 &&
    ((first === '"' && last === '"') || (first === "'" && last === "'"))
  ) {
    s = s.substring(1, s.length - 1).trim();
  }
  return s;
}
function tfRemoveUrlParam(paramName) {
  if (!paramName) return;
  try {
    var href = String(window.location.href || "");
    var url = new URL(href);
    url.searchParams.delete(paramName);
    var newUrl = url.pathname + url.search + url.hash;
    window.history.replaceState({}, "", newUrl);
  } catch (e) {
    console.warn("[terminfinder] tfRemoveUrlParam failed:", e);
  }
}

// [EVENTS – GAMES] -----------------------------------------------------------
function eventGameBySlug(slug) {
  var s = tfNormalizeSlugParam(slug);
  if (!s) return;

  // Switch to "Spiele" tab
  if (typeof tfActivateTab === "function") {
    tfActivateTab("Spiele");
  }

  // Locate games list container
  var $root = $('[data-base="games-list"]').first();
  if (!$root.length) {
    var $pane = $('.tf-tab.w-tab-pane[data-w-tab="Spiele"]').first();
    if ($pane.length) {
      var $tpl = $pane.find('[data-game="template"]').first();
      $root = $tpl.length ? $tpl.parent() : $pane;
    }
  }
  if (!$root.length) return;

  // Hide all games except the requested slug
  var $cards = $root.find("[data-game]").not('[data-game="template"]');
  if (!$cards.length) return;

  $cards.each(function () {
    var $card = $(this);
    var cardSlug = tfNormalizeSlugParam($card.attr("data-game"));
    if (!cardSlug) return;
    if (cardSlug === s) {
      $card.removeClass("is--hidden");
    } else {
      $card.addClass("is--hidden");
    }
  });

  // Show "show all" control
  var $showAll = $('[data-games="show-all"]').first();
  if ($showAll.length) {
    $showAll.removeClass("is--hidden");
  }
}

function eventGameBySlugReset() {
  var $root = $('[data-base="games-list"]').first();
  if (!$root.length) {
    var $pane = $('.tf-tab.w-tab-pane[data-w-tab="Spiele"]').first();
    if ($pane.length) {
      var $tpl = $pane.find('[data-game="template"]').first();
      $root = $tpl.length ? $tpl.parent() : $pane;
    }
  }

  if ($root.length) {
    $root
      .find("[data-game]")
      .not('[data-game="template"]')
      .removeClass("is--hidden");
  }

  var $showAll = $('[data-games="show-all"]').first();
  if ($showAll.length) {
    $showAll.addClass("is--hidden");
  }
}

$(document).on("click", '[data-games="show-all"]', function (e) {
  e.preventDefault();
  eventGameBySlugReset();
  tfRemoveUrlParam("game");
});

// [EVENTS – PRODUCTION] ------------------------------------------------------
function eventProductionBySlug(slug) {
  var s = tfNormalizeSlugParam(slug);
  if (!s) return;

  // Switch to "Produktion" tab
  if (typeof tfActivateTab === "function") {
    tfActivateTab("Produktion");
  }

  var $list = $('[data-production="list"]').first();
  if (!$list.length) return;

  var $cards = $list.find("[data-game]").not('[data-game="template"]');
  if (!$cards.length) return;

  $cards.each(function () {
    var $card = $(this);
    var cardSlug = tfNormalizeSlugParam($card.attr("data-game"));
    if (!cardSlug) return;
    if (cardSlug === s) {
      $card.removeClass("is--hidden");
    } else {
      $card.addClass("is--hidden");
    }
  });

  var $showAll = $('[data-production="show-all"]').first();
  if ($showAll.length) {
    $showAll.removeClass("is--hidden");
  }
}

function eventProductionBySlugReset() {
  var $list = $('[data-production="list"]').first();
  if ($list.length) {
    $list
      .find("[data-game]")
      .not('[data-game="template"]')
      .removeClass("is--hidden");
  }

  var $showAll = $('[data-production="show-all"]').first();
  if ($showAll.length) {
    $showAll.addClass("is--hidden");
  }
}

$(document).on("click", '[data-production="show-all"]', function (e) {
  e.preventDefault();
  eventProductionBySlugReset();
  tfRemoveUrlParam("prod");
});

// [EVENTS – SUGGESTOR] -------------------------------------------------------
function eventPrefilledSuggestor(slug) {
  var s = tfNormalizeSlugParam(slug);
  if (!s) return;

  // Switch to "Vorschlag" tab
  if (typeof tfActivateTab === "function") {
    tfActivateTab("Vorschlag");
  }

  // Delegate to existing suggestor logic
  if (typeof tfSetActiveSuggestorGame === "function") {
    tfSetActiveSuggestorGame(s);
  }
}

// [URL PARAMS] --------------------------------------------------------------
/**
 * Read URL parameters and trigger high-level events:
 *  - ?suggestor=<slug> or ?suggestor="<slug>"
 *  - ?game=<slug>      or ?game="<slug>"
 *  - ?prod=<slug>      or ?prod="<slug>"
 */
function tfApplyUrlEvents() {
  var href = "";
  try {
    href = String(window.location.href || "");
  } catch (_) {
    href = "";
  }
  if (!href) return;

  var urlObj;
  try {
    urlObj = new URL(href);
  } catch (_) {
    return;
  }

  var params = urlObj.searchParams;
  if (!params) return;

  var raw;
  var slug;

  // 1) suggestor
  raw = params.get("suggestor");
  if (raw != null && raw !== "") {
    slug = tfNormalizeSlugParam(raw);
    if (slug) {
      eventPrefilledSuggestor(slug);
      return;
    }
  }

  // 2) game
  raw = params.get("game");
  if (raw != null && raw !== "") {
    slug = tfNormalizeSlugParam(raw);
    if (slug) {
      eventGameBySlug(slug);
      return;
    }
  }

  // 3) prod
  raw = params.get("prod");
  if (raw != null && raw !== "") {
    slug = tfNormalizeSlugParam(raw);
    if (slug) {
      eventProductionBySlug(slug);
      return;
    }
  }
}

// Also apply once after initial DOM ready
$(function () {
  if (typeof tfApplyUrlEvents === "function") {
    tfApplyUrlEvents();
  }
});

// =============================================================================
// Calendar Events
// =============================================================================

// [STATE] ---------------------------------------------------------------------
TF._calendarEventGames = TF._calendarEventGames || [];

// [PANE HELPER] --------------------------------------------------------------
function tfCalendarFindPane() {
  var $pane = $('.w-tab-pane[data-w-tab="Kalender"]').first();
  if (!$pane.length) {
    $pane = $('[data-w-tab="Kalender"]').first();
  }
  return $pane;
}

// [LOCAL GAMES HELPER] -------------------------------------------------------
function tfCalendarReadGamesFromLocal() {
  var games = [];

  // 1) Versuche generische LocalStorage-Keys, die Spiele enthalten
  if (typeof window !== "undefined" && window.localStorage) {
    try {
      var ls = window.localStorage;

      for (var i = 0; i < ls.length; i++) {
        var key = ls.key(i);
        if (!key) continue;

        var lowered = String(key).toLowerCase();
        if (lowered.indexOf("game") === -1) continue;

        var raw = ls.getItem(key);
        if (!raw) continue;

        var parsed;
        try {
          parsed = JSON.parse(raw);
        } catch (_) {
          continue;
        }

        function collectFromArray(arr) {
          if (!Array.isArray(arr)) return;
          for (var j = 0; j < arr.length; j++) {
            var row = arr[j];
            if (row && row.slug) {
              games.push(row);
            }
          }
        }

        if (Array.isArray(parsed)) {
          collectFromArray(parsed);
        } else if (parsed && typeof parsed === "object") {
          if (Array.isArray(parsed.data)) collectFromArray(parsed.data);
          if (Array.isArray(parsed.items)) collectFromArray(parsed.items);
          if (Array.isArray(parsed.value)) collectFromArray(parsed.value);
        }
      }
    } catch (e) {
      console.warn(
        "[terminfinder] tfCalendarReadGamesFromLocal localStorage warning:",
        e
      );
    }
  }

  // 2) Fallback: globale Preloads
  if (
    (!Array.isArray(games) || games.length === 0) &&
    window.__supabasePreload &&
    Array.isArray(window.__supabasePreload.games)
  ) {
    games = window.__supabasePreload.games.slice();
  }

  // 3) Dedup nach slug
  var bySlug = {};
  var result = [];

  (games || []).forEach(function (row) {
    if (!row || !row.slug) return;
    var key = String(row.slug).toLowerCase();
    bySlug[key] = row;
  });

  Object.keys(bySlug).forEach(function (k) {
    result.push(bySlug[k]);
  });

  return result;
}

// [GAME LOOKUP] --------------------------------------------------------------
function tfCalendarGetGameBySlug(slug) {
  if (!slug) return null;
  var s = String(slug).toLowerCase();
  var list = Array.isArray(TF._calendarEventGames)
    ? TF._calendarEventGames
    : [];
  for (var i = 0; i < list.length; i++) {
    var g = list[i];
    if (!g || !g.slug) continue;
    if (String(g.slug).toLowerCase() === s) return g;
  }
  return null;
}

// [DETERMINE CALENDAR EVENT GAMES] -------------------------------------------
function tfCalendarDetermineEventGames() {
  if (!TF || !TF.player || !TF.player.slug) {
    return [];
  }

  // 1) Primäre Quelle: TF._calendarGames (aus tfRefreshGamesSection)
  var allGames = [];
  if (Array.isArray(TF._calendarGames) && TF._calendarGames.length) {
    allGames = TF._calendarGames.slice();
  } else {
    // 2) Fallback: LocalStorage / __supabasePreload
    allGames = tfCalendarReadGamesFromLocal();
  }

  if (!Array.isArray(allGames) || !allGames.length) {
    return [];
  }

  var playerSlug = String(TF.player.slug || "").toLowerCase();
  var teamSlugLower = "";

  if (TF.team && TF.team.slug) {
    teamSlugLower = String(TF.team.slug || "").toLowerCase();
  } else if (TF.player && TF.player.team_slug) {
    teamSlugLower = String(TF.player.team_slug || "").toLowerCase();
  }

  var result = [];

  allGames.forEach(function (g) {
    if (!g || !g.slug || !g.datetime) return;

    var roles = {
      player: false,
      streamer: false,
      caster: false,
      spielleiter: false,
    };

    var t1 = String(g.t1_slug || "").toLowerCase();
    var t2 = String(g.t2_slug || "").toLowerCase();

    // Spieler-Rolle: Mitglied eines der beiden Teams
    if (teamSlugLower && (t1 === teamSlugLower || t2 === teamSlugLower)) {
      roles.player = true;
    }

    // Produktions-Rollen (immer auf player.slug vergleichen)
    if (playerSlug) {
      if (String(g.prod_streamer || "").toLowerCase() === playerSlug) {
        roles.streamer = true;
      }
      if (
        String(g.prod_cast_1 || "").toLowerCase() === playerSlug ||
        String(g.prod_cast_2 || "").toLowerCase() === playerSlug
      ) {
        roles.caster = true;
      }
      if (String(g.prod_spielleiter || "").toLowerCase() === playerSlug) {
        roles.spielleiter = true;
      }
    }

    var hasAnyRole =
      roles.player || roles.streamer || roles.caster || roles.spielleiter;

    if (!hasAnyRole) return;

    // Kopie mit Rolleninfo
    var clone = {};
    for (var k in g) {
      if (Object.prototype.hasOwnProperty.call(g, k)) {
        clone[k] = g[k];
      }
    }
    clone.__calendarRoles = roles;

    result.push(clone);
  });

  return result;
}

// [ROLE CLASSES + PILLS] -----------------------------------------------------
function tfCalendarApplyRoleClasses($card, roles) {
  if (!$card || !$card.length) return;

  roles = roles || {};

  $card
    .removeClass("is--player is--streamer is--caster is--spielleiter")
    .removeClass("is--player is--streamer is--caster is--spielleiter");

  if (roles.player) $card.addClass("is--player");
  if (roles.streamer) $card.addClass("is--streamer");
  if (roles.caster) $card.addClass("is--caster");
  if (roles.spielleiter) $card.addClass("is--spielleiter");

  function togglePill(selector, active) {
    var $pill = $card.find(selector).first();
    if (!$pill.length) return;
    if (active) {
      $pill.removeAttr("hidden");
    } else {
      $pill.attr("hidden", true);
    }
  }

  togglePill('[data-events="role-player"]', !!roles.player);
  togglePill('[data-events="role-streamer"]', !!roles.streamer);
  togglePill('[data-events="role-caster"]', !!roles.caster);
  togglePill('[data-events="role-spielleiter"]', !!roles.spielleiter);
}

// [DATETIME FORMAT] ----------------------------------------------------------
function tfCalendarFormatDatetimeShort(datetimeIso) {
  if (!datetimeIso) return "";

  if (typeof convertDateTime === "function") {
    try {
      return convertDateTime(datetimeIso, "datetime-short");
    } catch (e) {
      console.warn("[terminfinder] convertDateTime(datetime-short) failed:", e);
    }
  }

  try {
    var d = new Date(datetimeIso);
    if (!d || isNaN(d.getTime())) return "";
    return d.toLocaleString("de-DE", {
      weekday: "short",
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch (_) {
    return "";
  }
}

// [BASIC GAME DATA] ----------------------------------------------------------
function tfCalendarFillBasicGameData($card, game) {
  if (!$card || !$card.length || !game) return;

  var dtText = tfCalendarFormatDatetimeShort(game.datetime || null);
  setTextIfExists(
    $card.find('[data-base="datetime-short"]').first(),
    dtText || ""
  );

  setTextIfExists(
    $card.find('[data-base="name"]').first(),
    String(game.name || "")
  );
}

// [TEAM DATA] ----------------------------------------------------------------
async function tfCalendarFillTeamData($pane) {
  if (!$pane || !$pane.length) return;
  if (typeof fetchTeamBundle !== "function") {
    console.warn(
      "[terminfinder] fetchTeamBundle not available for calendar events."
    );
    return;
  }

  var $cards = $pane.find("[data-game]").not('[data-game="template"]');
  if (!$cards.length) return;

  var teamVmCache = {};

  async function ensureTeamVm(slug) {
    if (!slug) return null;
    var key = String(slug).toLowerCase();
    if (!teamVmCache[key]) {
      teamVmCache[key] = {
        slug: slug,
        tname: "",
        players: "",
        logo72: "",
        ready: false,
        promise: null,
      };
    }

    var vm = teamVmCache[key];
    if (vm.ready && !vm.promise) return vm;
    if (!vm.promise) {
      vm.promise = (async function () {
        try {
          var bundle = await fetchTeamBundle(slug);
          if (bundle && bundle.team) {
            vm.tname = bundle.team.tname || bundle.team.slug || "";
          }

          // Use players line from base_teams
          if (
            bundle &&
            bundle.team &&
            typeof bundle.team.players === "string"
          ) {
            vm.players = bundle.team.players;
          } else {
            vm.players = "";
          }

          if (
            bundle &&
            bundle.team &&
            bundle.team.slug &&
            typeof buildAssetUrl === "function"
          ) {
            try {
              vm.logo72 = buildAssetUrl(
                "teams",
                bundle.team.slug,
                "logo-72-flat"
              );
            } catch (eLogo) {
              console.warn(
                "[terminfinder] calendar logo asset url error:",
                eLogo
              );
            }
          }

          vm.ready = true;
          return vm;
        } catch (e) {
          console.warn("[terminfinder] fetchTeamBundle calendar failed:", e);
          vm.ready = true;
          return vm;
        } finally {
          vm.promise = null;
        }
      })();
    }

    return vm.promise;
  }

  for (var i = 0; i < $cards.length; i++) {
    var $card = $cards.eq(i);
    var slug = String($card.attr("data-game") || "").trim();
    if (!slug) continue;

    var game = tfCalendarGetGameBySlug(slug);
    if (!game) continue;

    var t1Slug = game.t1_slug || null;
    var t2Slug = game.t2_slug || null;

    var vm1 = t1Slug ? await ensureTeamVm(t1Slug) : null;
    var vm2 = t2Slug ? await ensureTeamVm(t2Slug) : null;

    var $t1 = $card.find('[data-base="t1"]').first();
    var $t2 = $card.find('[data-base="t2"]').first();

    if ($t1.length && vm1) {
      setTextIfExists($t1.find('[data-base="tname"]').first(), vm1.tname || "");
      setTextIfExists($t1.find('[data-base="players"]').first(), vm1.players);

      if (vm1.logo72) {
        var $logo1 = $t1.find('[data-base="logo-72-flat"]').first();
        if ($logo1.length) {
          $logo1.css("background-image", 'url("' + vm1.logo72 + '")');
        }
      }
    }

    if ($t2.length && vm2) {
      setTextIfExists($t2.find('[data-base="tname"]').first(), vm2.tname || "");
      setTextIfExists($t2.find('[data-base="players"]').first(), vm2.players);

      if (vm2.logo72) {
        var $logo2 = $t2.find('[data-base="logo-72-flat"]').first();
        if ($logo2.length) {
          $logo2.css("background-image", 'url("' + vm2.logo72 + '")');
        }
      }
    }
  }
}

// [RENDER CALENDAR EVENTS] ---------------------------------------------------
async function tfCalendarRenderEvents() {
  var $pane = tfCalendarFindPane();
  if (!$pane.length) return;

  var $template = $pane.find('[data-game="template"]').first();
  if (!$template.length) return;

  var $divider = $pane.find('[data-events="divider"]').first();
  var $wrap = $pane.find('[data-events="wrap"]').first();

  // Template als Template markieren + verstecken
  $template.addClass("is--template").attr("hidden", true);

  // Vorherige Karten entfernen (aber Template behalten)
  $pane.find("[data-game]").not($template).remove();

  var games = tfCalendarDetermineEventGames();
  TF._calendarEventGames = Array.isArray(games) ? games.slice() : [];

  // Empty-State: keine Spiele vorhanden
  if (!games.length) {
    if ($wrap.length) {
      $wrap.addClass("is--empty");
    }
    return;
  } else if ($wrap.length) {
    // Es gibt Spiele -> Empty-State entfernen
    $wrap.removeClass("is--empty");
  }

  var nowMs = Date.now();
  var future = [];
  var past = [];

  games.forEach(function (g) {
    if (!g || !g.slug || !g.datetime) return;
    var dtMs = new Date(g.datetime).getTime();
    if (!isFinite(dtMs)) return;

    var entry = { game: g, dtMs: dtMs };
    if (dtMs >= nowMs) {
      future.push(entry);
    } else {
      past.push(entry);
    }
  });

  future.sort(function (a, b) {
    return a.dtMs - b.dtMs;
  });
  past.sort(function (a, b) {
    return b.dtMs - a.dtMs;
  });

  // Empty-State: Spiele vorhanden, aber keine gültigen future/past-Einträge
  if (!future.length && !past.length) {
    if ($wrap.length) {
      $wrap.addClass("is--empty");
    }
    return;
  }

  var $lastFuture = $template;
  var i, entry, game, $card;

  // Zukünftige Spiele direkt beim Template einsortieren
  for (i = 0; i < future.length; i++) {
    entry = future[i];
    game = entry.game;
    $card = $template.clone(true);

    $card
      .removeClass("is--template is--past")
      .removeAttr("hidden")
      .attr("data-game", game.slug);

    tfCalendarApplyRoleClasses($card, game.__calendarRoles);
    tfCalendarFillBasicGameData($card, game);

    $card.insertAfter($lastFuture);
    $lastFuture = $card;
  }

  // Vergangene Spiele unterhalb des Dividers einsortieren
  var $anchorForPast = $divider.length ? $divider : $lastFuture;

  for (i = 0; i < past.length; i++) {
    entry = past[i];
    game = entry.game;
    $card = $template.clone(true);

    $card
      .removeClass("is--template")
      .addClass("is--past")
      .removeAttr("hidden")
      .attr("data-game", game.slug);

    tfCalendarApplyRoleClasses($card, game.__calendarRoles);
    tfCalendarFillBasicGameData($card, game);

    $card.insertAfter($anchorForPast);
    $anchorForPast = $card;
  }

  // Teams / Logos / Spieler füllen
  try {
    await tfCalendarFillTeamData($pane);
  } catch (e) {
    console.warn("[terminfinder] tfCalendarFillTeamData failed:", e);
  }

  // Calloff-UI Grundzustand setzen
  tfCalendarInitCalloffState($pane);
}

// =============================================================================
// Calling off Calendar Events
// =============================================================================

// [CALLOFF STATE INIT] -------------------------------------------------------
function tfCalendarInitCalloffState($pane) {
  if (!$pane || !$pane.length) return;

  var $cards = $pane.find("[data-game]").not('[data-game="template"]');

  $cards.each(function () {
    var $card = $(this);

    $card.removeClass("is--expanded is--warning is--cfwarning");

    // Checkboxes zurücksetzen
    $card.find('input[type="checkbox"][data-calloff]').each(function () {
      $(this).prop("checked", false).prop("disabled", false);
    });

    // Produktions-Optionen reaktivieren
    $card.find('[data-calloff="production"]').each(function () {
      $(this).removeClass("is--disabled");
    });

    // Warning-Text leeren
    var $warningDay = $card.find('[data-calloff="warning-days"]').first();
    if ($warningDay.length) {
      setTextIfExists($warningDay, "");
    }

    // Falls es genau eine Rolle gibt: entsprechende Checkbox vorselektieren
    var slug = String($card.attr("data-game") || "").trim();
    var game = tfCalendarGetGameBySlug(slug);
    if (game && game.__calendarRoles) {
      var roles = game.__calendarRoles || {};
      var activeRoles = [];

      if (roles.player) activeRoles.push("player");
      if (roles.streamer) activeRoles.push("streamer");
      if (roles.caster) activeRoles.push("caster");
      if (roles.spielleiter) activeRoles.push("spielleiter");

      if (activeRoles.length === 1) {
        var roleName = activeRoles[0];

        // "player" auf Spiel-Absage mappen, weil es kein data-calloff="player" gibt
        var dataCalloffName = roleName === "player" ? "game" : roleName;

        var $roleCheckbox = $card
          .find(
            'input[type="checkbox"][data-calloff="' + dataCalloffName + '"]'
          )
          .first();

        if ($roleCheckbox.length) {
          $roleCheckbox.prop("checked", true);
        }
      }
    }

    // Initialen State komplett berechnen (inkl. Warning & Button-State)
    tfCalendarUpdateCalloffStateForCard($card);
  });
}

// [BUTTON TEXT HELPER] -------------------------------------------------------
function tfCalendarSetCalloffButtonText($card, isWarning) {
  if (!$card || !$card.length) return;

  var $btn = $card.find('[data-calloff="button"]').first();
  if (!$btn.length) return;

  var $gameCheckbox = $card
    .find('input[type="checkbox"][data-calloff="game"]')
    .first();
  var isGameMode = $gameCheckbox.length
    ? !!$gameCheckbox.prop("checked")
    : false;

  var label = "❌ Jetzt absagen";

  if (isGameMode && isWarning) {
    label = "❌ Trotzdem absagen und neue Vorschläge einreichen";
  } else if (isGameMode) {
    label = "❌ Absagen und neue Vorschläge einreichen";
  }

  setTextIfExists($btn, label);
}

// [BUTTON STATE HELPER] -------------------------------------------------------
function tfCalendarUpdateCalloffButtonStateForCard($card) {
  if (!$card || !$card.length) return;

  var $btn = $card.find('[data-calloff="button"]').first();
  if (!$btn.length) return;

  // Reason: Input/Textarea/ggf. contenteditable
  var $reason = $card.find('[data-calloff="reason"]').first();
  var reasonVal = "";
  if ($reason.length) {
    if (typeof $reason.val === "function") {
      reasonVal = String($reason.val() || "").trim();
    }
    if (!reasonVal && $reason.is("[contenteditable=true]")) {
      reasonVal = String($reason.text() || "").trim();
    }
  }
  var hasReason = !!reasonVal;

  // Rollen-Checkboxen
  var $roleCheckboxes = $card.find(
    'input[type="checkbox"][data-calloff="player"],' +
      'input[type="checkbox"][data-calloff="streamer"],' +
      'input[type="checkbox"][data-calloff="caster"],' +
      'input[type="checkbox"][data-calloff="spielleiter"]'
  );

  var anyRoleChecked = false;
  $roleCheckboxes.each(function () {
    if ($(this).prop("checked")) {
      anyRoleChecked = true;
      return false;
    }
  });

  // Spiel-Checkbox
  var $gameCheckbox = $card
    .find('input[type="checkbox"][data-calloff="game"]')
    .first();
  var gameChecked = $gameCheckbox.length
    ? !!$gameCheckbox.prop("checked")
    : false;

  // Formular kann gesendet werden, wenn:
  // - Reason gefüllt ist UND
  // - entweder Spiel-Absage aktiv ist ODER mindestens eine Rolle gewählt ist
  var canSend = hasReason && (gameChecked || anyRoleChecked);

  $btn.toggleClass("is--disabled", !canSend);
}

// [DAYS UNTIL GAME] ----------------------------------------------------------
function tfCalendarComputeDaysUntil(game) {
  if (!game || !game.datetime) return null;
  var dt;
  try {
    dt = new Date(game.datetime);
  } catch (_) {
    return null;
  }
  if (!dt || isNaN(dt.getTime())) return null;

  var now = new Date();
  var diffMs = dt.getTime() - now.getTime();
  if (diffMs < 0) return null;

  var oneDay = 24 * 60 * 60 * 1000;
  return Math.ceil(diffMs / oneDay);
}

// [CALLOFF STATE UPDATE] -----------------------------------------------------
function tfCalendarUpdateCalloffStateForCard($card) {
  if (!$card || !$card.length) return;

  var $gameCheckbox = $card
    .find('input[type="checkbox"][data-calloff="game"]')
    .first();
  var isGameMode = $gameCheckbox.length
    ? !!$gameCheckbox.prop("checked")
    : false;

  // Produktions-Checkboxen und Wrapper
  var $prodWrappers = $card.find('[data-calloff="production"]');
  $prodWrappers.each(function () {
    var $wrap = $(this);
    $wrap.toggleClass("is--disabled", isGameMode);

    var $cb = $wrap.find('input[type="checkbox"]').first();
    if ($cb.length) {
      $cb.prop("disabled", isGameMode);
      if (isGameMode) {
        $cb.prop("checked", false);
      }
    }
  });

  // Conditional Warning
  var isWarning = false;
  var daysLeft = null;

  if (isGameMode && typeof TF_CAL_GROUP_MIN_DAYS_IN_FUTURE === "number") {
    var slug = String($card.attr("data-game") || "").trim();
    var game = tfCalendarGetGameBySlug(slug);
    if (game) {
      daysLeft = tfCalendarComputeDaysUntil(game);
      if (daysLeft !== null && daysLeft <= TF_CAL_GROUP_MIN_DAYS_IN_FUTURE) {
        isWarning = true;
      }
    }
  }

  var $warningDay = $card.find('[data-calloff="warning-days"]').first();

  if ($warningDay.length) {
    if (isWarning && daysLeft !== null) {
      setTextIfExists($warningDay, String(daysLeft));
    } else {
      setTextIfExists($warningDay, "");
    }
  }

  $card.toggleClass("is--cfwarning", !!isWarning);

  tfCalendarSetCalloffButtonText($card, isWarning);

  // Nach allen Änderungen Button-Status updaten
  tfCalendarUpdateCalloffButtonStateForCard($card);
}

// [UI WIRING] ----------------------------------------------------------------
TF._calendarCalloffUiInitialized = TF._calendarCalloffUiInitialized || false;

function tfCalendarInitCalloffUI() {
  if (TF._calendarCalloffUiInitialized) return;
  var $pane = tfCalendarFindPane();
  if (!$pane.length) return;

  // Accordion: Formular ein-/ausklappen
  $pane.on("click", '[data-events="calloff"]', function (e) {
    e.preventDefault();
    var $gameCard = $(this).closest("[data-game]").first();
    if (!$gameCard.length) return;
    $gameCard.toggleClass("is--expanded");
  });

  // Checkbox "Spiel absagen"
  $pane.on(
    "change",
    'input[type="checkbox"][data-calloff="game"]',
    function () {
      var $card = $(this).closest("[data-game]").first();
      if (!$card.length) return;
      tfCalendarUpdateCalloffStateForCard($card);
    }
  );

  // Rollen-Checkboxen (player/streamer/caster/spielleiter)
  $pane.on(
    "change",
    'input[type="checkbox"][data-calloff]:not([data-calloff="game"])',
    function () {
      var $card = $(this).closest("[data-game]").first();
      if (!$card.length) return;
      tfCalendarUpdateCalloffButtonStateForCard($card);
    }
  );

  // Reason-Feld (Input/Textarea/ggf. contenteditable)
  $pane.on("input change blur", '[data-calloff="reason"]', function () {
    var $card = $(this).closest("[data-game]").first();
    if (!$card.length) return;
    tfCalendarUpdateCalloffButtonStateForCard($card);
  });

  // Calloff-Button
  $pane.on("click", '[data-calloff="button"]', function (e) {
    e.preventDefault();
    var $card = $(this).closest("[data-game]").first();
    if (!$card.length) return;

    // Wenn noch disabled -> nichts tun
    if ($(this).hasClass("is--disabled")) {
      return;
    }

    var $gameCheckbox = $card
      .find('input[type="checkbox"][data-calloff="game"]')
      .first();
    var isGameMode = $gameCheckbox.length
      ? !!$gameCheckbox.prop("checked")
      : false;

    if (isGameMode) {
      tfCalendarCalloffGame($card);
    } else {
      tfCalendarCalloffProduction($card);
    }
  });

  TF._calendarCalloffUiInitialized = true;
}

// [HELPER] ---------------------------------------------------------------
// Patch a single game across in-memory caches (__supabasePreload + TF._*).
function tfCalendarPatchGameInMemory(slug, patch) {
  if (!slug || !patch) return;
  var slugLower = String(slug).toLowerCase();

  function patchList(list) {
    if (!Array.isArray(list)) return;
    for (var i = 0; i < list.length; i++) {
      var g = list[i];
      if (!g || !g.slug) continue;
      if (String(g.slug).toLowerCase() !== slugLower) continue;
      for (var k in patch) {
        if (Object.prototype.hasOwnProperty.call(patch, k)) {
          g[k] = patch[k];
        }
      }
    }
  }

  if (typeof TF !== "undefined") {
    if (Array.isArray(TF._calendarGames)) {
      patchList(TF._calendarGames);
    }
    if (Array.isArray(TF._calendarEventGames)) {
      patchList(TF._calendarEventGames);
    }
  }

  if (
    typeof window !== "undefined" &&
    window.__supabasePreload &&
    Array.isArray(window.__supabasePreload.games)
  ) {
    patchList(window.__supabasePreload.games);
  }
}

// [CALLOFF GAME] -------------------------------------------------------------
async function tfCalendarCalloffGame($card) {
  var slug =
    $card && $card.length ? String($card.attr("data-game") || "").trim() : null;
  if (!slug) {
    alert("Fehler: Spiel konnte nicht ermittelt werden.");
    return;
  }

  var supabase = null;
  if (
    typeof TF !== "undefined" &&
    TF.supabase &&
    typeof TF.supabase.from === "function"
  ) {
    supabase = TF.supabase;
  } else if (
    typeof window !== "undefined" &&
    window.supabase &&
    typeof window.supabase.from === "function"
  ) {
    supabase = window.supabase;
  }

  if (!supabase) {
    console.warn(
      "[terminfinder] Supabase client not available for calloff game."
    );
    alert("Fehler: Verbindung zur Datenbank ist nicht verfügbar.");
    return;
  }

  var game = tfCalendarGetGameBySlug(slug);
  if (!game) {
    alert("Fehler: Spieldaten konnten nicht geladen werden.");
    return;
  }

  // Reason einlesen
  var $reason = $card.find('[data-calloff="reason"]').first();
  var reasonVal = "";
  if ($reason.length && typeof $reason.val === "function") {
    reasonVal = String($reason.val() || "").trim();
  }
  if (!reasonVal && $reason.length && $reason.is("[contenteditable=true]")) {
    reasonVal = String($reason.text() || "").trim();
  }
  if (!reasonVal) {
    alert("Bitte gib einen Grund für die Absage an.");
    return;
  }

  // Spieler- / Team-Kontext
  var playerName =
    TF && TF.player && TF.player.pname
      ? TF.player.pname
      : TF && TF.player && TF.player.slug
      ? TF.player.slug
      : "";

  var teamSlugLower = "";
  if (TF && TF.team && TF.team.slug) {
    teamSlugLower = String(TF.team.slug || "").toLowerCase();
  } else if (TF && TF.player && TF.player.team_slug) {
    teamSlugLower = String(TF.player.team_slug || "").toLowerCase();
  }

  var t1Slug = game.t1_slug || null;
  var t2Slug = game.t2_slug || null;
  var t1Lower = t1Slug ? String(t1Slug).toLowerCase() : "";
  var t2Lower = t2Slug ? String(t2Slug).toLowerCase() : "";

  var userTeamSlug = null;
  var enemyTeamSlug = null;
  if (teamSlugLower && t1Lower === teamSlugLower) {
    userTeamSlug = t1Slug;
    enemyTeamSlug = t2Slug;
  } else if (teamSlugLower && t2Lower === teamSlugLower) {
    userTeamSlug = t2Slug;
    enemyTeamSlug = t1Slug;
  }

  var errors = [];

  // Discord-Team-Events (Gegner + eigenes Team)
  try {
    if (enemyTeamSlug && userTeamSlug) {
      var insertTeamRows = [
        {
          type: "enemy_canceled_game",
          payload: {
            game_slug: slug,
            old_datetime: game.datetime || null,
            team_slug: enemyTeamSlug,
            opponent_team_slug: userTeamSlug,
            canceled_by: playerName,
            reason: reasonVal,
          },
          processed_at: null,
        },
        {
          type: "you_canceled_game",
          payload: {
            game_slug: slug,
            old_datetime: game.datetime || null,
            opponent_team_slug: enemyTeamSlug,
            team_slug: userTeamSlug,
            canceled_by: playerName,
            reason: reasonVal,
          },
          processed_at: null,
        },
      ];

      var teamRes = await supabase
        .from("tf_discord_team_events")
        .insert(insertTeamRows);
      if (teamRes && teamRes.error) {
        errors.push(
          "Discord-Team-Events konnten nicht erstellt werden: " +
            teamRes.error.message
        );
      }
    }
  } catch (eTeam) {
    console.warn(
      "[terminfinder] tfCalendarCalloffGame team events error:",
      eTeam
    );
    errors.push("Discord-Team-Events konnten nicht erstellt werden.");
  }

  // Discord-Prod-Event (game_canceled) – bestehende Rollen vorher merken
  var prodPayload = {
    game_slug: slug,
    old_datetime: game.datetime || null,
    canceled_by: playerName,
    prod_streamer: game.prod_streamer || null,
    prod_cast_1: game.prod_cast_1 || null,
    prod_cast_2: game.prod_cast_2 || null,
    prod_spielleiter: game.prod_spielleiter || null,
    reason: reasonVal,
  };

  try {
    var prodRes = await supabase.from("tf_discord_prod_events").insert([
      {
        type: "game_canceled",
        payload: prodPayload,
        processed_at: null,
      },
    ]);
    if (prodRes && prodRes.error) {
      errors.push(
        "Discord-Produktions-Event konnte nicht erstellt werden: " +
          prodRes.error.message
      );
    }
  } catch (eProd) {
    console.warn(
      "[terminfinder] tfCalendarCalloffGame prod event error:",
      eProd
    );
    errors.push("Discord-Produktions-Event konnte nicht erstellt werden.");
  }

  // Games-Update: Datum + Produktionsrollen leeren
  var gamePatch = {
    datetime: null,
    prod_streamer: null,
    prod_cast_1: null,
    prod_cast_2: null,
    prod_spielleiter: null,
  };

  var updatedGame = null;
  try {
    var gameRes = await supabase
      .from("games")
      .update(gamePatch)
      .eq("slug", slug)
      .select("*")
      .single();

    if (gameRes && gameRes.error) {
      errors.push(
        "Spiel konnte in der Datenbank nicht aktualisiert werden: " +
          gameRes.error.message
      );
    } else if (gameRes && gameRes.data) {
      updatedGame = gameRes.data;
    }
  } catch (eGame) {
    console.warn(
      "[terminfinder] tfCalendarCalloffGame games update error:",
      eGame
    );
    errors.push("Spiel konnte in der Datenbank nicht aktualisiert werden.");
  }

  // tf_suggestions: accepted -> called-off + calloff_reason
  try {
    var suggRes = await supabase
      .from("tf_suggestions")
      .update({
        status: "called-off",
        calloff_reason: reasonVal,
      })
      .eq("game_slug", slug)
      .eq("status", "accepted");

    if (suggRes && suggRes.error) {
      errors.push(
        "Terminvorschläge konnten nicht aktualisiert werden: " +
          suggRes.error.message
      );
    }
  } catch (eSugg) {
    console.warn(
      "[terminfinder] tfCalendarCalloffGame suggestions update error:",
      eSugg
    );
    errors.push("Terminvorschläge konnten nicht aktualisiert werden.");
  }

  // In-Memory-Caches patchen
  var finalPatch = updatedGame || gamePatch;
  tfCalendarPatchGameInMemory(slug, finalPatch);

  // UI auffrischen
  try {
    await tfCalendarRenderEvents();
  } catch (eRender) {
    console.warn(
      "[terminfinder] tfCalendarCalloffGame re-render error:",
      eRender
    );
  }

  if (errors.length) {
    console.error("[terminfinder] calloff game errors:", errors);
    alert(
      "Bei der Spielabsage sind Fehler aufgetreten:\n\n" + errors.join("\n")
    );
    return;
  }

  alert(
    "Das Spiel wurde erfolgreich abgesagt. Bitte reiche direkt neue Terminvorschläge ein!"
  );

  if (typeof eventPrefilledSuggestor === "function") {
    try {
      eventPrefilledSuggestor(slug);
    } catch (eEvt) {
      console.warn("[terminfinder] eventPrefilledSuggestor error:", eEvt);
    }
  }
}

// [CALLOFF PRODUCTION] -------------------------------------------------------------
async function tfCalendarCalloffProduction($card) {
  var slug =
    $card && $card.length ? String($card.attr("data-game") || "").trim() : null;
  if (!slug) {
    alert("Fehler: Spiel konnte nicht ermittelt werden.");
    return;
  }

  var supabase = null;
  if (
    typeof TF !== "undefined" &&
    TF.supabase &&
    typeof TF.supabase.from === "function"
  ) {
    supabase = TF.supabase;
  } else if (
    typeof window !== "undefined" &&
    window.supabase &&
    typeof window.supabase.from === "function"
  ) {
    supabase = window.supabase;
  }

  if (!supabase) {
    console.warn(
      "[terminfinder] Supabase client not available for calloff production."
    );
    alert("Fehler: Verbindung zur Datenbank ist nicht verfügbar.");
    return;
  }

  var game = tfCalendarGetGameBySlug(slug);
  if (!game) {
    alert("Fehler: Spieldaten konnten nicht geladen werden.");
    return;
  }

  // Reason einlesen
  var $reason = $card.find('[data-calloff="reason"]').first();
  var reasonVal = "";
  if ($reason.length && typeof $reason.val === "function") {
    reasonVal = String($reason.val() || "").trim();
  }
  if (!reasonVal && $reason.length && $reason.is("[contenteditable=true]")) {
    reasonVal = String($reason.text() || "").trim();
  }
  if (!reasonVal) {
    alert("Bitte gib einen Grund für die Absage an.");
    return;
  }

  var playerSlug =
    TF && TF.player && TF.player.slug ? String(TF.player.slug || "") : "";
  var playerName =
    TF && TF.player && TF.player.pname ? TF.player.pname : playerSlug || "";

  // Welche Rollen wurden abgewählt?
  var cancelledRoles = [];
  var roleMap = ["streamer", "caster", "spielleiter"];

  for (var i = 0; i < roleMap.length; i++) {
    var roleKey = roleMap[i];
    var $cb = $card
      .find('input[type="checkbox"][data-calloff="' + roleKey + '"]')
      .first();
    if ($cb.length && $cb.prop("checked")) {
      cancelledRoles.push(roleKey);
    }
  }

  if (!cancelledRoles.length) {
    alert(
      "Bitte wähle mindestens eine Produktionsrolle aus, die abgesagt werden soll."
    );
    return;
  }

  var errors = [];

  // Game-Patch nach Rollen
  var gamePatch = {};
  for (var j = 0; j < cancelledRoles.length; j++) {
    var r = cancelledRoles[j];
    if (r === "streamer") {
      // Streamer-Slot leeren, wenn dieser Spieler der Streamer ist (oder allgemein die Rolle freigeben)
      if (!playerSlug || game.prod_streamer === playerSlug) {
        gamePatch.prod_streamer = null;
      }
    } else if (r === "caster") {
      // Caster: die Slots leeren, in denen der Spieler eingetragen ist
      if (!playerSlug || game.prod_cast_1 === playerSlug) {
        gamePatch.prod_cast_1 = null;
      }
      if (!playerSlug || game.prod_cast_2 === playerSlug) {
        gamePatch.prod_cast_2 = null;
      }
    } else if (r === "spielleiter") {
      if (!playerSlug || game.prod_spielleiter === playerSlug) {
        gamePatch.prod_spielleiter = null;
      }
    }
  }

  // Wenn kein Feld betroffen ist, trotzdem weitermachen (nur Discord-Warnung) – aber warnen
  if (
    !gamePatch.prod_streamer &&
    !gamePatch.prod_cast_1 &&
    !gamePatch.prod_cast_2 &&
    !gamePatch.prod_spielleiter
  ) {
    console.warn(
      "[terminfinder] tfCalendarCalloffProduction: no prod_* field changed by patch."
    );
  }

  // users_to_warn: alle Produktionsrollen außer dem absagenden Spieler
  var warnSlugs = [];
  function pushWarnSlug(sl) {
    if (!sl) return;
    if (playerSlug && sl === playerSlug) return;
    for (var k = 0; k < warnSlugs.length; k++) {
      if (warnSlugs[k] === sl) return;
    }
    warnSlugs.push(sl);
  }

  if (game.prod_streamer) pushWarnSlug(game.prod_streamer);
  if (game.prod_cast_1) pushWarnSlug(game.prod_cast_1);
  if (game.prod_cast_2) pushWarnSlug(game.prod_cast_2);
  if (game.prod_spielleiter) pushWarnSlug(game.prod_spielleiter);

  var usersToWarnDiscord = [];

  if (warnSlugs.length) {
    try {
      var playerRes = await supabase
        .from("players")
        .select("slug, discord_id")
        .in("slug", warnSlugs);

      if (playerRes && playerRes.error) {
        errors.push(
          "Discord-IDs der Produktionscrew konnten nicht geladen werden: " +
            playerRes.error.message
        );
      } else if (playerRes && playerRes.data) {
        playerRes.data.forEach(function (row) {
          if (row && row.discord_id) {
            usersToWarnDiscord.push(row.discord_id);
          }
        });
      }
    } catch (ePlayers) {
      console.warn(
        "[terminfinder] tfCalendarCalloffProduction players lookup error:",
        ePlayers
      );
      errors.push(
        "Discord-IDs der Produktionscrew konnten nicht geladen werden."
      );
    }
  }

  // cancelled_roles – array of all cancelled roles
  var cancelledRolesArray = cancelledRoles.slice(); // shallow copy

  // Discord-Prod-Event: role_canceled
  try {
    var prodRes = await supabase.from("tf_discord_prod_events").insert([
      {
        type: "role_canceled",
        payload: {
          game_slug: slug,
          cancelled_roles: cancelledRolesArray, // ← ARRAY NOW
          canceled_by: playerName,
          users_to_warn: usersToWarnDiscord,
          reason: reasonVal,
        },
        processed_at: null,
      },
    ]);
    if (prodRes && prodRes.error) {
      errors.push(
        "Discord-Produktions-Event konnte nicht erstellt werden: " +
          prodRes.error.message
      );
    }
  } catch (eProd) {
    console.warn(
      "[terminfinder] tfCalendarCalloffProduction prod event error:",
      eProd
    );
    errors.push("Discord-Produktions-Event konnte nicht erstellt werden.");
  }

  // Games-Update (nur die betroffenen Produktionsrollen)
  var updatedGame = null;
  try {
    if (Object.keys(gamePatch).length) {
      var gameRes = await supabase
        .from("games")
        .update(gamePatch)
        .eq("slug", slug)
        .select("*")
        .single();

      if (gameRes && gameRes.error) {
        errors.push(
          "Produktionsrolle konnte in der Datenbank nicht aktualisiert werden: " +
            gameRes.error.message
        );
      } else if (gameRes && gameRes.data) {
        updatedGame = gameRes.data;
      }
    }
  } catch (eGame) {
    console.warn(
      "[terminfinder] tfCalendarCalloffProduction games update error:",
      eGame
    );
    errors.push(
      "Produktionsrolle konnte in der Datenbank nicht aktualisiert werden."
    );
  }

  // In-Memory-Caches patchen
  if (Object.keys(gamePatch).length) {
    tfCalendarPatchGameInMemory(slug, updatedGame || gamePatch);
  }

  // UI auffrischen
  try {
    await tfCalendarRenderEvents();
  } catch (eRender) {
    console.warn(
      "[terminfinder] tfCalendarCalloffProduction re-render error:",
      eRender
    );
  }

  if (errors.length) {
    console.error("[terminfinder] calloff production errors:", errors);
    alert(
      "Bei der Absage der Produktionsrolle sind Fehler aufgetreten:\n\n" +
        errors.join("\n")
    );
    return;
  }

  alert("Die Produktionsrolle wurde erfolgreich abgesagt.");
}

// [ENTRYPOINT] ---------------------------------------------------------------
function tfInitCalendarEvents() {
  // Nur UI binden; Rendering kommt nach tfRefreshGamesSection
  tfCalendarInitCalloffUI();
}

$(function () {
  if (typeof tfInitCalendarEvents === "function") {
    try {
      tfInitCalendarEvents();
    } catch (e) {
      console.warn("[terminfinder] tfInitCalendarEvents error:", e);
    }
  }
});
