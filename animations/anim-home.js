// GLOBAL VARIABLES  ---------------------------------------------------------

// RUN ON PAGE LOAD ----------------------------------------------------------
$(document).ready(function () {
  initHeroHome();
});

// RUN ON WINDOW RESIZE ------------------------------------------------------
$(window).resize(debounce(function () {}, 250));

// RUN ON SCROLL -------------------------------------------------------------
$(window).scroll(debounce(function () {}, 100));

// =============================================================================
// HERO ANIMATIONS
// =============================================================================

// --- FULL ---
// Scrolltrigger
function initHeroHome() {
  // --- FULL ---
  // Scrolltrigger
  let heroFullTl = gsap.timeline({
    scrollTrigger: {
      trigger: "#hero",
      scrub: false,
      start: "10% top",
      end: "bottom center",
      toggleActions: "play none none reverse",
      markers: false,
    },
    defaults: {
      duration: 0.6, // Globale Dauer für alle Animationen
      ease: "power3.inOut", // Globales Ease
    },
  });

  // Hero Logo
  heroFullTl.to(
    ".heroswiper_emblem",
    {
      opacity: 0,
      scale: 0,
    },
    "<"
  );
  // Hero Logo
  heroFullTl.to(
    ".newsticker",
    {
      opacity: 0,
      y: 100,
      scale: 4,
    },
    "<"
  );
  /*
  // Hero Nav Logo
  gsap.set("#nav-logo", { opacity: 0, scale: 4 });
  heroFullTl.to(
    "#nav-logo",
    {
      opacity: 1,
      scale: 1,
      ease: "none",
    },
    "<"
  );
  */

  // --- Section Darkener ---
  heroFullTl.to(
    "#section-darkener",
    {
      opacity: 0,
      backdropFilter: "blur(0px)",
    },
    "<"
  );

  // Scrolltrigger
  let heroFadeOutTl = gsap.timeline({
    scrollTrigger: {
      trigger: "#hero",
      scrub: true,
      start: "top top",
      end: "bottom center",
      toggleActions: "play none none reverse",
      markers: false,
    },
    defaults: {
      ease: "power3.inOut", // Globales Ease
    },
  });

  // --- Hero Image ---
  heroFadeOutTl.to(
    ".heroswiper",
    {
      opacity: 0.8,
    },
    "<"
  );
}
