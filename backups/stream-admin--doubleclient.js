// =============================================================================
// Boot
// =============================================================================

// [STATE] -------------------------------------------------------------------
var SA = {
  supabase: null,
  session: null,
  user: null,
  player: null, // matched players row when Discord ID is whitelisted
};

// [DOC READY] ---------------------------------------------------------------
$(document).ready(function () {
  initAdminPage();
});

// [INITIALIZE SCHEDULER PAGE] -----------------------------------------------
async function initAdminPage() {
  console.log(
    "[streamadmin:init] ------------------------------------------------"
  );
  console.log("[streamadmin:init] Starting initAdminPage()");

  // Wait for Supabase client
  try {
    console.log("[streamadmin:init] Waiting for Supabase client…");
    SA.supabase = await saWaitForSupabaseClient();
    console.log("[streamadmin:init] Supabase ready:", SA.supabase);
  } catch (e) {
    console.error("[streamadmin:init] supabaseClient missing after wait:", e);
    saStatus("Connection error. Please reload the page.", "error");
    return;
  }

  // Start auto refresh
  try {
    console.log("[streamadmin:init] Trying startAutoRefresh()");
    SA.supabase.auth.startAutoRefresh();
    console.log("[streamadmin:init] AutoRefresh started");
  } catch (e) {
    console.warn("[streamadmin:init] AutoRefresh error:", e);
  }

  // UI immer verdrahten
  console.log("[streamadmin:init] Wiring login/logout button handlers …");
  saWireAuthUI();
  console.log("[streamadmin:init] saWireAuthUI() DONE");

  // Einmaligen Auth-Check / Session-Hydration
  console.log("[streamadmin:init] Calling saAfterAuthChange() …");
  try {
    await saAfterAuthChange();
  } catch (e) {
    console.error("[streamadmin:init] saAfterAuthChange() threw:", e);
  }
  console.log("[streamadmin:init] saAfterAuthChange() DONE");

  // Sichtbarkeits-Handling
  document.addEventListener("visibilitychange", async () => {
    console.log("[streamadmin:visibility] State:", document.visibilityState);
    if (document.visibilityState === "visible") {
      try {
        SA.supabase.auth.startAutoRefresh();
      } catch (_) {}
      await SA.supabase.auth.getUser();
    } else {
      try {
        SA.supabase.auth.stopAutoRefresh();
      } catch (_) {}
    }
  });

  // Auth Listener
  console.log("[streamadmin:init] Setting up onAuthStateChange listener …");
  SA.supabase.auth.onAuthStateChange(async (event, _session) => {
    console.log("[streamadmin:auth] Event:", event);
    console.log("[streamadmin:auth] Session:", _session);

    SA.session = _session;
    SA.user = SA.session?.user || null;

    if (
      [
        "INITIAL_SESSION",
        "SIGNED_IN",
        "SIGNED_OUT",
        "TOKEN_REFRESHED",
      ].includes(event)
    ) {
      console.log(
        "[streamadmin:auth] Triggering saAfterAuthChange() from event"
      );
      await saAfterAuthChange();
    }
  });

  console.log(
    "[streamadmin:init] ------------------------------------------------ END"
  );
}

// =============================================================================
// General Helper Functions
// =============================================================================

// [SUPABASE CLIENT BOOTSTRAP] -----------------------------------------------
function saWaitForSupabaseClient() {
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
async function saReadSession() {
  console.log(
    "[streamadmin:session] ------------------------------------------"
  );
  console.log("[streamadmin:session] Enter saReadSession()");
  console.log("[streamadmin:session] SA.supabase:", SA.supabase);

  if (
    !SA.supabase ||
    !SA.supabase.auth ||
    typeof SA.supabase.auth.getSession !== "function"
  ) {
    console.error(
      "[streamadmin:session] supabase auth NOT READY in saReadSession:",
      SA.supabase
    );
    SA.session = null;
    SA.user = null;
    return;
  }

  console.log("[streamadmin:session] Calling supabase.auth.getSession()…");

  // Timeout-Schutz, falls getSession nie resolved
  const timeoutMs = 5000;
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(
      () =>
        reject(
          new Error(
            "[streamadmin:session] getSession() timeout after " +
              timeoutMs +
              "ms"
          )
        ),
      timeoutMs
    )
  );

  let result;
  try {
    result = await Promise.race([
      SA.supabase.auth.getSession(),
      timeoutPromise,
    ]);
  } catch (e) {
    console.error("[streamadmin:session] getSession threw / timed out:", e);
    SA.session = null;
    SA.user = null;
    return;
  }

  const { data, error } = result || {};

  if (error) {
    console.warn("[streamadmin:session] getSession error:", error);
  } else {
    console.log("[streamadmin:session] getSession data:", data);
  }

  SA.session = data?.session || null;
  SA.user = SA.session?.user || null;

  console.log("[streamadmin:session] Final SA.session:", SA.session);
  console.log("[streamadmin:session] Final SA.user:", SA.user);
}

// [HASH AUTH HELPER] --------------------------------------------------------
async function saHydrateSessionFromHash() {
  console.log("[streamadmin:hash] Checking URL hash for auth tokens…");

  if (!SA.supabase || !SA.supabase.auth) {
    console.warn("[streamadmin:hash] supabase auth not ready");
    return false;
  }

  var hash = window.location.hash || "";
  if (!hash || hash.indexOf("access_token=") === -1) {
    console.log("[streamadmin:hash] No access_token in hash");
    return false;
  }

  var frag = hash.substring(1); // remove '#'
  var params = new URLSearchParams(frag);
  var accessToken = params.get("access_token");
  var refreshToken = params.get("refresh_token");

  console.log(
    "[streamadmin:hash] Parsed tokens from hash. access?",
    !!accessToken,
    "refresh?",
    !!refreshToken
  );

  if (!accessToken || !refreshToken) {
    console.warn(
      "[streamadmin:hash] Missing access_token or refresh_token in hash"
    );
    return false;
  }

  try {
    const { data, error } = await SA.supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });

    if (error) {
      console.error("[streamadmin:hash] setSession error:", error);
      return false;
    }

    SA.session = data?.session || null;
    SA.user = SA.session?.user || null;
    console.log(
      "[streamadmin:hash] Session hydrated from hash. SA.user:",
      SA.user
    );

    // URL aufräumen (Hash entfernen)
    try {
      var cleanUrl = saCleanPath();
      console.log("[streamadmin:hash] Cleaning URL hash, new URL:", cleanUrl);
      window.history.replaceState({}, "", cleanUrl);
    } catch (e) {
      console.warn("[streamadmin:hash] Failed to clean URL hash:", e);
    }

    return true;
  } catch (e) {
    console.error("[streamadmin:hash] setSession threw:", e);
    return false;
  }
}

// [STATUS HELPER] -----------------------------------------------------------
function saStatus(msg, type) {
  const $el = $('[data-auth="status"]');
  if ($el.length === 0) return;

  if (!msg) {
    $el.attr("hidden", true).text("");
    return;
  }

  // Only show status when no other .sa-auth element is visible
  if (saAnySALoginVisible()) {
    $el.attr("hidden", true);
    return;
  }

  $el
    .attr("data-type", type || "info")
    .removeAttr("hidden")
    .text(String(msg));
}

// [URL HELPERS] -------------------------------------------------------------
function saCleanPath() {
  const cleanPath = window.location.pathname.split("?")[0];
  return `${window.location.origin}${cleanPath}`;
}

// [VISIBILITY HELPERS] ------------------------------------------------------
function saIsVisible($el) {
  if (!$el || !$el.length) return false;
  const el = $el[0];
  if (el.hidden) return false;

  const style = window.getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden") return false;
  if (parseFloat(style.opacity || "1") === 0) return false;

  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function saAnySALoginVisible() {
  let visible = false;
  $(".sa-auth").each(function () {
    const $el = $(this);
    // if ($el.is('[data-auth="status"]')) return; // ignore status element itself
    if (saIsVisible($el)) {
      visible = true;
      return false;
    }
  });
  return visible;
}

// [AUTH VISIBILITY HELPER] --------------------------------------------------
function saUpdateAuthVisibility(isSignedIn) {
  $('[data-auth="signed-in"]').each(function () {
    this.hidden = !isSignedIn;
  });
  $('[data-auth="signed-out"]').each(function () {
    this.hidden = !!isSignedIn;
  });

  const $root = $("#streamadmin");
  if ($root.length) {
    $root.toggleClass("is--signed-in", !!isSignedIn && !!SA.player);
  }
}

// =============================================================================
// Authentication
// =============================================================================

// [AUTH USER HELPERS] -------------------------------------------------------
function saGetDiscordId(user) {
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

// [WHITELIST HELPERS] -------------------------------------------------------
async function saEnsureWhitelistedUser() {
  if (!SA.user) return { ok: false, reason: "no-user" };

  const discordId = saGetDiscordId(SA.user);
  if (!discordId) {
    return { ok: false, reason: "no-discord-id" };
  }

  const { data, error } = await SA.supabase
    .from("players")
    .select("slug,pname,discord_id,auth_user_id")
    .eq("discord_id", discordId)
    .maybeSingle();

  if (error && error.code !== "PGRST116") {
    console.warn("[streamadmin] players lookup error:", error);
    return { ok: false, reason: "query-error", error };
  }

  if (!data) {
    return { ok: false, reason: "not-whitelisted" };
  }

  SA.player = data;

  if (!data.auth_user_id && SA.user?.id) {
    try {
      await SA.supabase
        .from("players")
        .update({ auth_user_id: SA.user.id })
        .eq("discord_id", discordId);
    } catch (e) {
      console.warn("[streamadmin] players.auth_user_id update warning:", e);
    }
  }

  return { ok: true, player: data };
}

// [PROFILE UI] --------------------------------------------------------------
async function saFillLoginProfile() {
  var $root = $('[sa-section="auth"]');
  if (!$root.length) return;

  var player = SA.player;
  var pname = player && player.pname ? player.pname : "";

  // HTML: <div data-auth="pname">Spieler</div>
  setTextIfExists($root.find('[data-auth="pname"]'), pname);

  var avatarUrl = "";

  if (player && typeof buildAssetUrl === "function") {
    try {
      // Einfaches Standardpreset für Admin-Seite
      avatarUrl = buildAssetUrl("players", player.slug, "p1-60");
    } catch (e) {
      console.warn("[streamadmin] avatar asset url error:", e);
    }
  }

  if (avatarUrl) {
    // HTML: <img data-auth="avatar-60" ...>
    setAttrIfExists($root.find('[data-auth="avatar-60"]'), "src", avatarUrl);
  }
}

// [AUTH LIFECYCLE] ----------------------------------------------------------
async function saAfterAuthChange() {
  console.log(
    "[streamadmin:afterAuth] ----------------------------------------"
  );
  console.log("[streamadmin:afterAuth] Entering saAfterAuthChange()");

  let hydratedFromHash = false;
  try {
    hydratedFromHash = await saHydrateSessionFromHash();
  } catch (e) {
    console.error("[streamadmin:afterAuth] saHydrateSessionFromHash threw:", e);
  }

  if (!hydratedFromHash) {
    console.log(
      "[streamadmin:afterAuth] No hash hydration, falling back to saReadSession()"
    );
    await saReadSession();
  } else {
    console.log(
      "[streamadmin:afterAuth] Session already hydrated from hash, skipping saReadSession()"
    );
  }

  console.log(
    "[streamadmin:afterAuth] Session/User after read:",
    SA.session,
    SA.user
  );
  let isSignedIn = !!SA.user;
  console.log("[streamadmin:afterAuth] isSignedIn =", isSignedIn);

  // Admin-Seite: KEIN tf_post_auth-Redirect benutzen
  // (Session wird über Supabase global geteilt)

  try {
    const url = new URL(window.location.href);
    if (url.searchParams.has("code") || url.searchParams.has("state")) {
      console.log(
        "[streamadmin:afterAuth] Removing code/state search params from URL"
      );
      window.history.replaceState({}, "", saCleanPath());
    }
  } catch (e) {
    console.warn("[streamadmin:afterAuth] URL cleanup error:", e);
  }

  SA.player = null;

  if (isSignedIn) {
    console.log("[streamadmin:afterAuth] Signed in – checking whitelist …");
    saStatus("Checking permission …", "info");

    const res = await saEnsureWhitelistedUser();
    console.log("[streamadmin:afterAuth] whitelist result:", res);

    if (!res.ok) {
      let reasonMsg =
        "Your Discord account is not allowed to access this page.";

      if (res.reason === "no-discord-id") {
        reasonMsg = "The Discord ID could not be read from your account.";
      } else if (res.reason === "query-error") {
        reasonMsg = "Permission check failed. Please try again later.";
      } else if (res.reason === "no-user") {
        reasonMsg = "You are not signed in.";
      }

      saStatus(reasonMsg, "error");

      try {
        await SA.supabase.auth.signOut();
      } catch (e) {
        console.warn("[streamadmin:afterAuth] signOut warning:", e);
      }

      isSignedIn = false;
    } else {
      console.log("[streamadmin:afterAuth] User is whitelisted");
      saStatus(null);
      await saFillLoginProfile();
    }
  } else {
    console.log("[streamadmin:afterAuth] Not signed in – clearing status");
    saStatus(null);
  }

  console.log("[streamadmin:afterAuth] Updating UI visibility");
  saUpdateAuthVisibility(isSignedIn);

  console.log(
    "[streamadmin:afterAuth] DONE ------------------------------------"
  );
}

// [AUTH UI WIRING] ----------------------------------------------------------
function saWireAuthUI() {
  console.log("[streamadmin:authUI] Wiring Login/Logout buttons…");

  $(document).on("click", '[data-auth-button="login"]', async function (e) {
    console.log("[streamadmin:authUI] Login button clicked");
    e.preventDefault();
    await saOnLoginDiscord();
  });

  $(document).on("click", '[data-auth-button="logout"]', async function (e) {
    console.log("[streamadmin:authUI] Logout button clicked");
    e.preventDefault();
    await saOnLogout();
  });

  console.log("[streamadmin:authUI] Wiring DONE");
}

// [AUTH ACTIONS] ------------------------------------------------------------
async function saOnLoginDiscord() {
  console.log("[streamadmin:login] saOnLoginDiscord() called");

  try {
    console.log(
      "[streamadmin:login] Saving tf_post_auth:",
      window.location.href
    );
    localStorage.setItem("tf_post_auth", window.location.href);

    const shortRedirect = saCleanPath();
    console.log("[streamadmin:login] Using redirectTo:", shortRedirect);

    const { error } = await SA.supabase.auth.signInWithOAuth({
      provider: "discord",
      options: { redirectTo: shortRedirect },
    });

    if (error) throw error;

    console.log("[streamadmin:login] OAuth request sent successfully");
  } catch (err) {
    console.error("[streamadmin:login] Discord login error:", err);
    saStatus("Login failed. Please try again.", "error");
  }
}

async function saOnLogout() {
  try {
    await SA.supabase.auth.signOut();
    SA.player = null;
    saStatus(null);
    await saAfterAuthChange();
  } catch (err) {
    console.error("[streamadmin] logout error:", err);
    saStatus("Logout failed. Please try again.", "error");
  }
}
