// app.js
// -----------------------------------------------------------------------------
// SETUP / IDEA
// 1. Lege auf deinem Server (z.B. https://glatte.info/gg/stream/musik/) eine
//    Datei "playlist.php" an (siehe dein PHP aus dem Beispiel). Diese gibt ein
//    JSON-Array mit allen Audio-Dateien zurück, die im Ordner liegen.
// 2. Dieser JS kann jetzt zwei Modi:
//    - ?file=NAME.mp4  → spielt genau diese Datei ab (Video oder Audio)
//    - ?music (oder ?music=1) → lädt die Playlist aus /musik/playlist.php,
//      mischt sie (shuffle) und spielt sie endlos nacheinander ab.
// 3. Wichtig: Die playlist.php muss vom gleichen Origin aus erreichbar sein,
//    sonst brauchst du CORS-Header.
// -----------------------------------------------------------------------------

(function () {
  const BASE_URL = "https://glatte.info/gg/stream/";
  const MUSIC_PLAYLIST_URL = BASE_URL + "musik/playlist.php";
  const wrapper = document.getElementById("media-wrapper");

  // Parse URL params
  const params = new URLSearchParams(window.location.search);
  let file = params.get("file");
  const wantsMusic = params.has("music"); // ?music oder ?music=1

  // --- MODE 2: MUSIC PLAYLIST -------------------------------------------------
  if (wantsMusic) {
    // Wir bauen nur EIN <audio>, das die Quellen nacheinander abspielt.
    const audioEl = document.createElement("audio");
    audioEl.autoplay = true;
    audioEl.controls = true; // bei Musik meist gewünscht
    audioEl.playsInline = true;
    wrapper.appendChild(audioEl);

    // Hilfs-Variablen für Playlist
    let playlist = [];
    let currentIndex = 0;

    // Utility: Array shufflen (Fisher-Yates)
    function shuffleArray(arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    }

    // Nächsten Track setzen und abspielen
    function playCurrent() {
      if (!playlist.length) return;
      const src = playlist[currentIndex];
      audioEl.src = src;
      audioEl.play().catch((err) => {
        console.warn("Autoplay failed, user interaction needed:", err);
      });
    }

    // Wenn ein Track fertig ist → nächsten abspielen
    audioEl.addEventListener("ended", () => {
      if (!playlist.length) return;

      currentIndex++;
      if (currentIndex >= playlist.length) {
        // am Ende: wieder von vorne
        // optional: hier KANN man nochmal neu mischen, damit jedes Loop neu ist
        // playlist = shuffleArray(playlist);
        currentIndex = 0;
      }
      playCurrent();
    });

    // Playlist vom Server holen
    fetch(MUSIC_PLAYLIST_URL)
      .then((res) => res.json())
      .then((data) => {
        // data sollte ein Array aus absoluten URLs sein
        if (Array.isArray(data) && data.length) {
          playlist = shuffleArray(data.slice()); // Kopie + shuffle
          currentIndex = 0;
          playCurrent();
        } else {
          console.warn("Playlist leer oder im falschen Format:", data);
        }
      })
      .catch((err) => {
        console.error("Fehler beim Laden der Musik-Playlist:", err);
      });

    return; // wir sind im Musik-Modus, Rest abbrechen
  }

  // --- MODE 1: SINGLE FILE (wie bisher) --------------------------------------
  // handle ?file="replay.mp4"
  if (file && (file.startsWith('"') || file.startsWith("'"))) {
    file = file.replace(/^["']|["']$/g, "");
  }

  if (!file) {
    return; // nichts zu tun
  }

  const src = BASE_URL + file;
  const ext = file.split(".").pop().toLowerCase();

  let mediaEl;
  const isAudio = ext === "mp3";
  const isVideo = ext === "mp4" || ext === "mov";

  if (isAudio) {
    mediaEl = document.createElement("audio");
  } else if (isVideo) {
    mediaEl = document.createElement("video");
  } else {
    // unsupported, einfach nichts rendern
    return;
  }

  mediaEl.src = src;
  mediaEl.loop = true;
  mediaEl.autoplay = true;
  mediaEl.playsInline = true;

  // nur Videos muten (für Autoplay); Audio soll Ton haben
  if (isVideo) {
    mediaEl.muted = true;
  }

  // Audio → Controls anzeigen
  mediaEl.controls = isAudio;

  wrapper.appendChild(mediaEl);

  // sicherheitshalber play() versuchen
  mediaEl.play().catch((err) => {
    console.warn("Autoplay failed, user interaction needed:", err);
  });
})();
