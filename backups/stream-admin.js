/* script-newseditor.js (SA-prefixed)
   Works with two separate embeds:
   - Embed 1 (#sa-authgame): Auth + Game selection
   - Embed 2 (#sa-news):     News (create + list combined)
   Requires: base.js sets window.supabaseClient (or dispatches "supabase:ready")
   Tables (expected):
     sa_authors:  id (bigint), created_at (timestamptz default now()), name (text), user_id (uuid unique)
     news:        id (bigint), created_at (timestamptz default now()), newstext (text),
                  author (bigint FK->authors.id), edited_at (timestamptz), "order" (smallint/bigint unique, NOT NULL)
     games:       id (bigint), name (text), slug (text), t1_slug (text FK->teams.slug), t2_slug (text FK->teams.slug),
                  datetime (timestamptz), active (boolean)
     teams:       slug (text PK), tname (text), tag (text)
*/

(function () {
  // ---------------------------
  // Tiny helpers
  // ---------------------------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const setHidden = (el, hidden) => void (el && (el.hidden = !!hidden));
  const text = (el, v) => void (el && (el.textContent = v ?? ""));
  const formatDT = (iso) => {
    if (!iso) return "—";
    try {
      return new Date(iso).toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return iso;
    }
  };
  const statusMsg = (el, msg, type = "info") => {
    if (!el) return;
    el.dataset.state = type;
    el.textContent = msg || "";
  };
  function quickFlash(el, state = "ok") {
    if (!el) return;
    el.dataset.flash = state;
    setTimeout(() => (el.dataset.flash = ""), 900);
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Team logo path builder (per requirement)
  const TEAM_LOGO_BASE = "https://glatte.info/gg/wc25/assets/teams/";

  // Optional: override to resolve team logos
  // Provide window.SA_TEAM_LOGO = (team) => "https://.../logo.png"
  function resolveTeamLogo(team) {
    if (typeof window.SA_TEAM_LOGO === "function") {
      try {
        return window.SA_TEAM_LOGO(team) || "";
      } catch {}
    }
    // Required construction: slug_logo-150px_isolated.webp at TEAM_LOGO_BASE
    return team?.slug
      ? `${TEAM_LOGO_BASE}${team.slug}_logo-150px_flat.webp`
      : "";
  }

  // ---------------------------
  // Wait for Supabase client
  // ---------------------------
  function waitForSupabaseClient() {
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

  // ---------------------------
  // Global state
  // ---------------------------
  let supabase = null;
  let session = null;
  let user = null;
  let authorRow = null;

  // News state
  let itemsCache = [];
  let listLoadPromise = null;

  // Game state
  let gamesCache = [];
  let teamsCache = new Map(); // slug -> team row
  let activeGame = null;
  let suggestedGame = null;

  // ---------------------------
  // Boot
  // ---------------------------
  document.addEventListener("DOMContentLoaded", boot);

  async function boot() {
    try {
      supabase = await waitForSupabaseClient();
    } catch (e) {
      console.error("[news-editor] supabaseClient missing after wait:", e);
      // Show error in both embeds if present (German)
      statusMsg(
        $("[data-sa-auth-status]"),
        "Supabase-Client wurde nicht gefunden. Bitte prüfe base.js.",
        "error"
      );
      statusMsg(
        $("[data-sa-news-status]"),
        "Supabase-Client wurde nicht gefunden. Bitte prüfe base.js.",
        "error"
      );
      return;
    }

    try {
      supabase.auth.startAutoRefresh();
    } catch (_) {}

    await readSession();
    wireEmbedAuthGame();
    wireEmbedNews();

    // Keep session fresh & update UIs when user returns to tab
    document.addEventListener("visibilitychange", async () => {
      if (document.visibilityState === "visible") {
        try {
          supabase.auth.startAutoRefresh();
        } catch (_) {}
        await supabase.auth.getUser(); // ping
        const fres = await ensureAuthFresh();
        if (fres.ok) {
          await initGameSection(true);
          await refreshList(true);
        } else {
          await afterAuthChange();
        }
      } else {
        try {
          supabase.auth.stopAutoRefresh();
        } catch (_) {}
      }
    });

    // Auth listener
    supabase.auth.onAuthStateChange(async (event, _session) => {
      session = _session;
      if (["INITIAL_SESSION", "SIGNED_IN", "SIGNED_OUT"].includes(event)) {
        await afterAuthChange();
      }
      if (event === "TOKEN_REFRESHED") {
        session = _session;
        user = session?.user || null;
        if (user) authorRow = await ensureAuthorForUser(user);
      }
    });

    // Initial render
    await afterAuthChange();
  }

  // ---------------------------
  // Session/Auth helpers
  // ---------------------------
  async function readSession() {
    const { data, error } = await supabase.auth.getSession();
    if (error) console.warn("[news-editor] getSession error:", error);
    session = data?.session || null;
  }

  async function ensureAuthFresh() {
    const { data, error } = await supabase.auth.getSession();
    if (error) console.warn("[news-editor] getSession error:", error);
    session = data?.session || null;
    user = session?.user || null;
    if (!user) return { ok: false, reason: "no-user" };

    const exp = session?.expires_at || 0;
    const nowS = Math.floor(Date.now() / 1000);
    if (nowS >= exp - 30) {
      const { data: refData, error: refErr } =
        await supabase.auth.refreshSession();
      if (refErr) {
        console.warn("[news-editor] refreshSession error:", refErr);
        return { ok: false, reason: "refresh-failed" };
      }
      session = refData?.session || null;
      user = session?.user || null;
    }
    if (user) {
      authorRow = await ensureAuthorForUser(user);
    }
    return { ok: !!user };
  }

  async function withAuthRetry(fn) {
    let res = await fn();
    if (!res?.error) return res;
    const status = res.error?.status || res.status || 0;
    if (status !== 401) return res;
    const ok = (await ensureAuthFresh()).ok;
    if (!ok) return res;
    res = await fn();
    return res;
  }

  // ---------------------------
  // Shared: create/find author row for user
  // ---------------------------
  function discordDisplayName(u) {
    return (
      u?.user_metadata?.full_name ||
      u?.user_metadata?.name ||
      (u?.email ? u.email.split("@")[0] : null) ||
      "Discord-Nutzer"
    );
  }

  async function ensureAuthorForUser(user) {
    const desiredName = discordDisplayName(user);
    const { data: existing } = await supabase
      .from("sa_authors")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!existing) {
      const { data: created, error: insErr } = await supabase
        .from("sa_authors")
        .insert([{ user_id: user.id, name: desiredName }])
        .select()
        .single();
      if (insErr) {
        console.error("[news-editor] authors insert error:", insErr);
        return { id: null, name: desiredName, user_id: user.id };
      }
      return created;
    }

    if (existing.name !== desiredName) {
      const { data: updated, error: updErr } = await supabase
        .from("sa_authors")
        .update({ name: desiredName })
        .eq("id", existing.id)
        .select()
        .single();
      if (updErr) {
        console.warn("[news-editor] authors update name warn:", updErr);
        return existing;
      }
      return updated;
    }
    return existing;
  }

  // ========================================================
  // EMBED 1 — AUTH + GAME
  // ========================================================
  function wireEmbedAuthGame() {
    const root = document.getElementById("sa-authgame");
    if (!root) return;

    // Elements
    const elAuthCard = $('[data-sa-section="auth"]', root);
    const btnLogin = $('[data-sa-btn="login-discord"]', root);
    const btnLogout = $('[data-sa-btn="logout"]', root);
    const elAuthStatus = $("[data-sa-auth-status]", root);
    const elSignedIn = $('[data-sa-auth="signed-in"]', root);
    const elSignedOut = $('[data-sa-auth="signed-out"]', root);
    const elUserInitials = $("[data-sa-user-initials]", root);
    const elUserEmail = $("[data-sa-user-email]", root);
    const elUserId = $("[data-sa-user-id]", root);

    // Game section
    const elGameCard = $('[data-sa-section="game"]', root);
    const elGameStatus = $("[data-sa-game-status]", root);
    const elGameSelect = $("[data-sa-game-select]", root);
    const elGName = $('[data-sa-game="name"]', root);
    const elGDT = $('[data-sa-game="datetime"]', root);
    const elT1Logo = $('[data-sa-team="t1-logo"]', root);
    const elT2Logo = $('[data-sa-team="t2-logo"]', root);
    const elT1Name = $('[data-sa-team="t1-name"]', root);
    const elT2Name = $('[data-sa-team="t2-name"]', root);
    const elT1Tag = $('[data-sa-team="t1-tag"]', root);
    const elT2Tag = $('[data-sa-team="t2-tag"]', root);

    // Wire events
    btnLogin?.addEventListener("click", onLoginDiscord);
    btnLogout?.addEventListener("click", onLogout);
    elGameSelect?.addEventListener("change", onSelectGameChange);

    // Expose to inner functions via closure
    async function afterAuthChangeEmbed() {
      user = session?.user || null;

      // Global visibility toggle for any element with data-sa-auth
      updateAuthVisibility(!!user);

      if (!user) {
        setHidden(elSignedOut, false);
        setHidden(elSignedIn, true);
        setHidden(elGameCard, true);
        statusMsg(elAuthStatus, "Melde dich bitte mit Discord an.");
        authorRow = null;
        return;
      }

      setHidden(elSignedOut, true);
      setHidden(elSignedIn, false);
      text(
        elUserEmail,
        user.email || user.user_metadata?.name || "Discord-Nutzer"
      );
      text(elUserId, user.id || "—");
      text(elUserInitials, initialsFrom(user));
      statusMsg(elAuthStatus, "Angemeldet.", "ok");

      authorRow = await ensureAuthorForUser(user);
      setHidden(elGameCard, false);
      await initGameSection(true);
    }

    // Hook global afterAuthChange to call this embed’s partial
    embedAuthGame_afterAuthChange = afterAuthChangeEmbed;

    // -------- AUTH handlers
    async function onLoginDiscord() {
      try {
        localStorage.setItem("sa_post_auth", window.location.href);
        const cleanPath = window.location.pathname.split("?")[0];
        const shortRedirect = `${window.location.origin}${cleanPath}`;
        const { error } = await supabase.auth.signInWithOAuth({
          provider: "discord",
          options: { redirectTo: shortRedirect },
        });
        if (error) throw error;
      } catch (err) {
        console.error("[news-editor] Discord login error:", err);
        statusMsg(
          elAuthStatus,
          "Das hat nicht geklappt. Probiere es nochmal.",
          "error"
        );
      }
    }

    async function onLogout() {
      try {
        await supabase.auth.signOut();
        await readSession();
        await afterAuthChange();
        statusMsg(elAuthStatus, "Abgemeldet.");
      } catch (err) {
        console.error("[news-editor] logout error:", err);
        statusMsg(
          elAuthStatus,
          "Du konntest NICHT abgemeldet werden.",
          "error"
        );
      }
    }

    function initialsFrom(u) {
      const n =
        u?.user_metadata?.full_name || u?.user_metadata?.name || u?.email || "";
      const m = String(n).match(/\b([A-Za-z])/g);
      return (m ? m.slice(0, 2).join("") : "?").toUpperCase();
    }

    // -------- GAME logic
    async function initGameSection(userInitiated = false) {
      try {
        statusMsg(elGameStatus, "Lade Spiele…");
        elGameSelect.disabled = true;

        // Load games (we need id, name, slug, t1_slug, t2_slug, datetime, active)
        const { data: games, error: gErr } = await supabase
          .from("games")
          .select("id,name,slug,t1_slug,t2_slug,datetime,active")
          .order("datetime", { ascending: true });
        if (gErr) throw gErr;

        gamesCache = games || [];

        // Determine active game
        activeGame = gamesCache.find((g) => g.active) || null;

        // Determine suggested game: closest by abs(time - now)
        const now = Date.now();
        suggestedGame =
          gamesCache
            .map((g) => ({
              g,
              d: Math.abs(new Date(g.datetime || 0).getTime() - now),
            }))
            .sort((a, b) => a.d - b.d)[0]?.g || null;

        // Load teams for displayed entries
        const slugsNeeded = new Set();
        for (const g of [activeGame, suggestedGame, ...gamesCache]) {
          if (g?.t1_slug) slugsNeeded.add(g.t1_slug);
          if (g?.t2_slug) slugsNeeded.add(g.t2_slug);
        }
        if (slugsNeeded.size) {
          const { data: teams, error: tErr } = await supabase
            .from("teams")
            .select("slug,tname,tag")
            .in("slug", Array.from(slugsNeeded));
          if (tErr) throw tErr;
          teamsCache.clear();
          (teams || []).forEach((t) => teamsCache.set(t.slug, t));
        }

        // Render UI
        await renderActiveGameUI(activeGame);
        renderGameSelector(gamesCache, activeGame, suggestedGame);

        statusMsg(
          elGameStatus,
          suggestedGame ? "Aktives Spiel aus Datenbank geladen." : ""
        );
        elGameSelect.disabled = !gamesCache.length;

        if (userInitiated) quickFlash(elGameCard, "ok");
      } catch (e) {
        console.error("[news-editor] initGameSection error:", e);
        statusMsg(
          elGameStatus,
          "Spiele konnten nicht geladen werden.",
          "error"
        );
        setHidden(elGameCard, false);
      }
    }

    async function renderActiveGameUI(game) {
      if (!game) {
        text(elGName, "—");
        text(elGDT, "—");
        setTeamBlock(null, "t1");
        setTeamBlock(null, "t2");
        return;
      }
      text(elGName, game.name || "—");
      text(elGDT, formatDT(game.datetime));

      const t1 = game.t1_slug ? teamsCache.get(game.t1_slug) : null;
      const t2 = game.t2_slug ? teamsCache.get(game.t2_slug) : null;

      setTeamBlock(t1, "t1");
      setTeamBlock(t2, "t2");
    }

    function setTeamBlock(team, side /* "t1" | "t2" */) {
      const logoEl = side === "t1" ? elT1Logo : elT2Logo;
      const nameEl = side === "t1" ? elT1Name : elT2Name;
      const tagEl = side === "t1" ? elT1Tag : elT2Tag;
      if (!team) {
        if (logoEl) logoEl.src = "";
        text(nameEl, "—");
        text(tagEl, "—");
        return;
      }
      text(nameEl, team.tname || team.slug || "—");
      text(tagEl, team.tag || "");
      if (logoEl) {
        const src = resolveTeamLogo(team);
        if (src) {
          logoEl.src = src;
          logoEl.alt =
            (team.tag ? `[${team.tag}] ` : "") +
            (team.tname || team.slug || "Team");
          logoEl.onerror = () => {
            logoEl.style.display = "none";
          };
          logoEl.onload = () => {
            logoEl.style.display = "";
          };
        } else {
          logoEl.src = "";
          logoEl.style.display = "none";
        }
      }
    }

    function renderGameSelector(games, active, suggested) {
      elGameSelect.innerHTML = "";
      if (!games?.length) return;

      // Add SUGGESTED at the very top (selectable)
      if (suggested) {
        const t1s = suggested.t1_slug
          ? teamsCache.get(suggested.t1_slug)
          : null;
        const t2s = suggested.t2_slug
          ? teamsCache.get(suggested.t2_slug)
          : null;
        const labelS = `Vorschlag: ${suggested.name} · ${
          t1s?.tag || t1s?.slug || "?"
        } vs ${t2s?.tag || t2s?.slug || "?"}`;
        const optS = document.createElement("option");
        optS.value = String(suggested.id);
        optS.textContent = labelS;
        elGameSelect.appendChild(optS);
      }

      // Current active as a disabled label (keeps default selection on active)
      if (active) {
        const optActive = document.createElement("option");
        optActive.value = String(active.id);
        optActive.textContent = `Aktiv: ${active.name}`;
        optActive.disabled = true; // purely informational
        elGameSelect.appendChild(optActive);
      }

      // Separator
      const sep = document.createElement("option");
      sep.disabled = true;
      sep.textContent = "— Alle Spiele —";
      sep.value = "";
      elGameSelect.appendChild(sep);

      // IDs to skip in the "all games" section
      const suggestedId = suggested?.id ? String(suggested.id) : null;
      const activeId = active?.id ? String(active.id) : null;

      // Sort all remaining games:
      // 1) by group alphabetically
      // 2) then by slug alphabetically
      const sortedGames = [...games].sort((a, b) => {
        const aGroup = (a.group || "").toLowerCase();
        const bGroup = (b.group || "").toLowerCase();
        if (aGroup < bGroup) return -1;
        if (aGroup > bGroup) return 1;

        const aSlug = (a.slug || "").toLowerCase();
        const bSlug = (b.slug || "").toLowerCase();
        if (aSlug < bSlug) return -1;
        if (aSlug > bSlug) return 1;
        return 0;
      });

      // All games (avoid duplicating suggested / active)
      for (const g of sortedGames) {
        const gid = String(g.id);
        if (suggestedId && gid === suggestedId) continue;
        if (activeId && gid === activeId) continue;

        const t1 = g.t1_slug ? teamsCache.get(g.t1_slug) : null;
        const t2 = g.t2_slug ? teamsCache.get(g.t2_slug) : null;
        const label = `${g.name} · ${t1?.tag || t1?.slug || "?"} vs ${
          t2?.tag || t2?.slug || "?"
        }`;

        const opt = document.createElement("option");
        opt.value = gid;
        opt.textContent = label;
        elGameSelect.appendChild(opt);
      }

      // Default selection: keep current active if present; otherwise none
      if (active) elGameSelect.value = String(active.id);
    }

    async function onSelectGameChange(e) {
      const val = e?.target?.value;
      const id = val ? Number(val) : null;
      if (!id || !gamesCache.length) return;

      const chosen = gamesCache.find((g) => String(g.id) === String(id));
      if (!chosen) return;

      await setActiveGame(chosen.id);
    }

    async function setActiveGame(gameId) {
      const fres = await ensureAuthFresh();
      if (!fres.ok) {
        statusMsg(elGameStatus, "Du bist nicht angemeldet.", "error");
        return;
      }
      statusMsg(elGameStatus, "Wechsle aktives Spiel…");

      try {
        // Clear previous active (if any)
        const r1 = await withAuthRetry(() =>
          supabase.from("games").update({ active: false }).eq("active", true)
        );
        if (r1.error) throw r1.error;

        // Set selected one active
        const r2 = await withAuthRetry(() =>
          supabase.from("games").update({ active: true }).eq("id", gameId)
        );
        if (r2.error) throw r2.error;

        // Refresh local state
        await initGameSection(true);
        statusMsg(elGameStatus, "Aktives Spiel geändert.", "ok");
        quickFlash(elGameCard, "ok");
      } catch (e) {
        console.error("[news-editor] setActiveGame error:", e);
        statusMsg(
          elGameStatus,
          `Aktives Spiel konnte nicht gesetzt werden: ${
            e.message || e.code || e
          }`,
          "error"
        );
      }
    }
  }

  // Backup no-op to be called if embed not present
  let embedAuthGame_afterAuthChange = async () => {};

  // ========================================================
  // EMBED 2 — NEWS (Create + List combined)
  // ========================================================
  function wireEmbedNews() {
    const root = document.getElementById("sa-news");
    if (!root) return;

    // Elements
    const elNewsCard = $('[data-sa-section="news"]', root);
    const elNewsStatus = $("[data-sa-news-status]", root);
    const btnRefresh = $('[data-sa-btn="refresh"]', root);
    const inputNewstext = $("#sa-newstext", root);
    const btnCreateNews = $('[data-sa-btn="create-news"]', root);
    const elList = $("[data-sa-list]", root);
    const tplItem = $("#sa-item-template");

    // Wire events
    btnCreateNews?.addEventListener("click", onCreateNews);
    btnRefresh?.addEventListener("click", () => refreshList(true));

    // Expose partial updates
    embedNews_afterAuthChange = async () => {
      user = session?.user || null;
      updateAuthVisibility(!!user);
      if (!user) {
        setHidden(elNewsCard, true);
        statusMsg(elNewsStatus, "Du bist nicht angemeldet.");
        return;
      }
      setHidden(elNewsCard, false);
      statusMsg(elNewsStatus, "");
      await refreshList(true);
    };

    // ---- NEWS handlers
    async function onCreateNews() {
      const newstext = (inputNewstext.value || "").trim();
      if (!newstext) return;
      const fres = await ensureAuthFresh();
      if (!fres.ok || !authorRow?.id) {
        statusMsg(elNewsStatus, "Du bist nicht angemeldet.", "error");
        return;
      }
      const { data: maxRow, error: maxErr } = await withAuthRetry(() =>
        supabase
          .from("news")
          .select("order")
          .order("order", { ascending: false })
          .limit(1)
          .maybeSingle()
      );
      if (maxErr) {
        console.error("[news-editor] fetch max order error:", maxErr);
        statusMsg(
          elNewsStatus,
          "Nächste Reihenfolge konnte nicht ermittelt werden.",
          "error"
        );
        return;
      }
      const nextOrder = (maxRow?.order ?? 0) + 1;

      const { error: insErr } = await withAuthRetry(() =>
        supabase
          .from("news")
          .insert([{ newstext, author: authorRow.id, order: nextOrder }])
      );
      if (insErr) {
        console.error("[news-editor] insert news error:", insErr);
        statusMsg(
          elNewsStatus,
          `Konnte nicht veröffentlichen: ${
            insErr.message || insErr.code || "auth/RLS"
          }`,
          "error"
        );
        return;
      }
      inputNewstext.value = "";
      statusMsg(elNewsStatus, "Veröffentlicht!", "ok");
      await refreshList(true);
    }

    async function refreshList(fromUserAction = false) {
      if (listLoadPromise) {
        try {
          await listLoadPromise;
        } catch {}
        return;
      }
      listLoadPromise = (async () => {
        statusMsg(elNewsStatus, "Laden…");
        elList.innerHTML = "";

        const { data: items, error } = await supabase
          .from("news")
          .select("*")
          .order("order", { ascending: true });
        if (error) {
          console.error("[news-editor] load news error:", error);
          statusMsg(
            elNewsStatus,
            "Nachrichten konnten nicht geladen werden.",
            "error"
          );
          return;
        }

        const authorIds = [
          ...new Set(
            (items || []).map((i) => i.author).filter((v) => v != null)
          ),
        ];
        const authorMap = new Map();
        if (authorIds.length) {
          const { data: authors } = await supabase
            .from("sa_authors")
            .select("id,name")
            .in("id", authorIds);
          (authors || []).forEach((a) =>
            authorMap.set(String(a.id), a.name || "—")
          );
        }

        itemsCache = items || [];
        for (const it of itemsCache)
          elList.appendChild(renderItem(it, authorMap, tplItem));
        statusMsg(
          elNewsStatus,
          itemsCache.length ? "" : "Es gibt noch keine Nachrichten."
        );

        if (fromUserAction) quickFlash(elList, "ok");
      })();

      try {
        await listLoadPromise;
      } finally {
        listLoadPromise = null;
      }

      initNewsticker(false);
    }

    function renderItem(row, authorMap, tpl) {
      const li = tpl.content.firstElementChild.cloneNode(true);
      li.dataset.id = String(row.id);
      li.dataset.order = String(row.order);
      const ta = $('[data-sa-field="newstext"]', li);
      const createdAt = $('[data-sa-field="created_at"]', li);
      const createdBy = $('[data-sa-field="created_by"]', li);
      const editedAt = $('[data-sa-field="edited_at"]', li);
      const editedBy = $('[data-sa-field="edited_by"]', li);

      ta.value = row.newstext || "";
      text(createdAt, formatDT(row.created_at));
      const authorName =
        authorMap.get(String(row.author)) || row.created_by || "—";
      text(createdBy, authorName);
      text(editedAt, formatDT(row.edited_at));
      text(editedBy, row.edited_at ? authorName : "—");

      $('[data-sa-action="save"]', li)?.addEventListener("click", () =>
        onSaveItem(li, elNewsStatus, refreshList)
      );
      $('[data-sa-action="delete"]', li)?.addEventListener("click", () =>
        onDeleteItem(li, elNewsStatus, refreshList)
      );
      $('[data-sa-action="move-up"]', li)?.addEventListener("click", () =>
        onMove(li, -1, elNewsStatus, refreshList, elList)
      );
      $('[data-sa-action="move-down"]', li)?.addEventListener("click", () =>
        onMove(li, +1, elNewsStatus, refreshList, elList)
      );
      return li;
    }
  }

  // Backup no-op for embed not present
  let embedNews_afterAuthChange = async () => {};

  // ---------------------------
  // Shared news item ops
  // ---------------------------
  async function onSaveItem(li, statusEl, refreshListFn) {
    const id = li?.dataset?.id;
    if (!id) return;
    const ta = $('[data-sa-field="newstext"]', li);
    const textVal = (ta.value || "").trim();
    if (!textVal) return;
    const fres = await ensureAuthFresh();
    if (!fres.ok) {
      quickFlash(li, "error");
      statusMsg(statusEl, "Du bist nicht angemeldet.", "error");
      return;
    }
    const { error } = await withAuthRetry(() =>
      supabase
        .from("news")
        .update({ newstext: textVal, edited_at: new Date().toISOString() })
        .eq("id", id)
    );
    if (error) {
      console.error("[news-editor] save item error:", error);
      quickFlash(li, "error");
      statusMsg(
        statusEl,
        `Speichern fehlgeschlagen: ${error.message || error.code}`,
        "error"
      );
      return;
    }
    quickFlash(li, "ok");
    await refreshListFn(true);
  }

  async function onDeleteItem(li, statusEl, refreshListFn) {
    const id = li?.dataset?.id;
    if (!id) return;
    if (
      !confirm(
        "Diese Nachricht wirklich löschen? Das kann nicht rückgängig gemacht werden."
      )
    )
      return;
    const fres = await ensureAuthFresh();
    if (!fres.ok) {
      quickFlash(li, "error");
      statusMsg(statusEl, "Du bist nicht angemeldet.", "error");
      return;
    }
    const { error } = await withAuthRetry(() =>
      supabase.from("news").delete().eq("id", id)
    );
    if (error) {
      console.error("[news-editor] delete item error:", error);
      quickFlash(li, "error");
      statusMsg(
        statusEl,
        `Löschen fehlgeschlagen: ${error.message || error.code}`,
        "error"
      );
      return;
    }
    await refreshListFn(true);
  }

  async function onMove(li, delta, statusEl, refreshListFn, listEl) {
    const id = li?.dataset?.id;
    if (!id || !itemsCache?.length) return;
    const idx = itemsCache.findIndex((r) => String(r.id) === String(id));
    if (idx === -1) return;
    const neighborIdx = idx + delta;
    if (neighborIdx < 0 || neighborIdx >= itemsCache.length) {
      quickFlash(li, "info");
      return;
    }
    const fres = await ensureAuthFresh();
    if (!fres.ok) {
      quickFlash(li, "error");
      statusMsg(statusEl, "Du bist nicht angemeldet.", "error");
      return;
    }
    const me = itemsCache[idx];
    const nb = itemsCache[neighborIdx];

    // Optimistic DOM move
    if (delta < 0 && li.previousElementSibling) {
      listEl.insertBefore(li, li.previousElementSibling);
    } else if (delta > 0 && li.nextElementSibling) {
      listEl.insertBefore(li.nextElementSibling, li);
    }

    const meOld = me.order;
    const nbOld = nb.order;
    const TEMP = -32000;

    try {
      let r1 = await withAuthRetry(() =>
        supabase.from("news").update({ order: TEMP }).eq("id", me.id)
      );
      if (r1.error) throw r1.error;
      let r2 = await withAuthRetry(() =>
        supabase.from("news").update({ order: meOld }).eq("id", nb.id)
      );
      if (r2.error) throw r2.error;
      let r3 = await withAuthRetry(() =>
        supabase.from("news").update({ order: nbOld }).eq("id", me.id)
      );
      if (r3.error) throw r3.error;

      me.order = nbOld;
      nb.order = meOld;
      li.dataset.order = String(me.order);
      quickFlash(li, "ok");
    } catch (e) {
      console.error("[news-editor] swap order error:", e);
      quickFlash(li, "error");
      statusMsg(
        statusEl,
        `Reihenfolge ändern fehlgeschlagen: ${e.message || e.code || e}`,
        "error"
      );
    } finally {
      await refreshListFn(true);
    }
  }

  // ---------------------------
  // Auth visibility helper (global)
  // ---------------------------
  function updateAuthVisibility(isSignedIn) {
    $$('[data-sa-auth="signed-in"]').forEach((el) =>
      setHidden(el, !isSignedIn)
    );
    $$('[data-sa-auth="signed-out"]').forEach((el) =>
      setHidden(el, isSignedIn)
    );
  }

  // ---------------------------
  // Orchestrate both embeds after auth changes
  // ---------------------------
  async function afterAuthChange() {
    user = session?.user || null;

    // Post-auth redirect restore (from login)
    const saved = localStorage.getItem("sa_post_auth");
    if (saved && user) {
      localStorage.removeItem("sa_post_auth");
      if (saved !== window.location.href) {
        window.location.replace(saved);
        return;
      }
    }

    updateAuthVisibility(!!user);
    await embedAuthGame_afterAuthChange();
    await embedNews_afterAuthChange();
  }
})();
