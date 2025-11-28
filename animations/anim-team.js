// RUN ON PAGE LOAD ----------------------------------------------------------
$(document).ready(function () {
  initHeroHalf();
});

// RUN ON WINDOW RESIZE ------------------------------------------------------
$(window).resize(debounce(function () {}, 250));

// RUN ON SCROLL -------------------------------------------------------------
$(window).scroll(debounce(function () {}, 100));

// Function to Handle GSAP Animations with ScrollTrigger and MatchMedia
function animateKartenStats() {
  // safety: register plugin
  if (typeof ScrollTrigger !== "undefined") {
    gsap.registerPlugin(ScrollTrigger);
  }

  // 1. Collect all m_games totals from DOM
  const totals = [];
  $(".kartenstat").each(function () {
    const rawVal = $(this).find('[data-base="m_games"]').text().trim();
    const numVal = parseInt(rawVal, 10);
    totals.push(Number.isFinite(numVal) ? numVal : 0);
  });

  // 2. Find maximum (avoid division by zero)
  let maxVal = Math.max(...totals, 0);
  if (maxVal <= 0) maxVal = 1;

  // 3. Compute percentages (scaled 10–100)
  const percentages = totals.map(function (val) {
    const ratio = val / maxVal; // 0 → 1
    const scaled = 10 + ratio * 90; // 10% minimum, 100% max
    return scaled;
  });

  // 4. GSAP MatchMedia breakpoints
  const mm = gsap.matchMedia();

  // Desktop ≥992px → animate HEIGHT
  mm.add("(min-width: 992px)", () => {
    $(".kartenstat").each(function (idx) {
      const $bar = $(this).find(".kartenstat_bar");
      const pct = percentages[idx] || 10;

      gsap.to($bar, {
        height: pct + "%",
        duration: 0.6,
        ease: "power1.inOut",
        scrollTrigger: {
          trigger: $bar,
          start: "bottom 90%",
          toggleActions: "play reverse play reverse",
        },
      });
    });
  });

  // Mobile <992px → animate WIDTH
  mm.add("(max-width: 991px)", () => {
    $(".kartenstat").each(function (idx) {
      const $bar = $(this).find(".kartenstat_bar");
      const pct = percentages[idx] || 10;

      gsap.to($bar, {
        width: pct + "%",
        duration: 0.6,
        ease: "power1.inOut",
        scrollTrigger: {
          trigger: $bar,
          start: "bottom 90%",
          toggleActions: "play reverse play reverse",
        },
      });
    });
  });
}
