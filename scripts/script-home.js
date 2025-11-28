// [PAGE ESSENTIALS]
// =============================================================================

// VARIABLES -------------------------------------------------------------------
var heroSwiper = null;
var vodSwiper = null;
var upcomingSwiper = null;

// RUN ON PAGE LOAD ------------------------------------------------------------
$(document).ready(function () {
  // Wait for supabase client from base.js
  if (window.supabaseClient) {
    bootHome();
  } else {
    document.addEventListener("supabase:ready", bootHome, { once: true });
  }
  initTwitchEmbed();
});

// RUN ON WINDOW RESIZE --------------------------------------------------------
$(window).resize(
  debounce(function () {
    // (reserved for responsive tweaks if needed)
  }, 250)
);

// [BOOT]
// =============================================================================
async function bootHome() {
  try {
    // HERO
    await initHero(); // fetchMaps() from base.js + swiper

    // DATA FETCH (Games/Teams/Players) — use new global fetchers from base.js
    const [games, teams, players] = await Promise.all([
      fetchGames(),
      fetchTeams(),
      fetchPlayers(),
    ]);

    // VOD + UPCOMING
    initVodSection(games);
    initUpcomingSection(games, teams, players);
  } catch (err) {
    console.error("[bootHome] Failed:", err);
  }
}

// =============================================================================
// HERO SLIDER (maps)  — uses base.js: fetchMaps, buildAssetUrl
// =============================================================================
/**
 * Boot the hero section:
 * 1) fetchMaps()
 * 2) insertMapsData()
 * 3) initHeroSwiper()
 */
async function initHero() {
  try {
    var maps = await fetchMaps(); // from base.js
    insertMapsData(maps);
    initHeroSwiper();
  } catch (err) {
    console.error("[initHero] Failed to initialize hero:", err);
  }
}

/**
 * Create slides from map data and insert into the hero swiper.
 * - clones .heroswiper_slide as a template
 * - sets slide background-image to urlCover
 * - sets inner .heroswiper_emblem src to urlEmblem
 * @param {Array} maps - Array of map objects enriched by fetchMaps()
 */
function insertMapsData(maps) {
  var $hero = $(".heroswiper");
  var $mask = $hero.find(".heroswiper_mask");

  if ($mask.length === 0) {
    console.warn("[insertMapsData] .heroswiper_mask not found");
    return;
  }

  // Ensure Swiper classes
  $hero.addClass("swiper");
  $mask.addClass("swiper-wrapper");

  var $template = $mask.find(".heroswiper_slide").first();
  if ($template.length === 0) {
    $template = $(
      '<div class="heroswiper_slide"><img class="heroswiper_emblem" alt=""></div>'
    );
  } else {
    $template = $template.clone(true);
  }

  $mask.empty();

  if (!Array.isArray(maps) || maps.length === 0) {
    console.warn("[insertMapsData] No maps to render");
    return;
  }
  // Filter only maps with mid between 1 and 7, numeric, finite
  var filtered = (maps || []).filter(function (m) {
    var midNum = Number(m.mid);
    return Number.isFinite(midNum) && midNum >= 1 && midNum <= 7;
  });

  filtered.forEach(function (m) {
    var $slide = $template.clone(true);
    $slide.addClass("swiper-slide");

    var cover =
      m.urlCover || (m.slug ? buildAssetUrl("map", m.slug, "-cover") : "");
    $slide.attr("data-slug", m.slug || "").css({
      "background-image": cover ? 'url("' + cover + '")' : "",
      "background-size": "cover",
      "background-position": "center center",
      "background-repeat": "no-repeat",
    });

    var emblem =
      m.urlEmblem || (m.slug ? buildAssetUrl("map", m.slug, "-emblem") : "");
    var $img = $slide.find(".heroswiper_emblem");
    if ($img.length === 0) {
      $img = $('<img class="heroswiper_emblem" loading="lazy" alt="">');
      $slide.append($img);
    }
    if (emblem) $img.attr("src", emblem);
    $img.attr("alt", (m.mname || m.slug || "Map") + " Emblem");

    $mask.append($slide);
  });

  if (heroSwiper && typeof heroSwiper.update === "function") {
    heroSwiper.update();
  }
}

/**
 * Initialize Swiper for the hero.
 */
function initHeroSwiper() {
  if (typeof Swiper === "undefined") {
    console.warn("[initHeroSwiper] Swiper not found.");
    return;
  }
  if (heroSwiper && typeof heroSwiper.destroy === "function") {
    heroSwiper.destroy(true, true);
    heroSwiper = null;
  }

  heroSwiper = new Swiper(".heroswiper", {
    loop: true,
    slidesPerView: 1,
    centeredSlides: true,
    effect: "fade",
    fadeEffect: { crossFade: true },
    speed: 1500,
    autoplay: {
      delay: 6000,
      disableOnInteraction: false,
      pauseOnMouseEnter: false,
    },
    allowTouchMove: false,
    simulateTouch: false,
    keyboard: { enabled: false },
    mousewheel: { enabled: false },
    watchSlidesProgress: true,
    observer: true,
    observeParents: true,
    preloadImages: false,
    lazy: { loadPrevNext: true, loadOnTransitionStart: true },
  });

  heroSwiper.update();
  heroSwiper.slideToLoop(0, 0);
}

// =============================================================================
// TWITCH EMBED
// =============================================================================

function initTwitchEmbed() {
  const channelName = "gulaschgamingcs";
  const $embedHost = $("#twitch-embed");

  // Ensure container exists
  if ($embedHost.length === 0) {
    console.warn("[Twitch] #twitch-embed not found.");
    return;
  }

  // Wait for Twitch SDK to be ready
  if (typeof Twitch === "undefined" || !Twitch.Embed) {
    console.warn("[Twitch] SDK not yet loaded; retrying in 500ms...");
    setTimeout(initTwitchEmbed, 500);
    return;
  }

  // Clear previous embeds if any
  $embedHost.empty();

  // Create the Twitch embed
  new Twitch.Embed("twitch-embed", {
    width: "100%",
    height: "100%",
    channel: "gulaschgamingcs",
    parent: [window.location.hostname],
    layout: "video", // disables chat
  });

  // Style the embed container
  $embedHost.css({
    height: "100%",
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
  });

  console.log("[Twitch] Embed initialized for channel:", channelName);
}

// [UPCOMING]
// =============================================================================
function initUpcomingSection(allGames, allTeams, allPlayers) {
  try {
    const nowMs = nowUtcMs();

    // Future games closest to now (ascending)
    const items = allGames
      .filter(function (g) {
        return g && g.datetime && new Date(g.datetime).getTime() > nowMs;
      })
      .sort(function (a, b) {
        return new Date(a.datetime).getTime() - new Date(b.datetime).getTime();
      })
      .slice(0, 9);

    const $wrap = $(".upcoming_wrap");
    const $list = $wrap.find(".upcoming_list");
    const $template = $list.find(".gamev_wrap").first().clone(true);
    $list.empty();

    if (!items.length) {
      $wrap.remove(); // remove dummy
      $("#empty-upcoming").removeClass("is--hidden");
      return;
    }

    // Index teams/players by slug for fast lookups
    var teamBySlug = {};
    (allTeams || []).forEach(function (t) {
      if (t && t.slug) teamBySlug[t.slug] = t;
    });

    var playerNameBySlug = {};
    (allPlayers || []).forEach(function (p) {
      if (p && p.slug) playerNameBySlug[p.slug] = p.pname || "";
    });

    items.forEach(function (game) {
      const $slide = $template.clone(true).addClass("swiper-slide");

      // GAME NAME
      $slide.find('[data-base="name"]').text(game.name || game.slug || "");

      // TIMESTAMPS (all nodes that reference datetime)
      // - data-timeformat defines convertDateTime formatting
      // - data-base="datetime" marks elements to fill from game.datetime
      $slide.find("[data-base='datetime']").each(function () {
        const $el = $(this);
        const formatAttr = ($el.attr("data-timeformat") || "").trim();

        // Support your variants from html (weekday/date/time/datetime)
        var fmt = "datetime";
        if (formatAttr === "time") fmt = "time";
        else if (formatAttr === "weekday" || formatAttr === "weekday-long")
          fmt = "weekday-long";
        else if (formatAttr === "weekday-short") fmt = "weekday-short";
        else if (formatAttr === "date-short") fmt = "date-short";
        else if (formatAttr === "date-long") fmt = "date-long";

        $el.text(convertDateTime(game.datetime, fmt));
      });

      // TEAMS (two blocks with data-team="1" | "2")
      $slide.find(".gamev_team").each(function () {
        const $team = $(this);
        const which = parseInt($team.attr("data-team"), 10) === 2 ? 2 : 1;
        const tSlug = which === 1 ? game.t1_slug : game.t2_slug;
        const t = tSlug ? teamBySlug[tSlug] : null;

        // Logo
        $team.find('[data-base="logo-72-flat"]').each(function () {
          const $avatar = $(this);
          const url = t ? buildAssetUrl("teams", t.slug, "logo-72-flat") : "";
          // Using as background-image (div.avatar)
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

        // Team Name
        $team
          .find('[data-base="tname"]')
          .text(t ? t.tname || t.slug || "" : "");

        // Players "p1 & p2"
        $team.find('[data-base="players"]').each(function () {
          var p1Name = "";
          var p2Name = "";
          if (t) {
            if (t.p1_slug) p1Name = playerNameBySlug[t.p1_slug] || t.p1_slug;
            if (t.p2_slug) p2Name = playerNameBySlug[t.p2_slug] || t.p2_slug;
          }
          $(this).text(buildPlayerLine(p1Name, p2Name));
        });

        // Team Links
        if ($team.length && tSlug) {
          $team.attr("href", buildTeamLink(tSlug));
        }
      });

      $list.append($slide);
    });

    markTodaysGames();
    initUpcomingSwiper();
  } catch (err) {
    console.error("[initUpcomingSection] Failed:", err);
  }
}

function initUpcomingSwiper() {
  if (typeof Swiper === "undefined") {
    console.warn("[initUpcomingSwiper] Swiper not found.");
    return;
  }
  if (upcomingSwiper && typeof upcomingSwiper.destroy === "function") {
    upcomingSwiper.destroy(true, true);
    upcomingSwiper = null;
  }

  upcomingSwiper = new Swiper(".upcoming_wrap", {
    direction: "horizontal",
    loop: false,
    slidesPerView: 3,
    slidesPerGroup: 3,
    spaceBetween: 64,
    // Responsive breakpoints
    breakpoints: {
      0: {
        slidesPerView: 1,
        spaceBetween: 24,
      },
      680: {
        slidesPerView: 2,
        spaceBetween: 32,
      },
      992: {
        slidesPerView: 3,
        spaceBetween: 32,
      },
      1440: {
        slidesPerView: 3,
        spaceBetween: 64,
      },
    },
    // Navigation
    navigation: {
      nextEl: "#upcoming-next",
      prevEl: "#upcoming-prev",
    },
    pagination: {
      el: "#upcoming-pagination",
      type: "bullets",
      clickable: true,
    },
  });
}

// Function to mark today's games
function markTodaysGames() {
  // Loop through all instances of .spielv inside #upcoming
  setTimeout(function () {
    $("#upcoming .gamev_wrap").each(function () {
      // Find the .spielv_title inside this .spielv
      var title = $(this).find(".gamev_title").text();
      console.log(title);

      // If the text content is "Heute", add the class "is--today"
      if (title === "Heute") {
        $(this).addClass("is--highlight");
      }
    });
  }, 500);
}

// [VOD-LINKS]
// =============================================================================
function initVodSection(allGames) {
  try {
    const nowMs = nowUtcMs();

    // Past games closest to now (descending), with vod_url set
    const items = allGames
      .filter(function (g) {
        return (
          g &&
          isNonEmpty(g.vod_url) &&
          g.datetime &&
          new Date(g.datetime).getTime() <= nowMs
        );
      })
      .sort(function (a, b) {
        return new Date(b.datetime).getTime() - new Date(a.datetime).getTime();
      })
      .slice(0, 6);

    const $wrap = $(".vod_wrap");
    const $list = $wrap.find(".vod_list");
    const $template = $list.find(".vod_slide").first().clone(true);
    $list.empty();

    if (!items.length) {
      $wrap.remove(); // remove the dummy container
      $("#empty-vod").removeClass("is--hidden");
      return;
    }

    items.forEach(function (game) {
      const $slide = $template.clone(true).addClass("swiper-slide");

      // iFrame embed
      const $iframe = $slide.find('iframe[data-base="vod_url"]');
      if ($iframe.length) {
        $iframe.attr("src", ytEmbedUrl(game.vod_url));
        $iframe.attr("title", game.name || game.slug || "VOD");
      }

      // Link to game details (placeholder for now)
      const $link = $slide.find('[data-vod="link"]');
      if ($link.length) {
        $link.attr("href", buildGameLink(game) || "#");
      }

      $list.append($slide);
    });

    initVodSwiper();
  } catch (err) {
    console.error("[initVodSection] Failed:", err);
  }
}

function initVodSwiper() {
  if (typeof Swiper === "undefined") {
    console.warn("[initVodSwiper] Swiper not found.");
    return;
  }
  if (vodSwiper && typeof vodSwiper.destroy === "function") {
    vodSwiper.destroy(true, true);
    vodSwiper = null;
  }

  vodSwiper = new Swiper(".vod_wrap", {
    direction: "horizontal",
    loop: false,
    slidesPerView: 1,
    slidesPerGroup: 1,
    spaceBetween: 0,
    // Navigation
    navigation: {
      nextEl: "#vod-next",
      prevEl: "#vod-prev",
    },
    pagination: {
      el: "#vod-pagination",
      type: "bullets",
      clickable: true,
    },
  });
}
