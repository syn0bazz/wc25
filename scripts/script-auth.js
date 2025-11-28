// =============================================================================
// Global Auth Core (shared across pages)
// =============================================================================

// [STATE] --------------------------------------------------------------------
// Global, neutral auth context for the whole site.
window.AppAuth = window.AppAuth || {
  supabase: null,
  session: null,
  user: null,
  player: null,
  team: null,
  // Optional hook from pages: async ({ isSignedIn, session, user, player, team })
  onAuthStateChange: null,
};

var AppAuth = window.AppAuth;

// =============================================================================
// Helpers
// =============================================================================

// [SUPABASE CLIENT BOOTSTRAP] -----------------------------------------------
function authWaitForSupabaseClient() {
  return new Promise((resolve, reject) => {
    if (window.supabaseClient) return resolve(window.supabaseClient);

    const onReady = (e) => {
      document.removeEventListener("supabase:ready", onReady);
      resolve(e?.detail?.client || window.supabaseClient);
    };

    document.addEventListener("supabase:ready", onReady, { once: true });

    const started = Date.now();
    const poll = setInterval(() => {
      if (window.supabaseClient) {
        clearInterval(poll);
        document.removeEventListener("supabase:ready", onReady);
        resolve(window.supabaseClient);
      } else if (Date.now() - started > 8000) {
        clearInterval(poll);
        document.removeEventListener("supabase:ready", onReady);
        reject(new Error("Timed out waiting for supabaseClient"));
      }
    }, 150);
  });
}

// [SESSION HELPERS] ---------------------------------------------------------
async function authReadSession() {
  const { data, error } = await AppAuth.supabase.auth.getSession();
  if (error) console.warn("[auth] getSession error:", error);
  AppAuth.session = data?.session || null;
  AppAuth.user = AppAuth.session?.user || null;
}

// [URL HELPERS] -------------------------------------------------------------
function authCleanPath() {
  const cleanPath = window.location.pathname.split("?")[0];
  return `${window.location.origin}${cleanPath}`;
}

// [VISIBILITY HELPERS] ------------------------------------------------------
function authIsVisible($el) {
  if (!$el || !$el.length) return false;
  const el = $el[0];
  if (el.hidden) return false;

  const style = window.getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden") return false;
  if (parseFloat(style.opacity || "1") === 0) return false;

  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function authAnyLoginVisible() {
  let visible = false;
  $(".tf-login").each(function () {
    const $el = $(this);
    if ($el.is('[data-auth="status"]')) return; // ignore status element itself
    if (authIsVisible($el)) {
      visible = true;
      return false;
    }
  });
  return visible;
}

// [STATUS] ------------------------------------------------------------------
function authStatus(msg, type) {
  const $el = $('[data-auth="status"]');
  if ($el.length === 0) return;

  if (!msg) {
    $el.attr("hidden", true).text("");
    return;
  }

  // Only show status when no other login element is visible
  if (authAnyLoginVisible()) {
    $el.attr("hidden", true);
    return;
  }

  $el
    .attr("data-type", type || "info")
    .removeAttr("hidden")
    .text(String(msg));
}

// [AUTH VISIBILITY HOOK] ----------------------------------------------------
function authUpdateVisibility(isSignedIn) {
  $('[data-auth="signed-in"]').each(function () {
    this.hidden = !isSignedIn;
  });
  $('[data-auth="signed-out"]').each(function () {
    this.hidden = !!isSignedIn;
  });

  // Generic body attribute for global styling if needed
  if (isSignedIn) {
    document.body.setAttribute("data-auth-state", "signed-in");
  } else {
    document.body.setAttribute("data-auth-state", "signed-out");
  }
}

// [DISCORD ID RESOLUTION] ---------------------------------------------------
function authGetDiscordId(user) {
  if (!user) return null;

  try {
    const identity = (user.identities || []).find(
      (i) => i?.provider === "discord"
    );
    const sub =
      identity?.identity_data?.sub ||
      identity?.identity_data?.user_id ||
      identity?.id;
    if (sub) return String(sub);
  } catch (_) {}

  try {
    const sub = user.user_metadata?.sub || user.user_metadata?.provider_id;
    if (sub) return String(sub);
  } catch (_) {}

  return null;
}

// =============================================================================
// Domain-specific lookups (players / teams)
// =============================================================================

// [WHITELIST LOOKUP] --------------------------------------------------------
async function authEnsureWhitelistedUser() {
  if (!AppAuth.user) return { ok: false, reason: "no-user" };

  const discordId = authGetDiscordId(AppAuth.user);
  if (!discordId) {
    return { ok: false, reason: "no-discord-id" };
  }

  const { data, error } = await AppAuth.supabase
    .from("players")
    .select("slug,pname,discord_id,auth_user_id")
    .eq("discord_id", discordId)
    .maybeSingle();

  if (error && error.code !== "PGRST116") {
    console.warn("[auth] players lookup error:", error);
    return { ok: false, reason: "query-error", error };
  }

  if (!data) {
    return { ok: false, reason: "not-whitelisted" };
  }

  AppAuth.player = data;

  if (!data.auth_user_id && AppAuth.user?.id) {
    try {
      await AppAuth.supabase
        .from("players")
        .update({ auth_user_id: AppAuth.user.id })
        .eq("slug", data.slug);
    } catch (e) {
      console.warn("[auth] players.auth_user_id update warning:", e);
    }
  }

  return { ok: true, player: data };
}

// [TEAM RESOLUTION] ---------------------------------------------------------
async function authEnsureTeamForCurrentPlayer() {
  if (!AppAuth.player) {
    AppAuth.team = null;
    return null;
  }

  var playerSlug = AppAuth.player.slug;
  if (!playerSlug) {
    AppAuth.team = null;
    return null;
  }

  // Try preloaded teams from local cache
  try {
    var preload =
      (window.__supabasePreload && window.__supabasePreload.teams) || [];
    if (Array.isArray(preload) && preload.length) {
      for (var i = 0; i < preload.length; i++) {
        var t = preload[i];
        if (!t) continue;
        if (t.p1_slug === playerSlug || t.p2_slug === playerSlug) {
          AppAuth.team = t;
          return AppAuth.team;
        }
      }
    }
  } catch (e) {
    console.warn("[auth] team preload lookup warning:", e);
  }

  // Fallback: query by p1_slug
  try {
    var res1 = await AppAuth.supabase
      .from("teams")
      .select("id,slug,tag,p1_slug,p2_slug")
      .eq("p1_slug", playerSlug)
      .maybeSingle();

    if (!res1.error && res1.data) {
      AppAuth.team = res1.data;
      return AppAuth.team;
    }

    // Fallback: query by p2_slug
    var res2 = await AppAuth.supabase
      .from("teams")
      .select("id,slug,tag,p1_slug,p2_slug")
      .eq("p2_slug", playerSlug)
      .maybeSingle();

    if (!res2.error && res2.data) {
      AppAuth.team = res2.data;
      return AppAuth.team;
    }
  } catch (e) {
    console.warn("[auth] team lookup error:", e);
  }

  AppAuth.team = null;
  return null;
}

// [PROFILE UI] --------------------------------------------------------------
async function authFillLoginProfile() {
  var $root = $("#login");
  if (!$root.length) return;

  var player = AppAuth.player;
  var team = AppAuth.team;

  var pname = player && player.pname ? player.pname : "";
  var tag = team && team.tag ? team.tag : "";

  setTextIfExists($root.find('[data-base="pname"]'), pname);
  setTextIfExists($root.find('[data-base="tag"]'), tag);

  var avatarUrl = "";
  var logoUrl = "";

  if (player) {
    var teamSlug = team && team.slug ? team.slug : null;
    var pIdx = "p1";

    if (team && team.p2_slug && player.slug === team.p2_slug) {
      pIdx = "p2";
    }

    if (teamSlug && typeof buildAssetUrl === "function") {
      try {
        avatarUrl = buildAssetUrl(
          "players",
          player.slug,
          pIdx + "-60",
          teamSlug
        );
      } catch (e) {
        console.warn("[auth] avatar asset url error:", e);
      }
    }
  }

  if (team && team.slug && typeof buildAssetUrl === "function") {
    try {
      // data-base="logo-150-isolated" → preset key "logo-150-iso"
      logoUrl = buildAssetUrl("teams", team.slug, "logo-150-iso");
    } catch (e) {
      console.warn("[auth] logo asset url error:", e);
    }
  }

  if (avatarUrl) {
    setAttrIfExists($root.find('[data-base="avatar-60"]'), "src", avatarUrl);
  }

  if (logoUrl) {
    setAttrIfExists(
      $root.find('[data-base="logo-150-isolated"]'),
      "src",
      logoUrl
    );
  }
}

// =============================================================================
// Auth lifecycle
// =============================================================================

async function authAfterAuthChange() {
  await authReadSession();
  let isSignedIn = !!AppAuth.user;

  const saved = localStorage.getItem("tf_post_auth");
  if (saved && isSignedIn) {
    localStorage.removeItem("tf_post_auth");
    if (saved !== window.location.href) {
      window.location.replace(saved);
      return;
    }
  }

  try {
    const url = new URL(window.location.href);
    if (url.searchParams.has("code") || url.searchParams.has("state")) {
      window.history.replaceState({}, "", authCleanPath());
    }
  } catch (_) {}

  AppAuth.player = null;
  AppAuth.team = null;

  if (isSignedIn) {
    authStatus("Checking permission …", "info");

    const res = await authEnsureWhitelistedUser();
    if (!res.ok) {
      let reasonMsg =
        "Dein Discord-Account hat keinen Zugriff auf diese Seite.";

      if (res.reason === "no-discord-id") {
        reasonMsg =
          "Die Discord-ID konnte nicht aus deinem Account gelesen werden.";
      } else if (res.reason === "query-error") {
        reasonMsg =
          "Berechtigungsprüfung fehlgeschlagen. Bitte später erneut versuchen.";
      } else if (res.reason === "no-user") {
        reasonMsg = "Du bist nicht angemeldet.";
      }

      authStatus(reasonMsg, "error");

      try {
        await AppAuth.supabase.auth.signOut();
      } catch (e) {
        console.warn("[auth] signOut warning:", e);
      }

      isSignedIn = false;
    } else {
      authStatus(null);
      await authEnsureTeamForCurrentPlayer();
      await authFillLoginProfile();
    }
  } else {
    authStatus(null);
  }

  authUpdateVisibility(isSignedIn);

  // Page hook: scheduler or other pages can register a callback here
  if (typeof AppAuth.onAuthStateChange === "function") {
    try {
      await AppAuth.onAuthStateChange({
        isSignedIn: isSignedIn,
        session: AppAuth.session,
        user: AppAuth.user,
        player: AppAuth.player,
        team: AppAuth.team,
      });
    } catch (e) {
      console.warn("[auth] onAuthStateChange handler failed:", e);
    }
  }
}

// [AUTH ACTIONS] ------------------------------------------------------------
async function authOnLoginDiscord() {
  try {
    localStorage.setItem("tf_post_auth", window.location.href);

    const shortRedirect = authCleanPath();
    const { error } = await AppAuth.supabase.auth.signInWithOAuth({
      provider: "discord",
      options: { redirectTo: shortRedirect },
    });

    if (error) throw error;
  } catch (err) {
    console.error("[auth] Discord login error:", err);
    authStatus("Login fehlgeschlagen. Bitte erneut versuchen.", "error");
  }
}

async function authOnLogout() {
  try {
    await AppAuth.supabase.auth.signOut();
    AppAuth.player = null;
    AppAuth.team = null;
    authStatus(null);
    await authAfterAuthChange();
  } catch (err) {
    console.error("[auth] logout error:", err);
    authStatus("Logout fehlgeschlagen. Bitte erneut versuchen.", "error");
  }
}

// [BOOTSTRAP] ---------------------------------------------------------------
async function authInitLifecycle() {
  if (AppAuth._initialized) {
    // Ensure supabase is attached if something reset it
    if (!AppAuth.supabase) {
      AppAuth.supabase = await authWaitForSupabaseClient();
    }
    return;
  }

  AppAuth.supabase = await authWaitForSupabaseClient();

  try {
    AppAuth.supabase.auth.startAutoRefresh();
  } catch (_) {}

  await authReadSession();
  await authAfterAuthChange();

  document.addEventListener("visibilitychange", async () => {
    if (!AppAuth.supabase || !AppAuth.supabase.auth) return;

    if (document.visibilityState === "visible") {
      try {
        AppAuth.supabase.auth.startAutoRefresh();
      } catch (_) {}
      await AppAuth.supabase.auth.getUser();
    } else {
      try {
        AppAuth.supabase.auth.stopAutoRefresh();
      } catch (_) {}
    }
  });

  AppAuth.supabase.auth.onAuthStateChange(async (event, _session) => {
    AppAuth.session = _session;
    AppAuth.user = AppAuth.session?.user || null;

    if (
      [
        "INITIAL_SESSION",
        "SIGNED_IN",
        "SIGNED_OUT",
        "TOKEN_REFRESHED",
      ].includes(event)
    ) {
      await authAfterAuthChange();
    }
  });

  AppAuth._initialized = true;
}
