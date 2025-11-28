// =============================================================================
// script-team.js  (TEAM DETAIL PAGE /teams/<slug>)
// Requirements:
// - base.js and script.js and jQuery are already loaded BEFORE this file
// - base.js preloads data on page load and dispatches "supabase:ready"
// - HTML uses data-base="..." hooks as described
// =============================================================================

(function () {
  // ===========================================================================
  // [LOCAL DOM RENDER HELPERS - PLAYERS]
  // ===========================================================================
  function renderPlayerMedals($container, playerData) {
    if (!$container || $container.length === 0) return;

    var goldCount = playerData?.medals_gold || 0;
    var silverCount = playerData?.medals_silver || 0;
    var bronzeCount = playerData?.medals_bronze || 0;

    var total = goldCount + silverCount + bronzeCount;
    if (total <= 0) {
      $container.remove();
      return;
    }

    var $parent = $container.parent();
    if ($parent.length === 0) return;

    // cleanup previous clones if rerendered
    $parent
      .children('[data-base="' + $container.attr("data-base") + '"]')
      .not($container)
      .remove();

    function appendMedalInstance(srcUrl, count) {
      for (var i = 0; i < count; i++) {
        var $clone = $container.clone();
        $clone.css({
          "background-image": 'url("' + srcUrl + '")',
          "background-size": "contain",
          "background-repeat": "no-repeat",
          "background-position": "center",
        });
        $parent.append($clone);
      }
    }

    var templateUsed = false;
    function useTemplateFor(srcUrl) {
      $container.css({
        "background-image": 'url("' + srcUrl + '")',
        "background-size": "contain",
        "background-repeat": "no-repeat",
        "background-position": "center",
      });
      templateUsed = true;
    }

    // gold → silver → bronze
    if (goldCount > 0) {
      useTemplateFor(buildMedalsAssetUrl("gold"));
      if (goldCount > 1) {
        appendMedalInstance(buildMedalsAssetUrl("gold"), goldCount - 1);
      }
    }

    if (silverCount > 0) {
      if (!templateUsed) {
        useTemplateFor(buildMedalsAssetUrl("silver"));
        if (silverCount > 1) {
          appendMedalInstance(buildMedalsAssetUrl("silver"), silverCount - 1);
        }
      } else {
        appendMedalInstance(buildMedalsAssetUrl("silver"), silverCount);
      }
    }

    if (bronzeCount > 0) {
      if (!templateUsed) {
        useTemplateFor(buildMedalsAssetUrl("bronze"));
        if (bronzeCount > 1) {
          appendMedalInstance(buildMedalsAssetUrl("bronze"), bronzeCount - 1);
        }
      } else {
        appendMedalInstance(buildMedalsAssetUrl("bronze"), bronzeCount);
      }
    }
  }

  function renderPlayerFaceit($container, playerData) {
    if (!$container || $container.length === 0) return;

    var rankNum = playerData?.faceit;
    if (rankNum === undefined || rankNum === null) {
      rankNum = 0;
    }

    var url = buildRankAssetUrl(rankNum);

    // support both <div style="background-image"> and <img src="">
    $container.css("background-image", 'url("' + url + '")');
    if ($container.is("img")) {
      $container.attr("src", url);
    }
  }

  /**
   * Writes numeric/stat values into DOM elements in the given root section.
   * Elements use data-base="<prefix><field>", e.g. data-base="p1-stat_hltv".
   *
   * prefix: "p1-" or "p2-"
   */
  function renderPlayerStatsScoped(rootSelector, prefix, playerData) {
    if (!playerData) return;
    var $root = $(rootSelector);
    if ($root.length === 0) return;

    var fields = [
      "stat_hltv",
      "stat_kdr",
      "stat_adr",
      "stat_utility",
      "stat_headshot",
      "stat_entry",
      "stat_clutch",
      "medals_points",
    ];

    fields.forEach(function (field) {
      var $el = $root.find('[data-base="' + prefix + field + '"]');
      if ($el.length > 0) {
        setTextIfExists($el, playerData[field]);
      }
    });
  }

  // ===========================================================================
  // [TEAM PAGE HERO/STATS RENDER]
  // bundle: { team: {...}, p1: {...}, p2: {...} }
  // ===========================================================================
  function buildPage(bundle) {
    if (!bundle || !bundle.team) {
      console.warn("[script-team] buildPage: invalid bundle", bundle);
      goTeamsOverview();
      return;
    }

    var team = bundle.team;
    var p1 = bundle.p1;
    var p2 = bundle.p2;

    var $hero = $("#hero");
    var $stats = $("#stats");

    // --- HERO -------------------------------------------------------
    // background image for team
    var teamBgUrl = buildAssetUrl("teams", team.slug, "teambg");
    var $teamBg = $hero.find('[data-base="teambg"]');
    if ($teamBg.length > 0) {
      $teamBg.css("background-image", 'url("' + teamBgUrl + '")');
      if ($teamBg.is("img")) {
        $teamBg.attr("src", teamBgUrl);
      }
    }

    // main logo
    var logoIsoUrl = buildAssetUrl("teams", team.slug, "logo-150-iso");
    var $logoIso = $hero.find('[data-base="logo-150-isolated"]');
    setAttrIfExists($logoIso, "src", logoIsoUrl);

    // team name
    var $tname = $hero.find('[data-base="tname"]');
    setTextIfExists($tname, team.tname);

    // --- STATS ------------------------------------------------------
    // PLAYER 1
    if (p1 && team.p1_slug) {
      var p1ImgUrl = buildAssetUrl("players", team.slug, "p1-150");
      var $p1img = $stats.find('[data-base="p1-150"]');
      setAttrIfExists($p1img, "src", p1ImgUrl);

      var $p1name = $stats.find('[data-base="p1-pname"]');
      setTextIfExists($p1name, p1.pname);

      renderPlayerStatsScoped("#stats", "p1-", p1);

      var $p1medals = $stats.find('[data-base="p1-medals"]');
      renderPlayerMedals($p1medals, p1);

      var $p1faceit = $stats.find('[data-base="p1-faceit"]');
      renderPlayerFaceit($p1faceit, p1);
    }

    // PLAYER 2
    if (p2 && team.p2_slug) {
      var p2ImgUrl = buildAssetUrl("players", team.slug, "p2-150");
      var $p2img = $stats.find('[data-base="p2-150"]');
      setAttrIfExists($p2img, "src", p2ImgUrl);

      var $p2name = $stats.find('[data-base="p2-pname"]');
      setTextIfExists($p2name, p2.pname);

      renderPlayerStatsScoped("#stats", "p2-", p2);

      var $p2medals = $stats.find('[data-base="p2-medals"]');
      renderPlayerMedals($p2medals, p2);

      var $p2faceit = $stats.find('[data-base="p2-faceit"]');
      renderPlayerFaceit($p2faceit, p2);
    }

    // kick off animated stat bars after content is in place
    if (typeof animateStatbar === "function") {
      animateStatbar();
    }
  }

  // ===========================================================================
  // [TEAM PAGE GAMES RENDER -> #games]
  // ===========================================================================
  function renderTeamGamesSection(teamSlug, gamesAll, teamBySlug) {
    if (!teamSlug) return;

    var $list = $('[data-base="team-page-games"].game_list');
    if ($list.length === 0) return;

    var $template = $list.children(".gameh").first();
    if ($template.length === 0) return;

    // Filter only games for this team
    var relevantGames = (gamesAll || []).filter(function (g) {
      return g.t1_slug === teamSlug || g.t2_slug === teamSlug;
    });

    // decorate with totals and sorting info
    var decorated = relevantGames
      .map(function (g) {
        return decorateGameTotals(g);
      })
      .map(function (g) {
        var hasDate = !!g.datetime;
        return {
          g: g,
          played: isPlayed(g), // uses updated logic below
          hasDate: hasDate,
          time: hasDate ? new Date(g.datetime).getTime() : Infinity,
        };
      });

    // 1) All played games (one team has score > 0), sorted by datetime
    var played = decorated
      .filter(function (x) {
        return x.played;
      })
      .sort(function (a, b) {
        return a.time - b.time;
      });

    // 2) All unplayed but scheduled (no team has score > 0, but datetime set), sorted by datetime
    var unplayedScheduled = decorated
      .filter(function (x) {
        return !x.played && x.hasDate;
      })
      .sort(function (a, b) {
        return a.time - b.time;
      });

    // 3) All unscheduled (no datetime), sorted by slug alphabetically
    var unscheduled = decorated
      .filter(function (x) {
        return !x.hasDate;
      })
      .sort(function (a, b) {
        var aSlug = (a.g.slug || "").toLowerCase();
        var bSlug = (b.g.slug || "").toLowerCase();
        if (aSlug < bSlug) return -1;
        if (aSlug > bSlug) return 1;
        return 0;
      });

    var finalOrder = played
      .concat(unplayedScheduled)
      .concat(unscheduled)
      .map(function (x) {
        return x.g;
      });

    // Render DOM
    $list.empty();

    finalOrder.forEach(function (game) {
      var $item = $template.clone();

      // left/right team blocks
      var t1 = teamBySlug[game.t1_slug];
      var t2 = teamBySlug[game.t2_slug];

      fillGameHTeamTeamPage(
        $item.find('.gameh_team[data-base="t1"]'),
        t1,
        "t1"
      );
      fillGameHTeamTeamPage(
        $item.find('.gameh_team[data-base="t2"]'),
        t2,
        "t2"
      );

      // Score totals
      setText(
        $item.find('[data-game="score_total_t1"]'),
        isFiniteNum(game.t1_total) ? game.t1_total : ""
      );
      setText(
        $item.find('[data-game="score_total_t2"]'),
        isFiniteNum(game.t2_total) ? game.t2_total : ""
      );

      // Match title + time
      setText($item.find('[data-base="name"]'), game.name || "");
      var dateStr = game.datetime
        ? convertDateTime(game.datetime, "datetime")
        : "Termin kommt noch";
      setText($item.find('[data-base="datetime"]'), dateStr);

      // mark played games + highlight winner
      if (isPlayed(game)) {
        $item.addClass("is--played");
        highlightWinner($item, num(game.t1_total), num(game.t2_total));

        if ($item.length && game) {
          $item.attr("href", buildGameLink(game.slug));
        }
      }

      $list.append($item);
    });
  }

  function fillGameHTeamTeamPage($anchor, team, side) {
    if (!$anchor || $anchor.length === 0 || !team) return;

    // Team name + tag
    setText($anchor.find('[data-base="tname"]'), team.tname || "");
    setText($anchor.find('[data-base="tag"]'), team.tag || "");

    // Logo background-image
    var $logo = $anchor.find('[data-base="logo-72-flat"]');
    if ($logo.length) {
      var url = buildAssetUrl("teams", team.slug, "logo-72-flat");
      $logo.css("background-image", url ? 'url("' + url + '")' : "");
    }

    // Link to team page
    /*
    if (typeof buildTeamLink === "function") {
      $anchor.attr("href", buildTeamLink(team.slug));
    } else {
      $anchor.attr("href", "/teams/" + team.slug);
    }
    */
  }

  // ===========================================================================
  // [TEAM PAGE MAP STATS RENDER -> #maps]
  // ===========================================================================
  function renderTeamMapsSection(teamRow, mapsAll) {
    if (!teamRow) return;

    var $mapsSection = $("#maps");
    if ($mapsSection.length === 0) return;

    var $list = $mapsSection.find(".kartenstat_list");
    if ($list.length === 0) return;

    var $template = $list.children(".kartenstat").first();
    if ($template.length === 0) return;

    // Filter only maps with mid between 1 and 7, numeric, finite
    var filtered = (mapsAll || [])
      .filter(function (m) {
        var midNum = Number(m.mid);
        return Number.isFinite(midNum) && midNum >= 1 && midNum <= 7;
      })
      // Sort by total games descendingly
      .sort(function (a, b) {
        var aMid = Number(a.mid);
        var bMid = Number(b.mid);
        var aWins = Number(teamRow["m" + aMid + "_wins"]) || 0;
        var aLosses = Number(teamRow["m" + aMid + "_losses"]) || 0;
        var bWins = Number(teamRow["m" + bMid + "_wins"]) || 0;
        var bLosses = Number(teamRow["m" + bMid + "_losses"]) || 0;
        var aTotal = aWins + aLosses;
        var bTotal = bWins + bLosses;
        return aTotal - bTotal; // descending order
      });

    // Clear list before inserting clones
    $list.empty();

    filtered.forEach(function (mapRow) {
      var midNum = Number(mapRow.mid);
      var winsKey = "m" + midNum + "_wins";
      var lossesKey = "m" + midNum + "_losses";

      var winsVal = Number(teamRow[winsKey]) || 0;
      var lossesVal = Number(teamRow[lossesKey]) || 0;
      var totalGames = winsVal + lossesVal;

      var coverUrl = buildAssetUrl("map", mapRow.slug, "-cover");
      var emblemUrl = buildAssetUrl("map", mapRow.slug, "-emblem");

      var $item = $template.clone();

      // cover image
      var $coverImg = $item.find('[data-base="cover"]');
      if ($coverImg.length) {
        $coverImg.attr("src", coverUrl || "");
      }

      // emblem image
      var $emblemImg = $item.find('[data-base="emblem"]');
      if ($emblemImg.length) {
        $emblemImg.attr("src", emblemUrl || "");
      }

      // map title
      var $mname = $item.find('[data-base="mname"]');
      setText($mname, mapRow.mname || "");

      // wins / losses / total
      setText($item.find('[data-base="m_wins"]'), winsVal);
      setText($item.find('[data-base="m_losses"]'), lossesVal);
      setText($item.find('[data-base="m_games"]'), totalGames);

      $list.append($item);
    });

    // Initialize the bar animations after DOM is ready
    if (typeof animateKartenStats === "function") {
      animateKartenStats();
    } else {
      console.warn(
        "[script-team] animateKartenStats() not found. Is anim-team.js loaded before script-team.js?"
      );
    }
  }

  // ===========================================================================
  // [INIT FLOW]
  //
  // 1. Read slug from URL (?slug=xyz or /teams/xyz).
  // 2. Validate it exists in teams via fetchTeams().
  // 3. Fetch full bundle via fetchTeamBundle(slug) (team + p1 + p2).
  // 4. Render hero & player stats.
  // 5. Fetch teams + games and render #games.
  // 6. Fetch maps and render #maps with per-map stats from teamRow.
  // ===========================================================================
  async function initTeamPage() {
    var currentSlug = getSlugFromUrl();
    if (!currentSlug) {
      console.warn("[script-team] no slug in URL");
      goTeamsOverview();
      return;
    }

    // ensure slug exists at all
    var teamList = await fetchTeams();
    if (!Array.isArray(teamList) || teamList.length === 0) {
      console.warn("[script-team] team list empty, redirecting");
      goTeamsOverview();
      return;
    }

    var foundTeam = teamList.find(function (t) {
      return (t.slug || "").toLowerCase() === currentSlug;
    });
    if (!foundTeam) {
      console.warn("[script-team] slug not found in team list:", currentSlug);
      goTeamsOverview();
      return;
    }

    // load full bundle (team row + both players)
    var bundle = await fetchTeamBundle(currentSlug);
    if (!bundle || !bundle.team) {
      console.warn("[script-team] invalid bundle for", currentSlug);
      goTeamsOverview();
      return;
    }

    // hero + player stats
    buildPage(bundle);

    // games section
    const [teamsAll, gamesAll] = await Promise.all([
      fetchTeams(), // contains slug, tname, tag, etc.
      fetchGames(), // all games including scores and datetime
    ]);

    var teamBySlug = indexBy(teamsAll, "slug");
    renderTeamGamesSection(currentSlug, gamesAll, teamBySlug);

    // maps section (need maps list + this team's per-map stats)
    var mapsAll = await fetchMaps();
    renderTeamMapsSection(bundle.team, mapsAll);
  }

  // ===========================================================================
  // [SUPABASE READINESS + DOM READY]
  // ===========================================================================
  function startWhenSupabaseReady() {
    if (window.supabaseClient) {
      // base.js already kicked off prefetch; we can initialize immediately
      initTeamPage();
    } else {
      document.addEventListener(
        "supabase:ready",
        function onReadyOnce() {
          document.removeEventListener("supabase:ready", onReadyOnce);
          initTeamPage();
        },
        { once: true }
      );
    }
  }

  // Kick off after DOM is ready
  $(document).ready(function () {
    startWhenSupabaseReady();
  });

  // Optional responsive hooks
  $(window).resize(
    debounce(function () {
      /* responsive tweaks if needed */
    }, 250)
  );

  $(window).scroll(
    debounce(function () {
      /* scroll-based tweaks if needed */
    }, 100)
  );
})();
