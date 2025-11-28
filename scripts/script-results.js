// =============================================================================
// script-ergebnisse.js
// =============================================================================

// [PAGE ESSENTIALS]
// =============================================================================

// RUN ON PAGE LOAD ------------------------------------------------------------
$(document).ready(function () {
  // Warten, bis der Supabase-Client aus base.js initialisiert wurde
  document.addEventListener("supabase:ready", initErgebnisse, { once: true });
  setupTabs();
  toggleHelpOverlay();
  initErgebnisse();
});

// RUN ON WINDOW RESIZE --------------------------------------------------------
$(window).resize(
  debounce(function () {
    /* ... */
  }, 250)
);

// RUN ON SCROLL ---------------------------------------------------------------
$(window).scroll(
  debounce(function () {
    /* ... */
  }, 100)
);

// =============================================================================
// [INITIALIZER]
// =============================================================================

async function initErgebnisse() {
  try {
    // Use the new global fetchers from base.js (already preloaded + cached)
    const [teams, players, gamesAll] = await Promise.all([
      fetchTeams(),
      fetchPlayers(),
      fetchGames(),
    ]);

    // Build lookups
    const teamBySlug = indexBy(teams, "slug");
    const teamByPlayer = mapPlayersToTeams(teams);
    const gamesByGroup = groupBy(gamesAll, (g) =>
      (g.group || "none").toLowerCase()
    );

    // Render standings tables (Group A / Group B)
    await renderGroupTables("a", teamBySlug);
    await renderGroupTables("b", teamBySlug);

    // Render group stage matches
    await renderGroupGames("a", gamesByGroup["a"] || [], teamBySlug);
    await renderGroupGames("b", gamesByGroup["b"] || [], teamBySlug);

    // Render KO bracket
    await renderKoGames(gamesByGroup["ko"] || [], teamBySlug);

    // Render player leaderboard
    await renderPlayerStats(players, teamByPlayer);

    // Init Swiper / statbar animations for the player leaderboard
    initPlayerStatsSwiper();
  } catch (err) {
    console.error("[initErgebnisse] Failed:", err);
  }
}

// =============================================================================
// [RENDER: GROUP GAMES]
// =============================================================================

async function renderGroupGames(groupChar, games, teamBySlug) {
  const $list = $('.game_list[data-base="group-' + groupChar + '"]'); // ergebnisse.html Struktur :contentReference[oaicite:10]{index=10}
  if ($list.length === 0) return;

  const $template = $list.children(".gameh").first();
  if ($template.length === 0) return;

  // Sortierung:
  // - Gespielt zuerst (alt -> neu)
  // - Dann terminierte (früh -> spät)
  // - Dann ohne Termin
  const decorated = games
    .map((g) => decorateGameTotals(g)) // Totals berechnen/fixen
    .map((g) => ({
      g,
      played: isPlayed(g),
      hasDate: !!g.datetime,
      time: g.datetime ? new Date(g.datetime).getTime() : Infinity,
    }));

  const played = decorated
    .filter((x) => x.played)
    .sort((a, b) => a.time - b.time);
  const scheduled = decorated
    .filter((x) => !x.played && x.hasDate)
    .sort((a, b) => a.time - b.time);
  const undated = decorated.filter((x) => !x.played && !x.hasDate);

  const finalOrder = [...played, ...scheduled, ...undated].map((x) => x.g);

  // Render
  $list.empty();
  finalOrder.forEach((game) => {
    const $item = $template.clone();

    // Teamlinks & Inhalte (linke/rechte Seite)
    fillGameHTeam(
      $item.find('.gameh_team[data-base="t1"]'),
      teamBySlug[game.t1_slug],
      "t1"
    );
    fillGameHTeam(
      $item.find('.gameh_team[data-base="t2"]'),
      teamBySlug[game.t2_slug],
      "t2"
    );

    // Score
    setText(
      $item.find('[data-game="score_total_t1"]'),
      isFiniteNum(game.t1_total) ? game.t1_total : ""
    );
    setText(
      $item.find('[data-game="score_total_t2"]'),
      isFiniteNum(game.t2_total) ? game.t2_total : ""
    );

    // Titel & Termin
    setText($item.find('[data-base="name"]'), game.name || "");
    const dateStr = game.datetime
      ? convertDateTime(game.datetime, "datetime-short")
      : "Termin kommt noch"; // aus base.js :contentReference[oaicite:11]{index=11}
    setText($item.find('[data-base="datetime"]'), dateStr);

    // If Played
    if (isPlayed(game)) {
      $item.addClass("is--played");
      highlightWinner($item, num(game.t1_total), num(game.t2_total)); // aus base.js :contentReference[oaicite:12]{index=12}

      // Game Link
      /*
      const $gameLink = $item.find('[data-base="game-link"]');
      if ($gameLink.length && game) {
        $gameLink.attr("href", buildGameLink(game));
      }
      */
      $item.attr("href", buildGameLink(game));
    }

    $list.append($item);
  });
}

function fillGameHTeam($anchor, team, side) {
  console.log($anchor, team);
  if (!$anchor || $anchor.length === 0 || !team) return;
  // Name + Tag
  setText($anchor.find('[data-base="tname"]'), team.tname || "");
  setText($anchor.find('[data-base="tag"]'), team.tag || "");

  // Logo – beachte, dass im linken Team „logo-72-flat“ links liegt und rechts beim zweiten Team rechts – beide Selektoren sind gleich in ergebnisse.html :contentReference[oaicite:13]{index=13}
  const $logo = $anchor.find('[data-base="logo-72-flat"]');
  if ($logo.length) {
    const url = buildAssetUrl("teams", team.slug, "logo-72-flat");
    $logo.css("background-image", url ? 'url("' + url + '")' : "");
  }

  // Team Links
  /*
  if ($anchor.length && team) {
    $anchor.attr("href", buildTeamLink(team));
  }
  */
}

// =============================================================================
// [TABS]
// =============================================================================

// TAB MENU LINKS ACTIVENESS  --------------------------------------------------
function setupTabs() {
  // Selektiere beide Instanzen von .tabs_menu
  $(".tabs_menu").each(function () {
    // Finde alle .tabs_link innerhalb des jeweiligen .tabs_menu
    var $tabsLinks = $(this).find(".tabs_link");

    // Füge einen Click-Event-Handler für jeden .tabs_link hinzu
    $tabsLinks.on("click", function () {
      // Wenn das geklickte Element nicht bereits .is--active hat
      if (!$(this).hasClass("is--active")) {
        // Entferne .is--active von allen .tabs_link innerhalb dieses .tabs_menu
        $tabsLinks.removeClass("is--active");
        // Füge .is--active dem geklickten Element hinzu
        $(this).addClass("is--active");
        // Verschiebe die Pille
        $(this).siblings(".tabs_pill-mover").toggleClass("is--switched");
      }
    });
  });
}

// =============================================================================
// [RENDER: GROUP TABLES]
// =============================================================================

async function renderGroupTables(groupChar, teamBySlug) {
  // Container & Template aus ergebnisse.html (tabelle_inner[data-base="group-x"]) :contentReference[oaicite:7]{index=7}
  const $wrap = $('.tabelle_inner[data-base="group-' + groupChar + '"]');
  if ($wrap.length === 0) return;

  const $template = $wrap.children(".statrow").first();
  if ($template.length === 0) return;

  // Teams dieser Gruppe
  const teams = Object.values(teamBySlug).filter(
    (t) => (t.group || "").toLowerCase() === groupChar
  );

  // Platzierungs-Logik: zuerst Wins (desc), bei Gleichstand Rundendifferenz (desc)
  // Rundendifferenz = stat_rounds (angenommen als Differenzfeld – wenn es absolute Runden sein sollten, bitte anpassen)
  const sorted = teams.slice().sort((a, b) => {
    const wDiff = num(b.stat_wins) - num(a.stat_wins);
    if (wDiff !== 0) return wDiff;
    const rdDiff = num(b.stat_rounds) - num(a.stat_rounds);
    return rdDiff;
  });

  // Render
  $wrap.empty();
  sorted.forEach((team, idx) => {
    const place = idx + 1;
    const $row = $template.clone();

    fillTeamRow($row, team, place);
    if (place <= 2) $row.addClass("is--highlight"); // Top 2 hervorheben

    $wrap.append($row);
  });
}

function fillTeamRow($row, team, place) {
  // data-base Felder lt. ergebnisse.html: placement, tname, stat_wins, stat_losses, stat_rounds, stat_hltv, stat_kdr, stat_adr, logo-72-flat :contentReference[oaicite:8]{index=8}
  setText($row.find('[data-base="placement"]'), place + ".");
  setText($row.find('[data-base="tname"]'), team.tname || "");
  setText($row.find('[data-base="tag"]'), team.tag || "");
  setText($row.find('[data-base="stat_wins"]'), num(team.stat_wins));
  setText($row.find('[data-base="stat_losses"]'), num(team.stat_losses));
  setText($row.find('[data-base="stat_rounds"]'), num(team.stat_rounds));
  setText($row.find('[data-base="stat_hltv"]'), fixed(team.stat_hltv, 2));
  setText($row.find('[data-base="stat_kdr"]'), fixed(team.stat_kdr, 2));
  setText($row.find('[data-base="stat_adr"]'), num(team.stat_adr));

  // Logo (avatar als bg-image)
  const $logo = $row.find('[data-base="logo-72-flat"]');
  if ($logo.length) {
    const url = buildAssetUrl("teams", team.slug, "logo-72-flat"); // aus base.js :contentReference[oaicite:9]{index=9}
    $logo.css("background-image", url ? 'url("' + url + '")' : "");
  }

  // Links
  const $teamLink = $row.find('[data-base="team-link"]');
  if ($teamLink.length && team) {
    $teamLink.attr("href", buildTeamLink(team));
  }
}

// =============================================================================
// [RENDER: KO GAMES]
// =============================================================================

async function renderKoGames(gamesKo, teamBySlug) {
  const order = ["khf", "ghf", "kf", "gf"]; // gewünschte Reihenfolge
  const wanted = indexBy(gamesKo, "slug");
  const $grid = $("#kogrid"); // Struktur lt. ergebnisse.html :contentReference[oaicite:14]{index=14}
  if ($grid.length === 0) return;

  const $template = $grid.children(".gamev_wrap").first();
  if ($template.length === 0) return;

  $grid.empty();

  order.forEach((slug) => {
    const game = wanted[slug];
    const $item = $template.clone();

    if (game) {
      setText($item.find('[data-base="name"]'), game.name || "");
      const dateStr = game.datetime
        ? convertDateTime(game.datetime, "datetime")
        : "Termin kommt noch";
      setText($item.find('[data-base="datetime"]'), dateStr);

      // Teams
      const t1 = teamBySlug[game.t1_slug];
      const t2 = teamBySlug[game.t2_slug];

      // Team Links
      const $t1Link = $item.find('[data-base="t1-link"]');
      if ($t1Link.length && t1) {
        $t1Link.attr("href", buildTeamLink(t1));
      } else {
        $t1Link.addClass("is--unset");
      }

      const $t2Link = $item.find('[data-base="t2-link"]');
      if ($t2Link.length && t2) {
        $t2Link.attr("href", buildTeamLink(t2));
      } else {
        $t2Link.addClass("is--unset");
      }

      // Namen
      setText($item.find('[data-base="t1-name"]'), t1 ? t1.tname : "???");
      setText($item.find('[data-base="t2-name"]'), t2 ? t2.tname : "???");
      setText($item.find('[data-base="t1-tag"]'), t1 ? t1.tag : "???");
      setText($item.find('[data-base="t2-tag"]'), t2 ? t2.tag : "???");

      // Logos
      const t1logo = t1 ? buildAssetUrl("teams", t1.slug, "logo-72-flat") : "";
      const t2logo = t2 ? buildAssetUrl("teams", t2.slug, "logo-72-flat") : "";
      if (t1logo)
        $item
          .find('[data-base="t1-logo-72-flat"]')
          .css("background-image", 'url("' + t1logo + '")');
      if (t2logo)
        $item
          .find('[data-base="t2-logo-72-flat"]')
          .css("background-image", 'url("' + t2logo + '")');

      // Scores / match status
      const deco = decorateGameTotals(game);

      // raw scores straight from DB (may be null for unplayed games)
      const rawT1 = game.t1_score_total;
      const rawT2 = game.t2_score_total;

      // decorated scores (often numbers or strings like "13")
      const decoT1 = deco?.t1_total;
      const decoT2 = deco?.t2_total;

      // helper to say "this is an actual score we can show"
      function hasValue(v) {
        return v !== null && v !== undefined && v !== "";
      }

      // decide if we consider this game played
      let hasScores =
        hasValue(rawT1) ||
        hasValue(rawT2) ||
        hasValue(decoT1) ||
        hasValue(decoT2);

      // Special rule: ignore boring default 0-0 from helpers
      if (
        (decoT1 === 0 || decoT1 === "0") &&
        (decoT2 === 0 || decoT2 === "0") &&
        !hasValue(rawT1) &&
        !hasValue(rawT2)
      ) {
        hasScores = false;
      }

      if (hasScores) {
        // Mark as played visually
        $item.addClass("is--played");

        // Decide what to render: prefer deco (usually nicely aggregated),
        // otherwise raw fallback.
        const displayT1 = hasValue(decoT1)
          ? decoT1
          : hasValue(rawT1)
          ? rawT1
          : "";
        const displayT2 = hasValue(decoT2)
          ? decoT2
          : hasValue(rawT2)
          ? rawT2
          : "";

        setText($item.find('[data-base="t1_score_total"]'), displayT1);
        setText($item.find('[data-base="t2_score_total"]'), displayT2);

        // highlight winner/loser ring etc. (only if we actually have numbers)
        const n1 = hasValue(displayT1) ? num(displayT1) : null;
        const n2 = hasValue(displayT2) ? num(displayT2) : null;
        if (n1 !== null && n2 !== null) {
          highlightWinner($item, n1, n2);
        }

        const $gameLink = $item.find('[data-base="game-link"]');
        if ($gameLink.length && game) {
          $gameLink.attr("href", buildGameLink(game));
        }
      } else {
        // Not played (no legit scores anywhere) -> keep empty
        setText($item.find('[data-base="t1_score_total"]'), "");
        setText($item.find('[data-base="t2_score_total"]'), "");
      }
    } else {
      // Kein Datensatz -> Standardwerte aus HTML stehen lassen (z. B. "Termin kommt noch") :contentReference[oaicite:15]{index=15}
    }

    $grid.append($item);
  });
}

// =============================================================================
// [RENDER: PLAYER STATS + SWIPER]
// =============================================================================

async function renderPlayerStats(players, teamByPlayer) {
  const $insert = $("#playerstats-insert"); // swiper-wrapper lt. ergebnisse.html :contentReference[oaicite:16]{index=16}
  if ($insert.length === 0) return;

  // Vorlage: .tabelle_inner als Slide + darin .statrow als Item
  // In der gelieferten HTML ist bereits 1 Slide mit 1 statrow enthalten – wir klonen aus dieser Struktur. :contentReference[oaicite:17]{index=17}
  const $slideTpl = $insert.children(".tabelle_inner").first();
  const $rowTpl = $slideTpl.find(".statrow").first();

  // Sortierlogik: HLTV desc, bei Gleichstand KDR desc, dann ADR desc
  const sorted = players.slice().sort((a, b) => {
    const h = cmp(num(b.stat_hltv), num(a.stat_hltv));
    if (h !== 0) return h;
    const k = cmp(num(b.stat_kdr), num(a.stat_kdr));
    if (k !== 0) return k;
    return cmp(num(b.stat_adr), num(a.stat_adr));
  });

  // Slides mit je 6 Spielern
  $insert.empty();
  for (let i = 0; i < sorted.length; i += 6) {
    const chunk = sorted.slice(i, i + 6);
    const $slide = $slideTpl.clone();
    const $holder = $slide; // .tabelle_inner ist selbst der Slide

    $holder.empty();
    chunk.forEach((pl, idxInSlide) => {
      const place = i + idxInSlide + 1;
      const $row = $rowTpl.clone();

      fillPlayerRow($row, pl, teamByPlayer[pl.slug], place);
      if (place <= 3) $row.addClass("is--highlight");

      $holder.append($row);
    });

    $insert.append($slide);
  }
}

function fillPlayerRow($row, player, team, place) {
  setText($row.find('[data-base="placement"]'), place + ".");
  setText($row.find('[data-base="pname"]'), player.pname || "");
  setText($row.find('[data-base="tname"]'), team ? team.tname : "");

  // Primär/sekundär Stats
  setText($row.find('[data-base="stat_hltv"]'), fixed(player.stat_hltv, 2));
  setText($row.find('[data-base="stat_kdr"]'), fixed(player.stat_kdr, 2));
  setText($row.find('[data-base="stat_adr"]'), num(player.stat_adr));

  // Headshot %
  (function () {
    const value = num(player.stat_headshot);
    const $el = $row.find('[data-base="stat_headshot"]');
    setText($el, value);
  })();

  // Utility
  (function () {
    const value = num(player.stat_utility);
    const $el = $row.find('[data-base="stat_utility"]');
    setText($el, value);
  })();

  // Entry
  (function () {
    const value = num(player.stat_entry);
    const $el = $row.find('[data-base="stat_entry"]');
    setText($el, value);
  })();

  // Clutch
  (function () {
    const value = num(player.stat_clutch);
    const $el = $row.find('[data-base="stat_clutch"]');
    setText($el, value);
  })();

  // Team-Link (falls vorhanden)
  const $teamLink = $row.find('[data-base="team-link"]');
  if ($teamLink.length && team) {
    $teamLink.attr("href", buildTeamLink(team)); // accepts object or slug
  }

  // Spielerbild (data-base="p-60")
  // Das Bildschema nutzt das Team-Slug + p1/p2 je nach Zuordnung des Players in team.p1_slug / team.p2_slug
  // → buildAssetUrl("players", team.slug, "p1-60"|"p2-60")
  const $img = $row.find('[data-base="p-60"]');
  if ($img.length && team) {
    const preset =
      team.p1_slug === player.slug
        ? "p1-60"
        : team.p2_slug === player.slug
        ? "p2-60"
        : null;

    if (preset) {
      const url = buildAssetUrl("players", team.slug, preset);
      if (url) $img.attr("src", url);
    }
  }
}

function initPlayerStatsSwiper() {
  if (typeof Swiper === "undefined") {
    console.warn("[PlayerStats] Swiper not found – skipping init");
    return;
  }

  const swiper = new Swiper("#tabelle-stats", {
    direction: "horizontal",
    loop: false,
    slidesPerView: 1,
    slidesPerGroup: 1,
    spaceBetween: 64,
    navigation: {
      nextEl: "#stats-next",
      prevEl: "#stats-prev",
    },
    pagination: {
      el: "#stats-pagination",
      type: "bullets",
      clickable: true,
    },

    on: {
      slideChange: function () {
        const activeIndex = this.activeIndex;
        const $activeSlide = $(this.slides[activeIndex]);

        // 1. reset widths in the active slide
        resetStatbars($activeSlide);

        // 2. init/re-init animation for that slide
        initStatbarAnimation($activeSlide);

        // 3. tell ScrollTrigger to recalc positions
        if (typeof ScrollTrigger !== "undefined") {
          ScrollTrigger.refresh();
        }
      },
    },
  });

  // prep the first visible slide
  const $initialSlide = $(swiper.slides[swiper.activeIndex]);
  resetStatbars($initialSlide);
  initStatbarAnimation($initialSlide);
  if (typeof ScrollTrigger !== "undefined") {
    ScrollTrigger.refresh();
  }
}
