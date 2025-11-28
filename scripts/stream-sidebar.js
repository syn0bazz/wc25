// script-seitenleiste.js
// Assumes jQuery and base.js are loaded (base.js initializes supabaseClient and fires "supabase:ready").

(function () {
  // Run as soon as Supabase is ready
  if (window.supabaseClient) {
    init();
  } else {
    document.addEventListener("supabase:ready", function () {
      init();
    });
  }

  function init() {
    // 1. Build the static elements (Logos, Names, Tags) ONCE
    buildStatic().then(() => {
      // 2. Fetch scores immediately
      updateScores();

      // 3. Set interval to refetch scores every 60s
      setInterval(() => {
        updateScores().catch(console.error);
      }, 60000);
    });
  }

  /**
   * Loads the active game to get Team Slugs, then fetches Team details
   * and renders the sidebar structure (Logos, Names, Tags).
   * Only runs once on page load.
   */
  async function buildStatic() {
    try {
      // Get the active game just to find out WHO is playing
      const { data: gamesData, error: gamesError } = await supabaseClient
        .from("games")
        .select("t1_slug, t2_slug")
        .eq("active", true)
        .order("datetime", { ascending: false })
        .limit(1);

      if (gamesError) throw gamesError;
      const activeGame = Array.isArray(gamesData) ? gamesData[0] : null;

      if (!activeGame || !activeGame.t1_slug || !activeGame.t2_slug) {
        console.warn("[seitenleiste] No active game or missing slugs found.");
        return;
      }

      // Fetch details for both teams
      const { data: teamsData, error: teamsError } = await supabaseClient
        .from("teams")
        .select("slug, tname, tag")
        .in("slug", [activeGame.t1_slug, activeGame.t2_slug]);

      if (teamsError) throw teamsError;

      // Map slug -> team object
      const teamBySlug = {};
      (teamsData || []).forEach((t) => (teamBySlug[t.slug] = t));

      const t1 = teamBySlug[activeGame.t1_slug];
      const t2 = teamBySlug[activeGame.t2_slug];

      if (!t1 || !t2) {
        console.warn("[seitenleiste] Could not resolve team details.");
        return;
      }

      // Render Text
      const t1Name = t1.tname || t1.slug || "Team 1";
      const t2Name = t2.tname || t2.slug || "Team 2";
      const t1Tag = (t1.tag || t1.slug || "Team 1").toUpperCase();
      const t2Tag = (t2.tag || t2.slug || "Team 2").toUpperCase();

      $('[data-base="t1-tag"]').text(t1Tag);
      $('[data-base="t2-tag"]').text(t2Tag);
      $('[data-base="t1-tname"]').text(t1Name);
      $('[data-base="t2-tname"]').text(t2Name);

      // Render Logos
      const mkLogoUrlFlat = (slug) =>
        "https://glatte.info/gg/wc25/assets/teams/" +
        slug +
        "_logo-150px_flat.webp";

      $('[data-base="t1-logo-72-flat"]').css(
        "background-image",
        `url("${mkLogoUrlFlat(t1.slug)}")`
      );
      $('[data-base="t2-logo-72-flat"]').css(
        "background-image",
        `url("${mkLogoUrlFlat(t2.slug)}")`
      );
    } catch (err) {
      console.error("[seitenleiste] Failed to build static assets:", err);
    }
  }

  /**
   * Fetches ONLY the scores for the active game.
   * Runs immediately and then every 60s.
   * Bypasses local storage cache by using raw supabaseClient query.
   */
  async function updateScores() {
    try {
      const { data: gamesData, error: gamesError } = await supabaseClient
        .from("games")
        .select("t1_score_total, t2_score_total")
        .eq("active", true)
        .order("datetime", { ascending: false })
        .limit(1);

      if (gamesError) throw gamesError;
      const activeGame = Array.isArray(gamesData) ? gamesData[0] : null;

      if (!activeGame) return;

      const s1 = activeGame.t1_score_total;
      const s2 = activeGame.t2_score_total;
      const $wrap = $('[data-base="wrap"]');

      // 1. Update Score Text (only if not null)
      if (s1 !== null && s1 !== undefined) {
        $('[data-base="t1_score_total"]').text(s1);
      }
      if (s2 !== null && s2 !== undefined) {
        $('[data-base="t2_score_total"]').text(s2);
      }

      // 2. Handle Winner Classes
      // Reset classes first
      $wrap.removeClass("is--w1 is--w2");

      // Apply class only if both scores exist and are not tied
      if (s1 !== null && s2 !== null) {
        if (s1 > s2) {
          $wrap.addClass("is--w1");
        } else if (s2 > s1) {
          $wrap.addClass("is--w2");
        }
      }
    } catch (err) {
      console.error("[seitenleiste] Failed to update scores:", err);
    }
  }
})();
