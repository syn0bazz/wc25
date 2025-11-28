/* File: script-newseditor.js
   Requires:
   - A global `supabaseClient` (from your loaded base.js)
   - An HTML container with id="newsEditor" (see your embed)
   - Optional: set a password via:
       1) data-password on #newsEditor  (e.g. <div id="newsEditor" data-password="mySecret">)
       2) or window.NEWS_EDITOR_PASSWORD = "mySecret";
   Notes:
   - Expects these elements in the HTML:
       #newsEditor
       #newsadmin_password       (type="password")
       #unlockBtn
       #authorSelect
       #newAuthorName
       #addAuthorBtn
       #newNewsText
       #addNewsBtn
       #newsList
*/

(function () {
  // -----------------------------
  // CONFIG & HELPERS
  // -----------------------------
  const qs = (sel, root = document) => root.querySelector(sel);
  const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const byId = (id) => document.getElementById(id);

  const editorRoot = byId("newsEditor");
  if (!editorRoot) {
    console.error("[NewsEditor] #newsEditor container not found.");
    return;
  }

  const FALLBACK_PASSWORD = "changeme"; // change in production
  const REQUIRED_PASSWORD =
    editorRoot.getAttribute("data-password") ||
    (typeof window.NEWS_EDITOR_PASSWORD !== "undefined"
      ? window.NEWS_EDITOR_PASSWORD
      : FALLBACK_PASSWORD);

  const els = {
    password: byId("newsadmin_password"),
    unlockBtn: byId("unlockBtn"),
    authorSelect: byId("authorSelect"),
    newAuthorName: byId("newAuthorName"),
    addAuthorBtn: byId("addAuthorBtn"),
    newNewsText: byId("newNewsText"),
    addNewsBtn: byId("addNewsBtn"),
    newsList: byId("newsList"),
  };

  // Basic guard for required elements
  const requiredIds = [
    "newsadmin_password",
    "unlockBtn",
    "authorSelect",
    "newAuthorName",
    "addAuthorBtn",
    "newNewsText",
    "addNewsBtn",
    "newsList",
  ];
  const missing = requiredIds.filter((id) => !byId(id));
  if (missing.length) {
    console.warn("[NewsEditor] Missing required elements:", missing.join(", "));
  }

  let UNLOCKED = false;

  function setLockedUI(isLocked) {
    UNLOCKED = !isLocked;
    editorRoot.classList.toggle("is-locked", isLocked);
    editorRoot.classList.toggle("is-unlocked", !isLocked);

    // Disable write controls if locked
    [els.addAuthorBtn, els.addNewsBtn].forEach((btn) => {
      if (btn) btn.disabled = isLocked;
    });
    // Also disable all per-item Save/Delete buttons
    qsa(".newsitem_action").forEach((btn) => {
      btn.disabled = isLocked;
    });
    // Allow viewing regardless of lock state
  }

  function checkPassword() {
    const entered = (els.password && els.password.value) || "";
    const ok = entered && entered === REQUIRED_PASSWORD;
    if (!ok) {
      alert("Wrong password.");
      setLockedUI(true);
      return false;
    }
    setLockedUI(false);
    return true;
  }

  // -----------------------------
  // SUPABASE HELPERS
  // -----------------------------
  async function waitForSupabase() {
    const maxWaitMs = 5000;
    const start = Date.now();
    while (!window.supabaseClient) {
      if (Date.now() - start > maxWaitMs) {
        throw new Error("supabaseClient not available (timeout).");
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    return window.supabaseClient;
  }

  async function fetchAuthors() {
    const sb = await waitForSupabase();
    const { data, error } = await sb.from("authors").select("*").order("name");
    if (error) {
      console.error("[NewsEditor] fetchAuthors error:", error);
      alert("Failed to load authors.");
      return [];
    }
    return data || [];
  }

  async function fetchNews() {
    const sb = await waitForSupabase();
    const { data, error } = await sb
      .from("news")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) {
      console.error("[NewsEditor] fetchNews error:", error);
      alert("Failed to load news.");
      return [];
    }
    return data || [];
  }

  async function insertAuthor(name) {
    const sb = await waitForSupabase();
    const payload = { name };
    const { data, error } = await sb.from("authors").insert(payload).select();
    if (error) {
      console.error("[NewsEditor] insertAuthor error:", error);
      throw error;
    }
    return data && data[0];
  }

  async function insertNews({ newstext, author }) {
    const sb = await waitForSupabase();
    const now = new Date().toISOString();
    const payload = {
      newstext,
      author, // expects authors.id
      created_at: now,
      edited_at: now,
    };
    const { data, error } = await sb.from("news").insert(payload).select();
    if (error) {
      console.error("[NewsEditor] insertNews error:", error);
      throw error;
    }
    return data && data[0];
  }

  async function updateNews(id, { newstext, author }) {
    const sb = await waitForSupabase();
    const now = new Date().toISOString();
    const payload = {
      newstext,
      author, // expects authors.id
      edited_at: now,
    };
    const { data, error } = await sb.from("news").update(payload).eq("id", id);
    if (error) {
      console.error("[NewsEditor] updateNews error:", error);
      throw error;
    }
    return data;
  }

  async function deleteNews(id) {
    const sb = await waitForSupabase();
    const { error } = await sb.from("news").delete().eq("id", id);
    if (error) {
      console.error("[NewsEditor] deleteNews error:", error);
      throw error;
    }
    return true;
  }

  // -----------------------------
  // RENDERING
  // -----------------------------
  let AUTHORS = [];
  let NEWS = [];

  function renderAuthorSelect(selectEl, selectedId) {
    if (!selectEl) return;
    selectEl.innerHTML = "";
    const optEmpty = document.createElement("option");
    optEmpty.value = "";
    optEmpty.textContent = "-- Select author --";
    selectEl.appendChild(optEmpty);

    AUTHORS.forEach((a) => {
      const opt = document.createElement("option");
      opt.value = a.name;
      if (String(a.name) === String(selectedId)) opt.selected = true;
      selectEl.appendChild(opt);
    });
  }

  function formatDate(iso) {
    if (!iso) return "—";
    try {
      const d = new Date(iso);
      return `${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;
    } catch {
      return iso;
    }
  }

  function renderNewsList() {
    if (!els.newsList) return;
    els.newsList.innerHTML = "";

    if (!Array.isArray(NEWS) || NEWS.length === 0) {
      const empty = document.createElement("div");
      empty.className = "newslist_empty";
      empty.textContent = "No news yet.";
      els.newsList.appendChild(empty);
      return;
    }

    NEWS.forEach((n) => {
      const item = document.createElement("div");
      item.className = "newsitem";
      item.dataset.id = n.id;

      // Header: timestamps
      const meta = document.createElement("div");
      meta.className = "newsitem_meta";
      meta.innerHTML = `
            <div><strong>Created:</strong> <span>${formatDate(
              n.created_at
            )}</span></div>
            <div><strong>Edited:</strong> <span class="newsitem_edited">${formatDate(
              n.edited_at
            )}</span></div>
          `;

      // Textarea
      const textWrap = document.createElement("div");
      textWrap.className = "newsitem_textwrap";
      const ta = document.createElement("textarea");
      ta.className = "newsitem_textarea";
      ta.value = n.newstext || "";
      textWrap.appendChild(ta);

      // Author select
      const authorWrap = document.createElement("div");
      authorWrap.className = "newsitem_authorwrap";
      const label = document.createElement("label");
      label.textContent = "Author";
      const sel = document.createElement("select");
      sel.className = "newsitem_authorselect";
      renderAuthorSelect(sel, n.author);
      authorWrap.appendChild(label);
      authorWrap.appendChild(sel);

      // Actions
      const actions = document.createElement("div");
      actions.className = "newsitem_actions";

      const saveBtn = document.createElement("button");
      saveBtn.className = "newsitem_action newsitem_save";
      saveBtn.textContent = "Save";
      saveBtn.disabled = !UNLOCKED;

      const delBtn = document.createElement("button");
      delBtn.className = "newsitem_action newsitem_delete";
      delBtn.textContent = "Delete";
      delBtn.disabled = !UNLOCKED;

      actions.appendChild(saveBtn);
      actions.appendChild(delBtn);

      item.appendChild(meta);
      item.appendChild(textWrap);
      item.appendChild(authorWrap);
      item.appendChild(actions);

      // Event handlers
      saveBtn.addEventListener("click", async () => {
        if (!UNLOCKED && !checkPassword()) return;
        saveBtn.disabled = true;
        saveBtn.textContent = "Saving…";
        try {
          const id = n.id;
          const newText = ta.value.trim();
          const authorName = sel.value || null; // text
          if (!newText) {
            alert("News text cannot be empty.");
            return;
          }
          await updateNews(id, { newstext: newText, author: authorName });
          // Update local state
          n.newstext = newText;
          n.author = authorId;
          n.edited_at = new Date().toISOString();
          item.querySelector(".newsitem_edited").textContent = formatDate(
            n.edited_at
          );
          alert("Saved.");
        } catch (err) {
          alert("Failed to save news item.");
        } finally {
          saveBtn.disabled = !UNLOCKED;
          saveBtn.textContent = "Save";
        }
      });

      delBtn.addEventListener("click", async () => {
        if (!UNLOCKED && !checkPassword()) return;
        if (!confirm("Delete this news item? This cannot be undone.")) return;
        delBtn.disabled = true;
        delBtn.textContent = "Deleting…";
        try {
          await deleteNews(n.id);
          // Remove from local state & DOM
          NEWS = NEWS.filter((x) => x.id !== n.id);
          item.remove();
          alert("Deleted.");
        } catch (err) {
          alert("Failed to delete.");
        } finally {
          delBtn.disabled = !UNLOCKED;
          delBtn.textContent = "Delete";
        }
      });

      els.newsList.appendChild(item);
    });
  }

  // -----------------------------
  // INIT & EVENTS
  // -----------------------------
  async function init() {
    setLockedUI(true);
    try {
      await waitForSupabase();
      AUTHORS = await fetchAuthors();
      renderAuthorSelect(els.authorSelect, "");
      NEWS = await fetchNews();
      renderNewsList();
    } catch (err) {
      console.error("[NewsEditor] init error:", err);
      alert("Failed to initialize News Editor.");
    }
  }

  // Unlock
  if (els.unlockBtn) {
    els.unlockBtn.addEventListener("click", () => {
      checkPassword();
      // Re-enable item buttons
      qsa(".newsitem_action").forEach((btn) => (btn.disabled = !UNLOCKED));
      // Top-level create buttons handled in setLockedUI already
    });
  }

  // Add Author
  if (els.addAuthorBtn) {
    els.addAuthorBtn.addEventListener("click", async () => {
      if (!UNLOCKED && !checkPassword()) return;
      const name = (els.newAuthorName && els.newAuthorName.value.trim()) || "";
      if (!name) {
        alert("Please enter an author name.");
        return;
      }
      els.addAuthorBtn.disabled = true;
      const prev = els.addAuthorBtn.textContent;
      els.addAuthorBtn.textContent = "Adding…";
      try {
        const newAuthor = await insertAuthor(name);
        // Refresh author list
        AUTHORS = await fetchAuthors();
        renderAuthorSelect(els.authorSelect, newAuthor?.id);
        // Also update all item selects
        qsa(".newsitem_authorselect").forEach((sel) =>
          renderAuthorSelect(sel, sel.value)
        );
        if (els.newAuthorName) els.newAuthorName.value = "";
        alert(`Author "${newAuthor?.name || name}" added.`);
      } catch (err) {
        alert("Failed to add author.");
      } finally {
        els.addAuthorBtn.disabled = !UNLOCKED;
        els.addAuthorBtn.textContent = prev || "Add author";
      }
    });
  }

  // Add News
  if (els.addNewsBtn) {
    els.addNewsBtn.addEventListener("click", async () => {
      if (!UNLOCKED && !checkPassword()) return;
      const text = (els.newNewsText && els.newNewsText.value.trim()) || "";
      const authorName = authorSelect.value || null;

      if (!text) {
        alert("Please write some news text.");
        return;
      }

      els.addNewsBtn.disabled = true;
      const prev = els.addNewsBtn.textContent;
      els.addNewsBtn.textContent = "Submitting…";

      try {
        const created = await insertNews({
          newstext: text,
          author: authorName,
        });
        // Prepend to local state & re-render
        NEWS.unshift(created);
        renderNewsList();
        if (els.newNewsText) els.newNewsText.value = "";
        alert("News added.");
      } catch (err) {
        alert("Failed to add news.");
      } finally {
        els.addNewsBtn.disabled = !UNLOCKED;
        els.addNewsBtn.textContent = prev || "Add news";
      }
    });
  }

  // Boot
  document.addEventListener("DOMContentLoaded", init);
})();
