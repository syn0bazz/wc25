/* ======= CONFIG ======= */
const BASE = "https://glatte.info/gg/stream/videos/";

// base playlist (full)
const BASE_PLAYLIST = [
  { file: "wartevideo_01.mp4", credit: "The_Questing_Beast in Freiberg" },
  { file: "wartevideo_02.mp4", credit: "Const Cash in den USA" },
  { file: "wartevideo_03.mp4", credit: "Const Cash in den USA" },
  {
    file: "wartevideo_04.mp4",
    credit: "miravalentina (und Kaya) nähe München",
  },
  {
    file: "wartevideo_05.mp4",
    credit: "miravalentina (und Kaya) nähe München",
  },
  { file: "wartevideo_06.mp4", credit: "Const Cash in den USA" },
  { file: "wartevideo_07.mp4", credit: "mofa in Halle" },
  { file: "wartevideo_08.mp4", credit: "KiFFe auf Nyx" },
  {
    file: "wartevideo_09.mp4",
    credit: "syno & Const Cash (mit Nuka) in Berlin",
  },
  { file: "wartevideo_10.mp4", credit: "Highlights vom Wintercup '23" },
  { file: "wartevideo_11.mp4", credit: "Highlights vom Wintercup '24" },
  { file: "wartevideo_12.mp4", credit: "KiFFe auf Utopia" },
  { file: "wartevideo_13.mp4", credit: "PfaNnE und eρı¢ im Schwarzwald" },
];

const SHUFFLE = true;
const START_RANDOM = true;
const CROSSFADE_MS = 800;
const CREDIT_SWITCH_MS = 8000; // <- alle 8s wechseln

/* ======= HELPERS ======= */
const byId = (id) => document.getElementById(id);
const sourceUrl = (f) => `${BASE}${f}`;
const shuffle = (arr) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const pickStartIndex = (max) =>
  START_RANDOM ? Math.floor(Math.random() * max) : 0;

/**
 * Get last path segment as "page name"
 * e.g. https://wintercup.com/stream/highlights -> "highlights"
 * e.g. /stream/ -> "stream"
 */
function getPageSlug() {
  const path = window.location.pathname.replace(/\/+$/, ""); // trim trailing /
  const parts = path.split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1].toLowerCase() : "";
}

/**
 * Build playlist for current page.
 * If page is "highlights", only return videos 10 + 11.
 */
function getPlaylistForPage() {
  const slug = getPageSlug();
  if (slug === "highlights") {
    // strictly pick those two files
    return BASE_PLAYLIST.filter((item) =>
      ["wartevideo_10.mp4", "wartevideo_11.mp4"].includes(item.file)
    );
  }
  // default: full playlist
  return BASE_PLAYLIST.slice();
}

/**
 * Removes .credits_wrap from DOM (used for highlights page)
 */
function removeCreditsWrap() {
  const el = document.querySelector(".credits_wrap");
  if (el && el.parentNode) {
    el.parentNode.removeChild(el);
  }
}

/* ======= CREDITS ROTATION ======= */
function setupCreditRotation() {
  const music = byId("credits-music");
  const video = byId("credits-video");
  if (!music || !video) return;

  // Starte mit dem Element, das schon .is--active hat; sonst Video.
  let active = music.classList.contains("is--active")
    ? music
    : video.classList.contains("is--active")
    ? video
    : video;

  music.classList.toggle("is--active", active === music);
  video.classList.toggle("is--active", active === video);

  setInterval(() => {
    const next = active === music ? video : music;
    active.classList.remove("is--active");
    next.classList.add("is--active");
    active = next;
  }, CREDIT_SWITCH_MS);
}

/* ======= PLAYER (2-Video Crossfade + Preload) ======= */
class GgPlayer {
  constructor(root, playlistOverride = null) {
    this.root = root;
    this.videoA = root.querySelector("#vidA");
    this.videoB = root.querySelector("#vidB");
    this.vCreditEl = byId("vcreditText");

    // build playlist
    const pagePlaylist = playlistOverride || getPlaylistForPage();
    this.playlist = SHUFFLE ? shuffle(pagePlaylist) : pagePlaylist.slice();

    // fallback: if somehow empty, just don't init
    if (!this.playlist.length) {
      console.error("No videos available for this page.");
      return;
    }

    this.index = pickStartIndex(this.playlist.length);
    this.activeIsA = true;

    // Autoplay safety
    [this.videoA, this.videoB].forEach((v) => {
      v.muted = true;
      v.playsInline = true;
      v.setAttribute("playsinline", "");
      v.setAttribute("webkit-playsinline", "");
    });

    // End events
    this.videoA.addEventListener("ended", () => this.next());
    this.videoB.addEventListener("ended", () => this.next());

    // Initial load:
    // If src already present in HTML, keep it for vidA as first, else load from playlist.
    const firstItem = this.playlist[this.index];
    const hasPresetA = !!this.videoA.getAttribute("src");
    const hasPresetB = !!this.videoB.getAttribute("src");

    Promise.resolve()
      .then(() =>
        hasPresetA ? Promise.resolve() : this.loadInto(this.videoA, firstItem)
      )
      .then(() => this.videoA.play())
      .then(() => this.updateVideoCredit(firstItem))
      .then(() => {
        // If B has preset, leave it; else preload next
        if (!hasPresetB) return this.preloadNext();
      })
      .catch((e) => {
        console.error("Init error:", e);
        this.next();
      });
  }

  updateVideoCredit(item) {
    if (!this.vCreditEl) return;
    this.vCreditEl.textContent = item?.credit ?? "";
  }

  get nextIndex() {
    return (this.index + 1) % this.playlist.length;
  }

  loadInto(videoEl, item) {
    return new Promise((resolve, reject) => {
      const url = sourceUrl(item.file);
      videoEl.oncanplay = null;
      videoEl.onerror = null;

      videoEl.src = url;
      videoEl.load();

      videoEl.oncanplay = () => {
        videoEl.oncanplay = null;
        resolve();
      };
      videoEl.onerror = () => {
        videoEl.oncanplay = null;
        reject(new Error(`Failed to load ${url}`));
      };
    });
  }

  async preloadNext() {
    const item = this.playlist[this.nextIndex];
    const target = this.activeIsA ? this.videoB : this.videoA;
    await this.loadInto(target, item);
  }

  async next() {
    const current = this.activeIsA ? this.videoA : this.videoB;
    const incoming = this.activeIsA ? this.videoB : this.videoA;

    this.index = this.nextIndex;
    const item = this.playlist[this.index];

    try {
      if (!incoming.src || incoming.readyState < 2) {
        await this.loadInto(incoming, item);
      }

      try {
        incoming.currentTime = 0;
      } catch (_) {}
      await incoming.play();

      // Crossfade
      incoming.style.transition = `opacity ${CROSSFADE_MS}ms`;
      current.style.transition = `opacity ${CROSSFADE_MS}ms`;
      incoming.style.opacity = "1";
      current.style.opacity = "0";

      setTimeout(() => {
        current.pause();
        try {
          current.currentTime = 0;
        } catch (_) {}
      }, CROSSFADE_MS + 50);

      this.activeIsA = !this.activeIsA;
      this.updateVideoCredit(item);
      this.preloadNext();
    } catch (e) {
      console.error("Switch error:", e);
      this.index = this.nextIndex;
      this.preloadNext();
    }
  }
}

/* ======= BOOT ======= */
(function boot() {
  const ready = (fn) =>
    document.readyState === "loading"
      ? document.addEventListener("DOMContentLoaded", fn)
      : fn();

  ready(() => {
    const root = document.getElementById("gg-player");
    if (!root) return console.error("gg-player container not found.");

    const slug = getPageSlug();
    const isHighlights = slug === "highlights";

    // in highlights mode: remove credits box completely
    if (isHighlights) {
      removeCreditsWrap();
    }

    // init player (playlist is chosen internally via getPlaylistForPage)
    new GgPlayer(root);

    // only run credits rotation if credits are actually on the page
    if (!isHighlights) {
      setupCreditRotation(); // <- start the 8s crossfade for music/video credits
    }
  });
})();
