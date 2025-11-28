// RUN ON PAGE LOAD ------------------------------------------------------------
$(document).ready(function () {
  initNewsticker(true);
});

/*!
 * script-newsticker.js
 * Requires: jQuery + base.js (supabaseClient, defaultCacheDuration)
 *
 * Usage:
 *   initNewsticker(true);  // prefer localStorage (3h), fetch if stale/missing
 *   initNewsticker(false); // always fetch fresh, then cache for 3h
 *
 * HTML expected (example):
 * <div class="newsticker">
 *   <div class="newsticker_header"><div>Neues</div></div>
 *   <div class="newsticker_inner"></div> <!-- overflow hidden mask -->
 * </div>
 *
 * Data source: Supabase table "news" (columns: id, newstext, order, created_at, edited_at)
 */

(function ($) {
  // ---------------------------
  // CONFIG
  // ---------------------------
  var STORAGE_KEY = "ticker_news_all";
  var TS_KEY = STORAGE_KEY + "_timestamp";
  var SPEED_PX_PER_SEC = 80; // marquee speed
  var SPACER_TEXT = "+++";

  // Ensure one style injection only
  var STYLE_ID = "nt-marquee-style";

  // ---------------------------
  // PUBLIC API
  // ---------------------------
  window.initNewsticker = function initNewsticker(useStorage) {
    // Ensure DOM and Supabase exist (base.js dispatches "supabase:ready")
    if (window.supabaseClient) {
      boot(useStorage);
    } else {
      document.addEventListener("supabase:ready", function () {
        boot(useStorage);
      });
    }
  };

  // ---------------------------
  // BOOT
  // ---------------------------
  function boot(useStorage) {
    var $inner = $(".newsticker_inner").first();
    if ($inner.length === 0) {
      console.warn("[newsticker] .newsticker_inner not found.");
      return;
    }

    // Fetch strategy
    if (useStorage) {
      var cached = readCache();
      if (cached) {
        buildAndRun($inner, cached);
        // Also refresh in background to keep cache warm (non-blocking)
        fetchNews().then(saveCache).catch(console.warn);
        return;
      }
      // No valid cache -> fetch now
      fetchNews()
        .then(function (rows) {
          saveCache(rows);
          buildAndRun($inner, rows);
        })
        .catch(function (err) {
          console.error("[newsticker] fetch failed:", err);
        });
    } else {
      // Always fetch fresh; then cache
      fetchNews()
        .then(function (rows) {
          saveCache(rows);
          buildAndRun($inner, rows);
        })
        .catch(function (err) {
          console.error("[newsticker] fetch failed:", err);
          // Soft fallback to stale cache if present
          var stale = readCache({ allowStale: true });
          if (stale) buildAndRun($inner, stale);
        });
    }
  }

  // ---------------------------
  // DATA
  // ---------------------------
  function fetchNews() {
    if (!window.supabaseClient) {
      return Promise.reject(
        new Error("supabaseClient missing. Ensure base.js ran.")
      );
    }
    // Select minimal fields; order by "order" ascending
    return window.supabaseClient
      .from("news")
      .select("id,newstext,order")
      .order("order", { ascending: true })
      .then(function (res) {
        if (res.error) throw res.error;
        var rows = Array.isArray(res.data) ? res.data : [];
        // Defensive: filter out empty/undefined texts
        rows = rows.filter(function (r) {
          return (
            r && typeof r.newstext === "string" && r.newstext.trim() !== ""
          );
        });
        return rows;
      });
  }

  function readCache(opts) {
    opts = opts || {};
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      var ts = parseInt(localStorage.getItem(TS_KEY), 10);
      if (!raw || !ts) return null;

      var age = Date.now() - ts;
      var ttl = window.defaultCacheDuration || 3 * 60 * 60 * 1000; // 3h
      if (age < ttl || opts.allowStale) {
        var data = JSON.parse(raw);
        if (Array.isArray(data) && data.length) return data;
      }
      return null;
    } catch (e) {
      console.warn("[newsticker] readCache failed:", e);
      return null;
    }
  }

  function saveCache(rows) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(rows || []));
      localStorage.setItem(TS_KEY, String(Date.now()));
    } catch (e) {
      console.warn("[newsticker] saveCache failed:", e);
    }
  }

  // ---------------------------
  // DOM BUILD + MARQUEE
  // ---------------------------
  function buildAndRun($inner, rows) {
    // Clean slate
    $inner.empty();

    // Create one scrollable track we can animate as a single layer.
    // Structure:
    // .newsticker_inner (mask; overflow:hidden)
    //   .nt-track
    //     .nt-content  (items)
    //     .nt-content--clone (duplicate for seamless loop)
    var $track = $('<div class="nt-track" aria-hidden="true"></div>');
    var $content = $('<div class="nt-content"></div>');

    // Fill content with items (+ spacer after each)
    rows.forEach(function (r, idx) {
      var $item = $('<div class="newsticker_news"></div>').text(r.newstext);
      var $spacer = $(
        '<div class="newsticker_news newsticker_news-spacer"></div>'
      ).text(SPACER_TEXT);
      $content.append($item).append($spacer);
    });

    // Minimal inline layout so it works without extra CSS:
    injectOnceGlobalStyles();

    // Insert into DOM so we can measure
    $track.append($content);
    $inner.append($track);

    // Measure and clone to ensure seamless loop
    // We need the width of one "content" block to compute animation distance
    var contentWidth = measureOuterWidth($content);
    if (contentWidth <= 0) {
      console.warn("[newsticker] content width is 0; aborting marquee.");
      return;
    }

    // Duplicate content once (content + clone) for continuous scroll
    var $clone = $content.clone(true).addClass("nt-content--clone");
    $track.append($clone);

    // Ensure track is at least 2x content width (content + clone)
    // Set flex so everything is a single horizontal line.
    // Set animation distance = contentWidth
    startMarquee($track, contentWidth);
    $inner.addClass("is--init");

    // Recompute on resize (debounced)
    var debounced = debounce(function () {
      restartMarquee($inner, rows);
    }, 200);
    $(window).off("resize.ntTicker").on("resize.ntTicker", debounced);
  }

  function startMarquee($track, distancePx) {
    // duration = distance / speed
    var durSec = Math.max(5, distancePx / SPEED_PX_PER_SEC);

    // Apply CSS vars for this instance
    $track
      .css({
        "--nt-distance": distancePx + "px",
        "--nt-duration": durSec + "s",
      })
      .addClass("nt-marquee-running");
  }

  function restartMarquee($inner, rows) {
    // Rebuild from scratch to keep logic simple & robust
    buildAndRun($inner, rows);
  }

  function injectOnceGlobalStyles() {
    if (document.getElementById(STYLE_ID)) return;

    var css = `
        /* --- Newsticker minimal runtime styles (injected by script) --- */
        .newsticker_inner { position: relative; overflow: hidden; }
        .nt-track {
          display: flex;
          flex-direction: row;
          align-items: center;
          white-space: nowrap;
          will-change: transform;
        }
        .nt-content, .nt-content--clone {
          display: inline-flex;
          flex-direction: row;
          align-items: center;
          white-space: nowrap;
        }
        .newsticker_news {
          display: inline-block;
        }
        .newsticker_news.newsticker_news-spacer {
          opacity: 0.6;
          letter-spacing: 0.15em;
        }
        .nt-marquee-running {
          animation-name: nt-marquee-x;
          animation-duration: var(--nt-duration, 20s);
          animation-timing-function: linear;
          animation-iteration-count: infinite;
          animation-delay: 0s;
          animation-fill-mode: forwards;
        }
        @keyframes nt-marquee-x {
          from { transform: translate3d(0,0,0); }
          to   { transform: translate3d(calc(var(--nt-distance, 500px) * -1), 0, 0); }
        }
      `;
    var tag = document.createElement("style");
    tag.id = STYLE_ID;
    tag.type = "text/css";
    tag.appendChild(document.createTextNode(css));
    document.head.appendChild(tag);
  }

  // ---------------------------
  // UTIL
  // ---------------------------
  function measureOuterWidth($el) {
    // Force a reflow-safe measurement
    try {
      var el = $el[0];
      if (!el) return 0;
      var rect = el.getBoundingClientRect();
      return rect.width;
    } catch (e) {
      return $el.outerWidth(true) || 0;
    }
  }

  function debounce(fn, wait) {
    var t;
    return function () {
      clearTimeout(t);
      var args = arguments;
      var ctx = this;
      t = setTimeout(function () {
        fn.apply(ctx, args);
      }, wait);
    };
  }
})(jQuery);
