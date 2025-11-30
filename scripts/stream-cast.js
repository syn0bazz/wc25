// =============================================================================
// stream-cast.js
// Handles realtime updates for Caster Display Names based on the active game.
// =============================================================================

$(document).ready(function () {
  // If Supabase is already ready, init immediately.
  if (window.supabaseClient) {
    initStreamCast();
  } else {
    // Otherwise wait for base.js to signal readiness.
    document.addEventListener("supabase:ready", initStreamCast, { once: true });
  }
});

/**
 * Main initialization:
 * 1. Perform initial fetch/render.
 * 2. Set up realtime subscription for updates.
 */
function initStreamCast() {
  const supabase = window.supabaseClient;
  if (!supabase) {
    console.error("[stream-cast] Supabase client not found.");
    return;
  }

  // 1. Initial Fetch
  updateCasterDisplay();

  // 2. Realtime Subscription
  // Listen for ANY change in the 'games' table.
  // If the active game changes, or a new game becomes active, we re-fetch.
  supabase
    .channel("public:games")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "games" },
      function (payload) {
        console.log("[stream-cast] Realtime update received:", payload);
        // Simple strategy: Re-fetch the active row whenever 'games' changes.
        // This ensures we handle switching active games or updating names correctly.
        updateCasterDisplay();
      }
    )
    .subscribe();
}

/**
 * Fetches the single game where active = TRUE and updates the DOM.
 */
async function updateCasterDisplay() {
  const supabase = window.supabaseClient;

  // Fetch the active game
  const { data, error } = await supabase
    .from("games")
    .select("prod_cast_1_display, prod_cast_2_display")
    .eq("active", true)
    .maybeSingle();

  if (error) {
    console.error("[stream-cast] Error fetching active game:", error);
    return;
  }

  // Helper to safely update text
  const updateText = (selector, text) => {
    const $el = $(selector);
    if ($el.length) {
      $el.text(text || ""); // Clear text if null/undefined
    }
  };

  if (data) {
    // We have an active game, update fields
    updateText('[data-base="prod_cast_1_display"]', data.prod_cast_1_display);
    updateText('[data-base="prod_cast_2_display"]', data.prod_cast_2_display);
  } else {
    // No active game found, clear the fields
    updateText('[data-base="prod_cast_1_display"]', "");
    updateText('[data-base="prod_cast_2_display"]', "");
  }
}