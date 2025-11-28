// GLOBAL VARIABLES  ---------------------------------------------------------

// RUN ON PAGE LOAD ----------------------------------------------------------
$(document).ready(function () {
  setupTabs();
  toggleHelpOverlay();
  initSwiperSpielerstats();
});

// RUN ON WINDOW RESIZE ------------------------------------------------------
$(window).resize(debounce(function () {}, 250));

// RUN ON SCROLL -------------------------------------------------------------
$(window).scroll(debounce(function () {}, 100));

// TAB MENU LINKS ACTIVENESS  --------------------------------------------------
function setupTabs() {
  // Selektiere beide Instanzen von .tabs_menu
  $(".tabs_menu").each(function () {
    // Finde alle .tabs_link innerhalb des jeweiligen .tabs_menu
    var $tabsLinks = $(this).find(".tabs_link");

    // Füge einen Click-Event-Handler für jeden .tabs_link hinzu
    $tabsLinks.on("click", function () {
      // Wenn das geklickte Element nicht bereits .is--active hat
      if (!$(this).hasClass("is--active")) {
        // Entferne .is--active von allen .tabs_link innerhalb dieses .tabs_menu
        $tabsLinks.removeClass("is--active");
        // Füge .is--active dem geklickten Element hinzu
        $(this).addClass("is--active");
        // Verschiebe die Pille
        $(this).siblings(".tabs_pill-mover").toggleClass("is--switched");
      }
    });
  });
}

// =============================================================================
// SWIPER CONFIG
// =============================================================================

// SPIELERSTATS SLIDER ---------------------------------------------------------
function initSwiperSpielerstats() {
  var $statsElement = $("#tabelle-stats");

  // Check if the stats element and slides exist before initializing Swiper
  if ($statsElement.length && $("#tabelle-stats .swiper-slide").length) {
    var swiper = new Swiper("#tabelle-stats", {
      direction: "horizontal",
      loop: false,
      slidesPerView: 1,
      slidesPerGroup: 1,
      spaceBetween: 64,
      // Navigation
      navigation: {
        nextEl: "#stats-next",
        prevEl: "#stats-prev",
      },
      pagination: {
        el: "#stats-pagination",
        type: "bullets",
        clickable: true,
      },
    });
  } else {
    console.log(
      "No player stats found or no slides present; Swiper not initialized."
    );
  }
}
