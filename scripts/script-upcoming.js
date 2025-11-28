// script-upcoming.js
// =============================================================================
// UPCOMING-ONLY SCRIPT (no swiper)
// requires: fetchGames(), fetchTeams(), fetchPlayers(), nowUtcMs(), convertDateTime(),
//           buildAssetUrl(), buildPlayerLine() from base.js
// assumes same HTML structure as on the home page
// =============================================================================

// RUN ON PAGE LOAD ------------------------------------------------------------
$(document).ready(function () {
  // Wait for supabase client from base.js
  if (window.supabaseClient) {
    bootUpcoming();
  } else {
    document.addEventListener("supabase:ready", bootUpcoming, { once: true });
  }
});

// [BOOT]
// =============================================================================
async function bootUpcoming() {
  try {
    const [games, teams] = await Promise.all([fetchGames(), fetchTeams()]);

    initUpcomingSection(games, teams);
  } catch (err) {
    console.error("[script-upcoming] bootUpcoming failed:", err);
  }
}

// [UPCOMING]
// =============================================================================
function initUpcomingSection(allGames, allTeams) {
  try {
    const nowMs = nowUtcMs();

    // Future games closest to now (ascending) — LIMIT 3
    const items = (allGames || [])
      .filter(function (g) {
        return g && g.datetime && new Date(g.datetime).getTime() > nowMs;
      })
      .sort(function (a, b) {
        return new Date(a.datetime).getTime() - new Date(b.datetime).getTime();
      })
      .slice(0, 3);

    const $wrap = $(".upcoming_wrap");
    const $list = $wrap.find(".upcoming_list");
    const $template = $list.find(".gamev_wrap").first().clone(true);

    // clear current list
    $list.empty();

    // no upcoming games
    if (!items.length) {
      $wrap.remove(); // remove dummy wrapper
      $("#empty-upcoming").removeClass("is--hidden");
      return;
    }

    // index teams by slug
    var teamBySlug = {};
    (allTeams || []).forEach(function (t) {
      if (t && t.slug) teamBySlug[t.slug] = t;
    });

    items.forEach(function (game) {
      const $item = $template.clone(true);

      // GAME NAME
      $item.find('[data-base="name"]').text(game.name || game.slug || "");

      // DATETIME FIELDS
      $item.find("[data-base='datetime']").each(function () {
        const $el = $(this);
        const formatAttr = ($el.attr("data-timeformat") || "").trim();

        var fmt = "datetime";
        if (formatAttr === "time") fmt = "time";
        else if (formatAttr === "weekday" || formatAttr === "weekday-long")
          fmt = "weekday-long";
        else if (formatAttr === "weekday-short") fmt = "weekday-short";
        else if (formatAttr === "date-short") fmt = "date-short";
        else if (formatAttr === "date-long") fmt = "date-long";

        $el.text(convertDateTime(game.datetime, fmt));
      });

      // TEAMS
      $item.find(".gamev_team").each(function () {
        const $team = $(this);
        const which = parseInt($team.attr("data-team"), 10) === 2 ? 2 : 1;
        const tSlug = which === 1 ? game.t1_slug : game.t2_slug;
        const t = tSlug ? teamBySlug[tSlug] : null;

        // logo
        $team.find('[data-base="logo-72-flat"]').each(function () {
          const $avatar = $(this);
          const url = t ? buildAssetUrl("teams", t.slug, "logo-72-flat") : "";
          if (url) {
            $avatar.css({
              "background-image": 'url("' + url + '")',
              "background-size": "cover",
              "background-position": "center center",
              "background-repeat": "no-repeat",
            });
          } else {
            $avatar.css("background-image", "none");
          }
        });

        // name
        $team
          .find('[data-base="tname"]')
          .text(t ? t.tname || t.slug || "" : "");
      });

      $list.append($item);
    });

    // mark today's games
    markTodaysGames();
  } catch (err) {
    console.error("[script-upcoming] initUpcomingSection failed:", err);
  }
}

// Function to mark today's games
function markTodaysGames() {
  // give DOM a moment in case of animations
  setTimeout(function () {
    $("#upcoming .gamev_wrap").each(function () {
      var title = $(this).find(".gamev_title").text();
      if (title === "Heute") {
        $(this).addClass("is--highlight");
      }
    });
  }, 300);
}
