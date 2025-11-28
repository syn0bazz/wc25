// script-history.js
// creates medals table from a *separate* Supabase instance
// loaded after: jquery, base.js, script.js, swiper
// reuses debounce() + toggleHelpOverlay() from script.js

// -----------------------------------------------------------------------------
// CONFIG: medals Supabase (different instance than the global one in base.js!)
// -----------------------------------------------------------------------------
const SUPABASE_MEDALS_URL = "https://sibxexubpdjuuqoolhda.supabase.co";
const SUPABASE_MEDALS_ANON =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNpYnhleHVicGRqdXVxb29saGRhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTMzNTA4NjMsImV4cCI6MjA2ODkyNjg2M30.8odQj1s0PE7ZfHmziiYCT-WRL89FYREhPJE8dkGuevQ";

// we keep this client entirely separate
var supabaseMedals = null;

// RUN ON PAGE LOAD ----------------------------------------------------------
$(document).ready(function () {
  // init dedicated client
  supabaseMedals = supabase.createClient(
    SUPABASE_MEDALS_URL,
    SUPABASE_MEDALS_ANON
  );

  // fetch + render medals, then create swiper
  buildMedalsTableFromOtherInstance()
    .then(function () {
      initSwiperMedaillen();
    })
    .catch(function (err) {
      console.warn("[script-history] medals build failed:", err);
    });

  // other section
  initAftermovieSwiper();

  // reuse the global helper overlay (from script.js)
  toggleHelpOverlay();
});

// RUN ON WINDOW RESIZE ------------------------------------------------------
$(window).resize(debounce(function () {}, 250));

// RUN ON SCROLL -------------------------------------------------------------
$(window).scroll(debounce(function () {}, 100));

// =============================================================================
// MAIN: build medals table
// =============================================================================

/**
 * Fetch medals from the *other* Supabase, sort, group into slides, and render.
 */
async function buildMedalsTableFromOtherInstance() {
  var $wrapper = $("#tabelle-medaillen");
  if (!$wrapper.length) {
    console.warn("[script-history] #tabelle-medaillen not found.");
    return;
  }

  var $slideTemplate = $wrapper.find(".tabelle_inner").first();
  var $rowTemplate = $slideTemplate.find(".statrow").first();
  if (!$slideTemplate.length || !$rowTemplate.length) {
    console.warn("[script-history] slide or row template missing.");
    return;
  }

  // ---------------------------------------------------------------------------
  // 🔹 Try to load cached data first
  // ---------------------------------------------------------------------------
  const cacheKey = "ggbase_medals";
  const cacheDurationMs = 7 * 24 * 60 * 60 * 1000; // 7 days
  const cached = localStorage.getItem(cacheKey);
  let medals = null;

  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      if (parsed.timestamp && Date.now() - parsed.timestamp < cacheDurationMs) {
        medals = parsed.data;
        console.log("[script-history] medals loaded from cache.");
      }
    } catch (e) {
      console.warn("[script-history] invalid cache:", e);
    }
  }

  // ---------------------------------------------------------------------------
  // 🔹 Fetch from Supabase if no valid cache
  // ---------------------------------------------------------------------------
  if (!medals) {
    const { data, error } = await supabaseMedals
      .from("medals")
      .select("id, name, team, points, gold, silver, bronze, avatar")
      .order("points", { ascending: false })
      .order("gold", { ascending: false })
      .order("silver", { ascending: false })
      .order("bronze", { ascending: false });

    if (error) {
      console.error("[script-history] medals fetch error:", error);
      return;
    }

    medals = Array.isArray(data) ? data.slice() : [];

    // Cache it
    try {
      localStorage.setItem(
        cacheKey,
        JSON.stringify({ timestamp: Date.now(), data: medals })
      );
      console.log("[script-history] medals cached in localStorage.");
    } catch (err) {
      console.warn("[script-history] could not cache medals:", err);
    }
  }

  // ---------------------------------------------------------------------------
  // Sorting & placement logic (unchanged)
  // ---------------------------------------------------------------------------
  medals.sort(function (a, b) {
    var pa = Number(a.points || 0);
    var pb = Number(b.points || 0);
    if (pa !== pb) return pb - pa;

    var ga = Number(a.gold || 0);
    var gb = Number(b.gold || 0);
    if (ga !== gb) return gb - ga;

    var sa = Number(a.silver || 0);
    var sb = Number(b.silver || 0);
    if (sa !== sb) return sb - sa;

    var ba = Number(a.bronze || 0);
    var bb = Number(b.bronze || 0);
    if (ba !== bb) return bb - ba;

    return Number(a.id || 0) - Number(b.id || 0);
  });

  var currentPlacement = 0;
  var lastScoreKey = null;
  medals.forEach(function (row, idx) {
    var key =
      (row.points || 0) +
      "|" +
      (row.gold || 0) +
      "|" +
      (row.silver || 0) +
      "|" +
      (row.bronze || 0);
    if (key !== lastScoreKey) {
      currentPlacement = idx + 1;
      lastScoreKey = key;
    }
    row.__placement = currentPlacement;
    row.__scoreKey = key;
  });

  var placementLastIndex = {};
  medals.forEach(function (row, idx) {
    placementLastIndex[row.__placement] = idx;
  });

  var $sliderWrap = $wrapper.find(".tabelle_sliderwrap");
  if (!$sliderWrap.length) {
    console.warn("[script-history] .tabelle_sliderwrap missing.");
    return;
  }
  $sliderWrap.empty();

  var chunkSize = 6;
  for (var i = 0; i < medals.length; i += chunkSize) {
    var chunk = medals.slice(i, i + chunkSize);
    var $slide = $slideTemplate.clone(true, true);
    $slide.empty();

    chunk.forEach(function (playerRow, idxInChunk) {
      var realIndex = i + idxInChunk;
      var $row = $rowTemplate.clone(true, true);
      fillMedalRow($row, playerRow, realIndex, placementLastIndex);
      $slide.append($row);
    });

    $sliderWrap.append($slide);
  }

  if (medals.length === 0) {
    var $emptySlide = $slideTemplate.clone(true, true);
    $emptySlide.find("[data-base]").text("");
    $sliderWrap.append($emptySlide);
  }
}

/**
 * Fill a cloned .statrow with medal data.
 * Adds .is--margin-bottom if this row is the *last* of its placement.
 */
function fillMedalRow($row, playerRow, realIndex, placementLastIndex) {
  // convenience
  function safeNum(v) {
    var n = Number(v);
    return isNaN(n) ? 0 : n;
  }

  // detect if *this* row is the last in its placement group
  var placement = playerRow.__placement;
  var isLastOfPlacement = placementLastIndex[placement] === realIndex;
  if (isLastOfPlacement) {
    $row.addClass("is--margin-bottom");
  }

  // 🔹 highlight first place
  if (placement === 1) {
    $row.addClass("is--highlight");
  }

  // placement
  var $placement = $row.find("[data-base='placement']");
  if ($placement.length) {
    $placement.text(placement + ".");
  }

  // avatar
  var $avatarImg = $row.find("[data-base='avatar']");
  if ($avatarImg.length) {
    var avatarUrl = playerRow.avatar || "";
    if (avatarUrl) {
      $avatarImg.attr("src", avatarUrl);
    }
  }

  // name
  var $name = $row.find("[data-base='name']");
  if ($name.length) {
    $name.text(playerRow.name || "");
  }

  // team
  var $team = $row.find("[data-base='team']");
  if ($team.length) {
    $team.text(playerRow.team || "");
  }

  // points
  var $points = $row.find("[data-base='points']");
  if ($points.length) {
    $points.text(safeNum(playerRow.points));
  }

  // medals (with "x")
  var $gold = $row.find("[data-base='gold']");
  if ($gold.length) {
    $gold.text(safeNum(playerRow.gold) + "x");
  }
  var $silver = $row.find("[data-base='silver']");
  if ($silver.length) {
    $silver.text(safeNum(playerRow.silver) + "x");
  }
  var $bronze = $row.find("[data-base='bronze']");
  if ($bronze.length) {
    $bronze.text(safeNum(playerRow.bronze) + "x");
  }
}

// =============================================================================
// SWIPER CONFIG (Medaillen)
// =============================================================================

function initSwiperMedaillen() {
  var $statsElement = $("#tabelle-medaillen");

  // Check if the stats element and slides exist before initializing Swiper
  if ($statsElement.length && $("#tabelle-medaillen .swiper-slide").length) {
    var swiper = new Swiper("#tabelle-medaillen", {
      direction: "horizontal",
      loop: false,
      slidesPerView: 1,
      slidesPerGroup: 1,
      spaceBetween: 64,
      // Navigation
      navigation: {
        nextEl: "#medaillen-next",
        prevEl: "#medaillen-prev",
      },
      pagination: {
        el: "#medaillen-pagination",
        type: "bullets",
        clickable: true,
      },
    });
  } else {
    console.log(
      "No 'Medaillen' found or no slides present; Swiper not initialized."
    );
  }
}

// =============================================================================
// SWIPER CONFIG (Aftermovie – unchanged)
// =============================================================================

function initAftermovieSwiper() {
  var $movieElement = $("#aftermovie-swiper");

  // Check if the stats element and slides exist before initializing Swiper
  if ($movieElement.length && $("#aftermovie-swiper .swiper-slide").length) {
    movieSwiper = new Swiper(".vod_wrap", {
      direction: "horizontal",
      loop: false,
      slidesPerView: 1,
      slidesPerGroup: 1,
      spaceBetween: 0,
      // Navigation
      navigation: {
        nextEl: "#movie-next",
        prevEl: "#movie-prev",
      },
      pagination: {
        el: "#movie-pagination",
        type: "bullets",
        clickable: true,
      },
    });
  } else {
    console.log(
      "No 'Aftermovies' found or no slides present; Swiper not initialized."
    );
  }
}
