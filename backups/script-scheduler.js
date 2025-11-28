// script-scheduler.js
// =============================================================================
// Wintercup Wingman — Scheduler Dashboard (Scheduler runtime)
// =============================================================================
// Compatible with the reverted global files:
//   - base.js   (exports: window.supabaseClient, authSupabase(), buildAssetUrl(), convertDateTime())
//   - script.js (exports: debounce(), groupBy(), indexBy(), cmp() etc.)
// Requires jQuery and Supabase JS to be loaded before this file.
//
// Key rules implemented:
// - Slot grid: 2025-01-05 → 2025-02-20 CET; weekdays 19:00 & 20:30; weekends 17:30, 19:00, 20:30
// - Availability states: verfuegbar(5), wahrscheinlich(3), unwahrscheinlich(0), verplant(skip)
// - Skip any slot where any player is "verplant"
// - Collision window: 70 minutes around confirmed games (admin overrides included)
// - Manual override: slot start or ±15 minutes only; still applies collision rules
//
// Changes in this version (compat layer):
// - Removed usage of window.handleSupabase and window.fetchWithCache (not present in reverted base.js).
// - Added local helpers: handleResult(), fetchWithCache(), fmt(), toIsoAtCET(), toIsoTZ(), slotLabel(),
//   shortLabel(), longLabel(), matchLabel(), escapeHtml(), toast(), chooseOffset().
// - Fixed Intl.DateTimeFormat misuse that previously caused: "RangeError: Value short out of range for Intl.DateTimeFormat options property day".
//   (We only use day:'2-digit', never 'short'.)
// - Hardened auth whitelist lookup to handle missing table gracefully (shows guidance in gate).
// - Defensive checks around Supabase reads to avoid "TypeError: games is not iterable".
//
// =============================================================================

/* eslint-env browser */
/* global $, window, document, supabaseClient, debounce, groupBy */

(() => {
  "use strict";

  // =============================================================================
  // [PAGE ESSENTIALS]
  // =============================================================================

  // CONSTANTS ------------------------------------------------------------------
  const TZ = "Europe/Berlin";
  const RANGE = { start: "2025-01-05", end: "2025-02-20" }; // inclusive end
  const WEEKDAY_SLOTS = ["19:00", "20:30"];
  const WEEKEND_SLOTS = ["17:30", "19:00", "20:30"];
  const DURATION_MIN = 70;
  const OVERRIDE_OFFSETS_MIN = [-15, 0, 15];

  const AV_SCORES = {
    verfuegbar: 5,
    wahrscheinlich: 3,
    unwahrscheinlich: 0,
    verplant: 0, // but also hard-blocks
  };

  // STATE ----------------------------------------------------------------------
  let supa = null;

  let SESSION = null;
  let ME = null; // { auth_user_id, discord_id, player_slug, team_slug, is_admin }
  let TEAM = null; // current team row
  let PLAYERS = []; // [ {slug,...}, {slug,...} ]
  let GAMES = []; // all games involving ME.team_slug
  let SLOTS = []; // [{iso, label, dayKey, isWeekend, timeLabel}]
  let TAKEN = new Set(); // iso start times that are exact matches
  let BLOCKED = new Set(); // iso start times within collision 70-min windows

  // DOM ------------------------------------------------------------------------
  const $root = $("#wc-dashboard");
  const $authGate = $("#wc-auth-gate");
  const $authMsg = $("#wc-auth-msg");
  const $btnSignin = $("#btn-signin");
  const $btnSignout = $("#btn-signout");
  const $tabs = $(".wc-tabs .tab");
  const $panels = $(".panel");
  const $teamLogo = $("#wc-team-logo");
  const $teamTag = $("#wc-team-tag");
  const $teamChip = $("#wc-team-chip");
  const $progressBar = $("#wc-progress-bar");
  const $progressLabel = $("#wc-progress-label");
  const $notiBadge = $("#wc-noti-badge");

  // RUN ON PAGE LOAD -----------------------------------------------------------
  $(document).ready(function () {
    bindUI();
    startWhenReady();
  });

  // RUN ON WINDOW RESIZE -------------------------------------------------------
  $(window).resize(
    debounce(function () {
      /* reserved */
    }, 250)
  );

  // =============================================================================
  // [COMPAT HELPERS]
  // =============================================================================
  function handleResult(res, ctx) {
    // Normalize Supabase responses to data or null and log errors
    if (!res) return null;
    if (res.error) {
      console.warn(`[supabase:${ctx}]`, res.error);
      return null;
    }
    return res.data ?? null;
  }

  async function fetchWithCache({ key, ttl, fetcher }) {
    const TS_KEY = `${key}__ts`;
    try {
      const raw = localStorage.getItem(key);
      const ts = Number(localStorage.getItem(TS_KEY));
      if (raw && ts && Date.now() - ts < (ttl || 5 * 60 * 1000)) {
        return JSON.parse(raw);
      }
    } catch (_) {}
    const data = await fetcher();
    try {
      localStorage.setItem(key, JSON.stringify(data));
      localStorage.setItem(TS_KEY, String(Date.now()));
    } catch (_) {}
    return data;
  }

  function fmt(dateObj, options) {
    // Small wrapper around toLocaleDateString with safe defaults
    return dateObj.toLocaleDateString(
      "de-DE",
      Object.assign({ timeZone: TZ }, options || {})
    );
  }

  function toIsoAtCET(dayDate, timeHHmm) {
    // Build an ISO string at CET (+01:00) for given date & "HH:mm"
    const [h, m] = String(timeHHmm)
      .split(":")
      .map((v) => Number(v));
    const d = new Date(
      dayDate.getFullYear(),
      dayDate.getMonth(),
      dayDate.getDate(),
      h,
      m,
      0,
      0
    );
    // Represent as ISO with timezone offset
    const tzOffsetMin = -d.getTimezoneOffset(); // in minutes (e.g., +60 for CET in winter)
    const sign = tzOffsetMin >= 0 ? "+" : "-";
    const pad = (n) => String(Math.abs(n)).padStart(2, "0");
    const offH = pad(Math.trunc(tzOffsetMin / 60));
    const offM = pad(tzOffsetMin % 60);
    const base = d.toISOString().slice(0, 19); // "YYYY-MM-DDTHH:mm:ss"
    return `${base}${sign}${offH}:${offM}`;
  }

  function toIsoTZ(dateObj) {
    // Convert a Date to ISO string including local timezone offset
    const d = new Date(dateObj);
    const tzOffsetMin = -d.getTimezoneOffset();
    const sign = tzOffsetMin >= 0 ? "+" : "-";
    const pad = (n) => String(Math.abs(n)).padStart(2, "0");
    const offH = pad(Math.trunc(tzOffsetMin / 60));
    const offM = pad(tzOffsetMin % 60);
    const base = new Date(
      d.getFullYear(),
      d.getMonth(),
      d.getDate(),
      d.getHours(),
      d.getMinutes(),
      d.getSeconds()
    )
      .toISOString()
      .slice(0, 19);
    return `${base}${sign}${offH}:${offM}`;
  }

  function slotLabel(day, timeHHmm) {
    const wd = day.toLocaleDateString("de-DE", {
      weekday: "short",
      timeZone: TZ,
    });
    const dd = fmt(day, { day: "2-digit", month: "2-digit" });
    return `${wd}, ${dd} · ${timeHHmm}`;
  }

  function shortLabel(iso) {
    const d = new Date(iso);
    const wd = d.toLocaleDateString("de-DE", { weekday: "short" });
    const dd = d.toLocaleDateString("de-DE", {
      day: "2-digit",
      month: "2-digit",
    });
    const tm = d.toLocaleTimeString("de-DE", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    return `${wd}, ${dd} · ${tm}`;
  }

  function longLabel(iso) {
    const d = new Date(iso);
    const wd = d.toLocaleDateString("de-DE", { weekday: "long" });
    const dd = d.toLocaleDateString("de-DE", { day: "2-digit", month: "long" });
    const tm = d.toLocaleTimeString("de-DE", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    return `${wd}, ${dd}, ${tm} Uhr`;
  }

  function matchLabel(g) {
    const us = ME?.team_slug;
    const home = g.t1_slug === us ? g.t1_slug : g.t2_slug;
    const opp = g.t1_slug === us ? g.t2_slug : g.t1_slug;
    return `${home} vs ${opp}`;
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function toast(msg, isError) {
    const $box = $("<div/>")
      .addClass("toast")
      .toggleClass("toast--error", !!isError)
      .html(escapeHtml(msg));
    $("#wc-toasts").append($box);
    setTimeout(() => $box.addClass("is-in"), 10);
    setTimeout(() => $box.removeClass("is-in"), 3200);
    setTimeout(() => $box.remove(), 3600);
  }

  async function chooseOffset() {
    // Simple prompt-based chooser for ±15; returns one of OVERRIDE_OFFSETS_MIN
    const val = window.prompt("Offset wählen: -15, 0 oder +15 (Minuten)", "0");
    const n = Number(val);
    if (!OVERRIDE_OFFSETS_MIN.includes(n)) return 0;
    return n;
  }

  function gate(message) {
    if (message) {
      $authMsg.removeClass("is-hidden").text(message);
    }
    $root.addClass("is-hidden");
    $authGate.removeClass("is-hidden");
  }

  // =============================================================================
  // [AUTH]
  // =============================================================================
  const auth = {
    async ensureDiscordWhitelist() {
      const { data: sessionData } = await supa.auth.getSession();
      SESSION = sessionData?.session || null;

      if (!SESSION) {
        return { ok: false, reason: "no-session" };
      }

      const { user } = SESSION;
      // Whitelist lookup; be defensive if table not present
      let wlRes;
      try {
        wlRes = await supa
          .from("user_whitelist")
          .select("*")
          .eq("auth_user_id", user.id)
          .maybeSingle();
      } catch (e) {
        console.warn("[whitelist] query failed", e);
        return { ok: false, reason: "whitelist-error" };
      }
      const wl = handleResult(wlRes, "user_whitelist.select");
      if (!wl) return { ok: false, reason: "not-whitelisted" };
      ME = wl;
      return { ok: true };
    },

    async signIn() {
      await supa.auth.signInWithOAuth({
        provider: "discord",
        options: { redirectTo: window.location.href },
      });
    },

    async signOut() {
      await supa.auth.signOut();
      window.location.reload();
    },
  };

  // =============================================================================
  // [DATA]
  // =============================================================================
  const data = {
    async getUserTeamAndPlayers(teamSlug) {
      const tRes = await supa
        .from("teams")
        .select("*")
        .eq("slug", teamSlug)
        .maybeSingle();
      const team = handleResult(tRes, "teams.bySlug");
      if (!team) return { team: null, players: [] };

      const pSlugs = [team.p1_slug, team.p2_slug].filter(Boolean);
      const pRes = await supa.from("players").select("*").in("slug", pSlugs);
      const players = handleResult(pRes, "players.bySlugs") || [];
      return { team, players };
    },

    async getTeamGames(teamSlug) {
      const key = `games_${teamSlug}`;
      return await fetchWithCache({
        key,
        ttl: 5 * 60 * 1000,
        fetcher: async () => {
          const res = await supa
            .from("games")
            .select("*")
            .or(`t1_slug.eq.${teamSlug},t2_slug.eq.${teamSlug}`)
            .order("datetime", { ascending: true });
          return handleResult(res, "games.forTeam") || [];
        },
      });
    },

    async getOppPlayersForGame(game) {
      const oppSlug =
        game.t1_slug === ME.team_slug ? game.t2_slug : game.t1_slug;
      const tRes = await supa
        .from("teams")
        .select("*")
        .eq("slug", oppSlug)
        .maybeSingle();
      const oppTeam = handleResult(tRes, "teams.opp") || {};
      const pRes = await supa
        .from("players")
        .select("*")
        .in("slug", [oppTeam.p1_slug, oppTeam.p2_slug].filter(Boolean));
      const oppPlayers = handleResult(pRes, "players.opp") || [];
      return { oppTeam, oppPlayers };
    },

    async readAvailability(slotsIso, playerSlugs) {
      // Pull all availability rows intersecting the slot set for the given players
      const res = await supa
        .from("availability")
        .select("*")
        .in("player_slug", playerSlugs)
        .in("slot_ts", slotsIso);
      return handleResult(res, "availability.byPlayersSlots") || [];
    },

    async upsertAvailability(playerSlug, slotIso, status) {
      const res = await supa.from("availability").upsert({
        player_slug: playerSlug,
        slot_ts: slotIso,
        status,
      });
      return handleResult(res, "availability.upsert");
    },

    async writeSuggestion({ game_slug, proposer_player_slug, slot_ts, note }) {
      const res = await supa.from("date_suggestions").insert({
        game_slug,
        proposer_player_slug,
        slot_ts,
        note: note || null,
      });
      return handleResult(res, "suggestions.insert");
    },

    async updateSuggestionStatus(id, status) {
      const res = await supa
        .from("date_suggestions")
        .update({ status })
        .eq("id", id);
      return handleResult(res, "suggestions.update");
    },

    async listSuggestionsForGames(gameSlugs) {
      const res = await supa
        .from("date_suggestions")
        .select("*")
        .in("game_slug", gameSlugs)
        .order("created_at", { ascending: false });
      return handleResult(res, "suggestions.list") || [];
    },

    async setGameDatetime(gameSlug, iso, detail) {
      const update = await supa
        .from("games")
        .update({ datetime: iso })
        .eq("slug", gameSlug);
      handleResult(update, "games.update.datetime");
      await supa.from("scheduler_log").insert({
        game_slug: gameSlug,
        actor_player_slug: ME?.player_slug || null,
        action: "set_datetime",
        detail: detail || null,
      });
      return true;
    },
  };

  // =============================================================================
  // [CAL]
  // =============================================================================
  const cal = {
    generateSlots(range, rules) {
      const out = [];
      const start = new Date(`${range.start}T00:00:00`);
      const end = new Date(`${range.end}T23:59:59`);
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const day = new Date(d);
        const dayKey = day.toLocaleDateString("de-DE", {
          weekday: "short",
          day: "2-digit",
          month: "2-digit",
          timeZone: TZ,
        });
        const isWeekend = [0, 6].includes(day.getDay());
        const times = isWeekend ? rules.weekend : rules.weekday;
        for (const t of times) {
          const iso = toIsoAtCET(day, t);
          out.push({
            iso,
            label: slotLabel(day, t),
            timeLabel: t,
            dayKey,
            isWeekend,
          });
        }
      }
      return out;
    },

    buildCollisionSets(games) {
      TAKEN.clear();
      BLOCKED.clear();
      (games || []).forEach((g) => {
        if (!g || !g.datetime) return;
        const start = new Date(g.datetime);
        const end = new Date(start.getTime() + DURATION_MIN * 60 * 1000);
        TAKEN.add(toIsoTZ(start));
        for (const s of SLOTS) {
          const sDate = new Date(s.iso);
          if (sDate >= start && sDate < end) BLOCKED.add(s.iso);
        }
      });
    },

    async scoreSlotForGame(slotIso, fourPlayersAvailability) {
      if (TAKEN.has(slotIso) || BLOCKED.has(slotIso))
        return { ok: false, score: -1, reason: "taken-or-blocked" };
      let hardBusy = false;
      let score = 0;
      for (const p of fourPlayersAvailability) {
        const status = p.map.get(slotIso) || "verfuegbar";
        if (status === "verplant") {
          hardBusy = true;
          break;
        }
        score += AV_SCORES[status] ?? 0;
      }
      if (hardBusy) return { ok: false, score: 0, reason: "verplant" };
      return { ok: true, score };
    },
  };

  // =============================================================================
  // [SCHEDULER]
  // =============================================================================
  const scheduler = {
    async suggestSlotsForGame(game) {
      const { oppPlayers } = await data.getOppPlayersForGame(game);
      const four = [
        ...(PLAYERS || []).map((p) => p.slug),
        ...(oppPlayers || []).map((p) => p.slug),
      ];

      // Build availability map for four players
      const slotsIso = SLOTS.map((s) => s.iso);
      const avRows = await data.readAvailability(slotsIso, four);
      const perPlayer = four.map((slug) => ({ slug, map: new Map() }));
      for (const row of avRows) {
        const pp = perPlayer.find((p) => p.slug === row.player_slug);
        if (pp) pp.map.set(row.slot_ts, row.status);
      }

      const candidates = [];
      for (const s of SLOTS) {
        const res = await cal.scoreSlotForGame(s.iso, perPlayer);
        if (res.ok) candidates.push({ slot: s, score: res.score });
      }

      candidates.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return new Date(a.slot.iso) - new Date(b.slot.iso);
      });
      return candidates.slice(0, 3);
    },

    async applyManualTime(game, slotIso, offsetMin, note) {
      if (!OVERRIDE_OFFSETS_MIN.includes(offsetMin))
        throw new Error("Only -15, 0 or +15 allowed");
      const base = new Date(slotIso);
      const target = new Date(base.getTime() + offsetMin * 60 * 1000);

      // Collision check
      const start = target;
      const end = new Date(start.getTime() + DURATION_MIN * 60 * 1000);
      for (const g of GAMES || []) {
        if (!g || !g.datetime) continue;
        const s = new Date(g.datetime);
        const e = new Date(s.getTime() + DURATION_MIN * 60 * 1000);
        if (start < e && end > s)
          throw new Error("Kollisionsregel (70 Min) verletzt.");
      }

      await data.setGameDatetime(game.slug, toIsoTZ(target), {
        reason: "manual-override",
        offset_min: offsetMin,
        note: note || null,
      });
      toast("Spielzeit gesetzt.");
    },
  };

  // =============================================================================
  // [UI]
  // =============================================================================
  const ui = {
    showDashboard() {
      $authGate.addClass("is-hidden");
      $root.removeClass("is-hidden");
    },

    setTeamHeader(team) {
      const url =
        (window.buildAssetUrl &&
          window.buildAssetUrl("teams", team.slug, "logo-150-iso")) ||
        "";
      $teamLogo.attr("src", url);
      $teamTag.text(team.tag || team.slug);
      $teamChip.attr("title", team.tname || team.slug);
    },

    setProgress(scheduled, total) {
      const pct = total > 0 ? Math.round((scheduled / total) * 100) : 0;
      $progressBar.css("width", `${pct}%`);
      $progressLabel.text(`${scheduled} / ${total} geplant`);
    },

    renderAvailabilityGrid(slots, takenSet, blockedSet) {
      const $grid = $("#wc-availability-grid").empty();
      const days = groupBy(slots, (s) => s.dayKey);
      Object.keys(days).forEach((dayKey) => {
        const arr = days[dayKey];
        const $day = $(`<div class="wc-day">
                <div class="wc-day__head"><span>${dayKey}</span></div>
                <div class="wc-slots"></div>
              </div>`);
        const $slots = $day.find(".wc-slots");
        for (const s of arr) {
          const stateClasses = [
            takenSet.has(s.iso) ? "slot--taken" : "",
            blockedSet.has(s.iso) ? "slot--blocked" : "",
          ].join(" ");
          const disabled =
            takenSet.has(s.iso) || blockedSet.has(s.iso) ? "disabled" : "";
          const $slot =
            $(`<button class="slot ${stateClasses}" data-iso="${s.iso}" ${disabled}>
                  <span class="slot__time">${s.timeLabel}</span>
                  <span class="slot__score" data-agg="0">Score: 0</span>
                </button>`);
          $slots.append($slot);
        }
        $grid.append($day);
      });
    },

    renderSchedulerList(games, suggestionsByGame) {
      const $list = $("#wc-scheduler-list").empty();
      const unscheduled = (games || []).filter((g) => !g.datetime);
      for (const g of unscheduled) {
        const sugg = suggestionsByGame.get(g.slug) || [];
        const html = `<div class="card item" data-game="${g.slug}">
                <div class="item__row">
                  <div><strong>${matchLabel(g)}</strong></div>
                  <div class="actions">
                    <button class="btn btn-ghost" data-act="nudge">Nudge opponent</button>
                  </div>
                </div>
                <div class="item__row">
                  <div class="sugg">
                    ${sugg
                      .map(
                        (
                          c
                        ) => `<button class="btn btn-primary" data-act="accept" data-iso="${
                          c.slot.iso
                        }">
                        ${shortLabel(c.slot.iso)} · Score ${c.score}
                      </button>`
                      )
                      .join("")}
                  </div>
                  <div class="actions">
                    <button class="btn btn-secondary" data-act="pick">Pick another slot</button>
                  </div>
                </div>
              </div>`;
        $list.append(html);
      }
    },

    renderInbox(items) {
      const $inbox = $("#wc-inbox").empty();
      if (!items.length) {
        $inbox.append(`<div class="card">Keine Vorschläge.</div>`);
        $notiBadge.addClass("is-hidden").text("0");
        return;
      }
      $notiBadge.removeClass("is-hidden").text(String(items.length));
      for (const it of items) {
        $inbox.append(`<div class="card item" data-sugg="${it.id}">
                <div class="item__row">
                  <div><strong>Vorschlag</strong> · ${shortLabel(
                    it.slot_ts
                  )}</div>
                  <div class="actions">
                    <button class="btn btn-primary" data-sugg-act="accept" data-id="${
                      it.id
                    }">Accept</button>
                    <button class="btn btn-secondary" data-sugg-act="reject" data-id="${
                      it.id
                    }">Reject</button>
                  </div>
                </div>
                ${
                  it.note
                    ? `<div class="item__row"><em>${escapeHtml(
                        it.note
                      )}</em></div>`
                    : ""
                }
              </div>`);
      }
    },

    renderScheduled(games) {
      const $list = $("#wc-scheduled-list").empty();
      const scheduled = (games || []).filter((g) => !!g.datetime);
      if (!scheduled.length) {
        $list.append(`<div class="card">Noch keine Spiele geplant.</div>`);
        return;
      }
      for (const g of scheduled) {
        const iso = g.datetime;
        $list.append(`<div class="card item">
                <div class="item__row">
                  <div><strong>${matchLabel(g)}</strong></div>
                  <div class="actions">
                    <button class="btn btn-ghost" data-copy="${iso}">Datum kopieren</button>
                  </div>
                </div>
                <div class="item__row">
                  <div>${longLabel(iso)}</div>
                  ${
                    g.vod_url
                      ? `<a class="btn btn-secondary" href="${g.vod_url}" target="_blank">VOD</a>`
                      : ""
                  }
                </div>
              </div>`);
      }
    },
  };

  // =============================================================================
  // [BOOT FLOW]
  // =============================================================================
  function startWhenReady() {
    if (window.supabaseClient) {
      supa = window.supabaseClient;
      boot();
      return;
    }
    document.addEventListener(
      "supabase:ready",
      (e) => {
        supa = e.detail.client;
        boot();
      },
      { once: true }
    );
    setTimeout(() => {
      if (!window.supabaseClient) {
        gate("Supabase nicht initialisiert. Bitte Seite neu laden.");
      }
    }, 1500);
  }

  async function boot() {
    // Try existing session/whitelist
    const ok = await auth.ensureDiscordWhitelist();
    if (!ok.ok) {
      if (ok.reason === "no-session") {
        gate(); // just show auth
      } else if (ok.reason === "not-whitelisted") {
        gate("Dein Discord-Account ist (noch) nicht freigeschaltet.");
      } else if (ok.reason === "whitelist-error") {
        gate(
          "Whitelist konnte nicht geprüft werden. Existiert die Tabelle user_whitelist?"
        );
      }
      return;
    }

    // Team & players
    const { team, players } = await data.getUserTeamAndPlayers(ME.team_slug);
    if (!team) {
      gate("Teamdaten konnten nicht geladen werden.");
      return;
    }
    TEAM = team;
    PLAYERS = players || [];

    ui.setTeamHeader(TEAM);
    ui.showDashboard();

    // Generate slots
    SLOTS = cal.generateSlots(RANGE, {
      weekday: WEEKDAY_SLOTS,
      weekend: WEEKEND_SLOTS,
    });

    // Games & collisions
    GAMES = await data.getTeamGames(ME.team_slug);
    GAMES = Array.isArray(GAMES) ? GAMES : [];
    cal.buildCollisionSets(GAMES);

    // UI: Availability
    ui.renderAvailabilityGrid(SLOTS, TAKEN, BLOCKED);

    // Progress
    const scheduled = GAMES.filter((g) => !!g.datetime).length;
    ui.setProgress(scheduled, GAMES.length);

    // Suggestions per game
    const gamesUnscheduled = GAMES.filter((g) => !g.datetime);
    const suggMap = new Map();
    for (const g of gamesUnscheduled) {
      try {
        const top3 = await scheduler.suggestSlotsForGame(g);
        suggMap.set(g.slug, top3);
      } catch (e) {
        console.warn("suggestSlotsForGame failed", e);
        suggMap.set(g.slug, []);
      }
    }
    ui.renderSchedulerList(GAMES, suggMap);

    // Inbox
    const allSlugs = GAMES.map((g) => g.slug);
    const inbox = await data.listSuggestionsForGames(allSlugs);
    ui.renderInbox(inbox);

    // Scheduled list
    ui.renderScheduled(GAMES);
  }

  // =============================================================================
  // [EVENTS]
  // =============================================================================
  function bindUI() {
    $btnSignin.on("click", () => auth.signIn());
    $btnSignout.on("click", () => auth.signOut());

    $(".wc-tabs").on("click", ".tab", function () {
      const tab = $(this).data("tab");
      $tabs.removeClass("is-active");
      $(this).addClass("is-active");
      $panels.removeClass("is-active");
      $(`#panel-${tab}`).addClass("is-active");
    });

    $("#wc-availability-grid").on("click", ".slot", async function () {
      const iso = $(this).data("iso");
      if (TAKEN.has(iso) || BLOCKED.has(iso)) return;

      // Cycle state for ME.player_slug: verfuegbar -> wahrscheinlich -> unwahrscheinlich -> verplant -> verfuegbar
      const states = [
        "verfuegbar",
        "wahrscheinlich",
        "unwahrscheinlich",
        "verplant",
      ];
      const current = $(this).data("me-state") || "verfuegbar";
      const next = states[(states.indexOf(current) + 1) % states.length];
      $(this).data("me-state", next);

      await data.upsertAvailability(ME.player_slug, iso, next);
      toast(`Slot ${shortLabel(iso)}: ${next}`);
    });

    $("#wc-scheduler-list").on(
      "click",
      "[data-act='accept']",
      async function () {
        const iso = $(this).data("iso");
        const slug = $(this).closest("[data-game]").data("game");
        const game = (GAMES || []).find((g) => g.slug === slug);
        if (!game) return;
        try {
          await scheduler.applyManualTime(game, iso, 0, "accepted-suggestion");
          window.location.reload();
        } catch (e) {
          toast(String(e.message || e), true);
        }
      }
    );

    $("#wc-scheduler-list").on("click", "[data-act='pick']", async function () {
      const slug = $(this).closest("[data-game]").data("game");
      const game = (GAMES || []).find((g) => g.slug === slug);
      if (!game) return;
      // Switch to Availability tab
      $(".tab[data-tab='availability']").trigger("click");
      toast(
        "Wähle einen Slot in der Availability-Ansicht, danach werde ich nach ±15 fragen."
      );
      // One-off handler for next slot click
      const handler = async (e) => {
        const $t = $(e.target).closest(".slot");
        if (!$t.length) return;
        const iso = $t.data("iso");
        $(document).off("click", handler);
        const offset = await chooseOffset();
        try {
          await scheduler.applyManualTime(game, iso, offset, "manual-select");
          window.location.reload();
        } catch (err) {
          toast(String(err.message || err), true);
        }
      };
      $(document).on("click", handler);
      // Safety timeout
      setTimeout(() => $(document).off("click", handler), 45000);
    });

    $("#wc-inbox").on("click", "[data-sugg-act='accept']", async function () {
      const id = Number($(this).data("id"));
      const row = { id };
      await data.updateSuggestionStatus(id, "accepted");
      toast("Vorschlag akzeptiert.");
      window.location.reload();
    });

    $("#wc-inbox").on("click", "[data-sugg-act='reject']", async function () {
      const id = Number($(this).data("id"));
      await data.updateSuggestionStatus(id, "rejected");
      toast("Vorschlag abgelehnt.");
      window.location.reload();
    });

    $("#wc-scheduled-list").on("click", "[data-copy]", function () {
      const iso = $(this).data("copy");
      try {
        navigator.clipboard.writeText(iso);
        toast("Datum in die Zwischenablage kopiert.");
      } catch (_) {
        toast("Konnte nicht kopieren.", true);
      }
    });
  }
})();
