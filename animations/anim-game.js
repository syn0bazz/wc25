// GLOBAL VARIABLES  ---------------------------------------------------------

// RUN ON PAGE LOAD ----------------------------------------------------------
$(document).ready(function () {
  // animateMapVote();
  initHeroGame();
});
// RUN ON WINDOW RESIZE ------------------------------------------------------
$(window).resize(debounce(function () {}, 250));

// RUN ON SCROLL -------------------------------------------------------------
$(window).scroll(debounce(function () {}, 100));

function animateMapVote() {
  gsap.registerPlugin(ScrollTrigger);

  // Select all .kartenwahl elements inside #mapvote
  let kartenwahlElements = $("#mapvote .kartenwahl");

  // Create the animation
  gsap.to(kartenwahlElements, {
    y: function (index, target) {
      // Animate based on the is--up or is--down class
      return $(target).hasClass("is--up") ? "-30px" : "30px";
    },
    opacity: function (index, target) {
      // Animate based on the is--up or is--down class
      return $(target).hasClass("is--up") ? "1" : "0.67";
    },
    ease: "power1.inOut", // Ease for smooth animation
    delay: 0.5,
    stagger: {
      each: 0.09, // Stagger each element based on vote order
      from: "start", // Start stagger from vote_1 to vote_7
    },
    scrollTrigger: {
      trigger: "#mapvote",
      start: "top 67%", // Animation triggers when #mapvote is in view
      toggleActions: "play reverse play reverse",
    },
  });
}

// =============================================================================
// HERO ANIMATIONS
// =============================================================================

// --- FULL ---
// Scrolltrigger
function initHeroGame() {
  // --- FULL ---
  // Scrolltrigger
  let heroGameTl = gsap.timeline({
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

  // Hero Game Info
  heroGameTl.to(
    "#hero-gameinfo",
    {
      opacity: 0,
      scale: 0,
      ease: "none",
    },
    "<"
  );

  // --- Game Maps ---
  heroGameTl.to(
    "#mapgrid",
    {
      opacity: 0,
      scale: 4,
    },
    "<"
  );

  // --- Hero Game ---
  heroGameTl.to(
    "#hero-game",
    {
      opacity: 0,
      scale: 4,
    },
    "<"
  );

  // --- Section Darkener ---
  heroGameTl.to(
    "#section-darkener",
    {
      opacity: 0,
      backdropFilter: "blur(0px)",
    },
    "<+0.075"
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
    "#hero-image",
    {
      opacity: 0.8,
    },
    "<"
  );
}
