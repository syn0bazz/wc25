// =============================================================================
// script-guide.js
// Map Guide: build list from Supabase "maps" table
// =============================================================================

// RUN ON PAGE LOAD -----------------------------------------------------------
$(document).ready(function () {
  initMapGuide();
});

// RUN ON WINDOW RESIZE -------------------------------------------------------
$(window).resize(
  debounce(function () {
    /* reserved for future use */
  }, 250)
);

// RUN ON SCROLL --------------------------------------------------------------
$(window).scroll(
  debounce(function () {
    /* reserved for future use */
  }, 100)
);

// =============================================================================
// [MAP GUIDE]
// =============================================================================

function initMapGuide() {
  // If there's no map list on this page, no reason to do anything
  if (!$("#maplist").length) return;

  // If Supabase is already initialized, run immediately
  if (window.supabaseClient) {
    buildMapGuide().catch(function (err) {
      console.error("[script-guide] buildMapGuide failed:", err);
    });
  } else {
    // Otherwise, wait for the "supabase:ready" event from base.js
    document.addEventListener(
      "supabase:ready",
      function () {
        buildMapGuide().catch(function (err) {
          console.error("[script-guide] buildMapGuide failed:", err);
        });
      },
      { once: true }
    );
  }
}

async function buildMapGuide() {
  var $list = $("#maplist");
  if (!$list.length) return;

  // Use the first .hbmaps_item as template
  var $template = $list.children(".hbmaps_item").first();
  if (!$template.length) {
    console.warn("[script-guide] No .hbmaps_item template found.");
    return;
  }

  // Clear current list – we'll rebuild from Supabase data
  $list.empty();

  // fetchMaps() comes from base.js and already respects localStorage caching
  var maps = await fetchMaps();

  if (!Array.isArray(maps) || maps.length === 0) {
    console.warn("[script-guide] No maps returned from fetchMaps().");
    return;
  }

  // Sort maps alphabetically by name
  maps.sort(function (a, b) {
    return (a.mname || "").localeCompare(b.mname || "", "de", {
      sensitivity: "base",
    });
  });

  maps.forEach(function (map) {
    if (!map || !map.mid) {
      // Only render maps that have a "mid" set
      return;
    }

    var $item = $template.clone(true, true);

    // Make sure Webflow's default state doesn't clash with our accordion logic
    $item.removeClass("is-active-accordion");
    $item
      .find('[fs-accordion-element="arrow"]')
      .removeClass("is-active-accordion");

    // Basic text fields ------------------------------------------------------
    setTextIfExists($item.find('[data-base="mname"]'), map.mname || "");
    setTextIfExists($item.find('[data-base="subtitle"]'), map.subtitle || "");
    setTextIfExists($item.find('[data-base="desc_lore"]'), map.desc_lore || "");
    setTextIfExists(
      $item.find('[data-base="desc_gameplay"]'),
      map.desc_gameplay || ""
    );

    // Emblem image -----------------------------------------------------------
    var $emblem = $item.find('[data-base="emblem"]');
    var emblemUrl =
      map.urlEmblem ||
      (map.slug ? buildAssetUrl("map", map.slug, "-emblem") : "");
    setAttrIfExists($emblem, "src", emblemUrl);

    // Callouts image -----------------------------------------------------------
    var $callouts = $item.find('[data-base="callouts"]');
    var calloutsUrl =
      map.urlCallouts ||
      (map.slug ? buildAssetUrl("map", map.slug, "-callouts") : "");
    setAttrIfExists($callouts, "src", calloutsUrl);

    // Ratings paragraph ------------------------------------------------------
    var $ratings = $item.find('[data-base="ratings"]');
    if ($ratings.length) {
      var rt = map.rating_tactical;
      var ru = map.rating_utility;
      var rs = map.rating_tsided;
      $ratings.html(buildRatingsHtml(rt, ru, rs));
    }

    // Optional: store slug/mid on the root item for later hooks
    if (map.slug) {
      $item.attr("data-map-slug", map.slug);
    }
    if (map.mid) {
      $item.attr("data-map-mid", map.mid);
    }

    $list.append($item);
  });

  // After inserting all items, set initial accordion state
  var $items = $list.children(".hbmaps_item");
  $items.removeClass("is-active-accordion");
  if ($items.length) {
    $items.first().addClass("is-active-accordion"); // first item active on load
  }

  // Bind accordion behaviour (only once)
  initMapAccordion();
}

// =============================================================================
// [ACCORDION]
// =============================================================================

function initMapAccordion() {
  var $list = $("#maplist");
  if (!$list.length) return;

  // Prevent double-binding
  if ($list.data("accordion-bound")) return;
  $list.data("accordion-bound", true);

  // Delegate click handling to the list wrapper
  $list.on("click", '[fs-accordion-element="trigger"]', function (e) {
    e.preventDefault();

    var $item = $(this).closest(".hbmaps_item");
    if (!$item.length) return;

    // If this item is already active, close it instead
    if ($item.hasClass("is-active-accordion")) {
      $item.removeClass("is-active-accordion");
      return;
    }

    // Otherwise, deactivate others and activate this one
    $item
      .siblings(".hbmaps_item.is-active-accordion")
      .removeClass("is-active-accordion");
    $item.addClass("is-active-accordion");
  });
}

// =============================================================================
// [RATINGS RENDERING]
// =============================================================================

function buildRatingsHtml(rTactical, rUtility, rTSided) {
  function normalizeRating(val) {
    var n = parseInt(val, 10);
    if (isNaN(n) || n < 1 || n > 5) return 0; // 0 = no blue dot
    return n;
  }

  function buildCircles(rating) {
    var active = normalizeRating(rating);
    var out = "";
    for (var i = 1; i <= 5; i++) {
      out += active === i ? "🔵" : "🟣";
    }
    return out;
  }

  function repeatNbsp(count) {
    var s = "";
    for (var i = 0; i < count; i++) {
      s += "&nbsp;";
    }
    return s;
  }

  // Spaces are important here: the whole thing is in a monospace <code> block,
  // so these &nbsp; paddings keep the rating emojis aligned vertically.

  // Line 1: Brawl / Tactical
  var line1 =
    "<code>" +
    repeatNbsp(6) + // left padding
    "Brawl&nbsp;" + // label
    buildCircles(rTactical) + // rating dots
    "&nbsp;Taktisch" +
    repeatNbsp(5) +
    "</code>";

  // Line 2: Nades? / Utilityfest
  var line2 =
    "<code>" +
    repeatNbsp(4) +
    "Nades?&nbsp;" +
    buildCircles(rUtility) +
    "&nbsp;Utilityfest" +
    repeatNbsp(1) +
    "</code>";

  // Line 3: CT / T-side
  var line3 =
    "<code>" +
    repeatNbsp(15) +
    "CT&nbsp;" +
    buildCircles(rTSided) +
    "&nbsp;T" +
    repeatNbsp(21) +
    "</code>";

  // Line breaks inside the single <p data-base="ratings">
  return line1 + "<br>" + line2 + "<br>" + line3;
}
