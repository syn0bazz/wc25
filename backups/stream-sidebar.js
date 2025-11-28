// script-seitenleiste.js
// Assumes jQuery and base.js are loaded (base.js initializes supabaseClient and fires "supabase:ready").

/**
 * Fetch the single most recent active game, then its two teams and players,
 * and render into:
 *   - #t1-name, #t2-name
 *   - #t1-players, #t2-players   (format: "Player1 & Player2")
 *   - #t1-logo, #t2-logo         (src = "https://glatte.info/wc25/teams/<slug>_logo-150px_flat.webp")
 */
(function () {
  // Run as soon as Supabase is ready (from base.js) or immediately if already present.
  if (window.supabaseClient) {
    loadActiveGameAndRender().catch(console.error);
  } else {
    document.addEventListener("supabase:ready", function () {
      loadActiveGameAndRender().catch(console.error);
    });
  }

  async function loadActiveGameAndRender() {
    try {
      // 1) Get the (latest) active game
      const { data: gamesData, error: gamesError } = await supabaseClient
        .from("games")
        .select("t1_slug, t2_slug, datetime")
        .eq("active", true)
        .order("datetime", { ascending: false })
        .limit(1);

      if (gamesError) throw gamesError;
      const activeGame = Array.isArray(gamesData) ? gamesData[0] : null;
      if (!activeGame) {
        console.warn("[seitenleiste] No active game found.");
        return;
      }

      const t1Slug = activeGame.t1_slug;
      const t2Slug = activeGame.t2_slug;
      if (!t1Slug || !t2Slug) {
        console.warn(
          "[seitenleiste] Active game missing team slugs:",
          activeGame
        );
        return;
      }

      // 2) Fetch both teams
      const { data: teamsData, error: teamsError } = await supabaseClient
        .from("teams")
        .select("slug, tname, p1_slug, p2_slug")
        .in("slug", [t1Slug, t2Slug]);

      if (teamsError) throw teamsError;
      const teamBySlug = {};
      (teamsData || []).forEach((t) => (teamBySlug[t.slug] = t));

      const t1 = teamBySlug[t1Slug];
      const t2 = teamBySlug[t2Slug];
      if (!t1 || !t2) {
        console.warn("[seitenleiste] Could not resolve both teams.", {
          t1,
          t2,
        });
        return;
      }

      // 3) Fetch all 4 players by slug (p1 + p2 for each team)
      const playerSlugs = [
        t1.p1_slug,
        t1.p2_slug,
        t2.p1_slug,
        t2.p2_slug,
      ].filter(Boolean);
      const { data: playersData, error: playersError } = await supabaseClient
        .from("players")
        .select("slug, pname")
        .in("slug", playerSlugs);

      if (playersError) throw playersError;
      const playerNameBySlug = {};
      (playersData || []).forEach((p) => (playerNameBySlug[p.slug] = p.pname));

      // 4) Compose display strings
      const t1Name = t1.tname || t1.slug || "Team 1";
      const t2Name = t2.tname || t2.slug || "Team 2";

      const t1P1 = playerNameBySlug[t1.p1_slug] || "";
      const t1P2 = playerNameBySlug[t1.p2_slug] || "";
      const t2P1 = playerNameBySlug[t2.p1_slug] || "";
      const t2P2 = playerNameBySlug[t2.p2_slug] || "";

      const t1Players = [t1P1, t1P2].filter(Boolean).join(" & ");
      const t2Players = [t2P1, t2P2].filter(Boolean).join(" & ");

      // 5) Update DOM
      $("#t1-name").text(t1Name);
      $("#t2-name").text(t2Name);
      $("#t1-players").text(t1Players);
      $("#t2-players").text(t2Players);

      // 6) Logos (exact URL format requested)
      const mkLogoUrlFlat = (slug) =>
        "https://glatte.info/gg/wc25/assets/teams/" +
        slug +
        "_logo-150px_flat.webp";
      const mkLogoUrlIsolated = (slug) =>
        "https://glatte.info/gg/wc25/assets/teams/" +
        slug +
        "_logo-150px_isolated.webp";

      $("#t1-logo-flat")
        .attr("src", mkLogoUrlFlat(t1.slug))
        .attr("alt", t1Name);
      $("#t2-logo-flat")
        .attr("src", mkLogoUrlFlat(t2.slug))
        .attr("alt", t2Name);
      $("#t1-logo-isolated")
        .attr("src", mkLogoUrlIsolated(t1.slug))
        .attr("alt", t1Name);
      $("#t2-logo-isolated")
        .attr("src", mkLogoUrlIsolated(t2.slug))
        .attr("alt", t2Name);
    } catch (err) {
      console.error("[seitenleiste] Failed to load/render active game:", err);
    }
  }
})();
