// GLOBAL VARIABLES  ---------------------------------------------------------

// RUN ON PAGE LOAD ----------------------------------------------------------
$(document).ready(function () {
  animateSections();
});

// RUN ON WINDOW RESIZE ------------------------------------------------------
$(window).resize(debounce(function () {}, 250));

// RUN ON SCROLL -------------------------------------------------------------
$(window).scroll(debounce(function () {}, 100));

// =============================================================================
// HERO ANIMATIONS
// =============================================================================

function initHeroHalf() {
  // --- HALF ---
  // Scrolltrigger
  let heroHalfTl = gsap.timeline({
    scrollTrigger: {
      trigger: "#hero",
      scrub: false,
      start: "top top",
      end: "60% top",
      toggleActions: "play none none reverse",
      markers: false,
    },
    defaults: {
      duration: 0.6, // Globale Dauer für alle Animationen
      ease: "power3.inOut", // Globales Ease
    },
  });
  // --- Title ---
  heroHalfTl.to(
    "#hero-title",
    {
      opacity: 0,
      scale: 4,
      letterSpacing: 64,
    },
    "<"
  );
  // --- Team Avatar ---
  if ($("#team-avatar").length) {
    heroHalfTl.to(
      "#team-avatar",
      {
        opacity: 0,
        scale: 0,
      },
      "<"
    );
  }
  // --- Section Darkener ---
  heroHalfTl.to(
    "#section-darkener",
    {
      opacity: 0,
      backdropFilter: "blur(0px)",
    },
    "<"
  );
  // --- Hero Image ---
  heroHalfTl.to(
    ".hero_image",
    {
      opacity: 0.8,
    },
    "<"
  );
}

// =============================================================================
// SECTION ANIMATION
// =============================================================================

function animateSections() {
  gsap.utils.toArray(".section").forEach((section) => {
    gsap.fromTo(
      section,
      {
        opacity: 0,
        y: -40,
      },
      {
        opacity: 1,
        y: 0,
        ease: "power2.inOut",
        scrollTrigger: {
          trigger: section,
          start: "top 75%",
          toggleActions: "play none none reverse",
        },
        duration: 0.7,
        delay: 0.2,
      }
    );
  });
}

// =============================================================================
// STATBARS
// =============================================================================

function resetStatbars($scope) {
  // Force all masks in this scope back to 0 width immediately
  $scope.find("[data-anim-statbar='mask']").css("width", "0%");
}

function initStatbarAnimation($scope) {
  if (typeof ScrollTrigger !== "undefined") {
    gsap.registerPlugin(ScrollTrigger);
  }

  let $groups = $scope.find("[data-anim-statbar='group']");

  $groups.each(function () {
    let $group = $(this);
    let $masks = $group.find("[data-anim-statbar='mask']");

    gsap.to($masks, {
      scrollTrigger: {
        trigger: $group,
        start: "top 90%",
        end: "bottom top",
        toggleActions: "play reverse play reverse",
      },

      // Instead of reading a pre-set attribute blindly, we "heal" it if it's missing.
      width: function (index, target) {
        const $wrap = $(target).closest("[data-anim-statbar='wrap']");
        const $valueEl = $wrap.find("[data-anim-statbar='value']");

        // 1. Try to read declared target width
        let rawWidthAttr = $valueEl.attr("data-anim-statbar-width");
        let numericWidth = parseFloat(rawWidthAttr);

        // 2. If it's not there or not valid, derive it now
        if (isNaN(numericWidth)) {
          // read the displayed number, e.g. "93" or "5"
          let rawText = $valueEl.text().trim();
          let numVal = parseFloat(rawText);
          if (isNaN(numVal)) {
            numVal = 0;
          }

          // read type, e.g. "percentage" or "ten"
          const type = $valueEl.attr("data-anim-statbar-type"); // "percentage" | "ten"

          // compute final width in %
          if (type === "ten") {
            // 0–10 scale → 0–100%
            numericWidth = (numVal / 10) * 100;
          } else {
            // "percentage": interpret the number directly as %
            numericWidth = numVal;
          }

          // store it back so next time we don't have to recalc
          $valueEl.attr("data-anim-statbar-width", String(numericWidth));
        }

        // 3. Return correct CSS width string
        return numericWidth + "%";
      },

      duration: 0.6,
      stagger: 0.1,
      ease: "power1.inOut",
    });
  });
}

function animateStatbar() {
  const $scope = $(document);

  // reset all bars to 0 first for the "fill up" effect
  resetStatbars($scope);

  // create / refresh ScrollTriggers + gsap tweens
  initStatbarAnimation($scope);
}
