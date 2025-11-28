// GLOBAL VARIABLES  ---------------------------------------------------------

// RUN ON PAGE LOAD ----------------------------------------------------------
$(document).ready(function () {
  initHeroHalf();
});

// RUN ON WINDOW RESIZE ------------------------------------------------------
$(window).resize(debounce(function () {}, 250));

// RUN ON SCROLL -------------------------------------------------------------
$(window).scroll(debounce(function () {}, 100));
