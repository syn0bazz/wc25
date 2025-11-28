// =============================================================================
// [PAGE: TEAM GRID OVERVIEW]
// =============================================================================

// RUN ON PAGE LOAD ------------------------------------------------------------
$(document).ready(function () {
  if (window.supabaseClient) {
    initTeamsPage();
  } else {
    document.addEventListener("supabase:ready", initTeamsPage, { once: true });
  }
});

// =============================================================================
// CORE LOGIC
// =============================================================================

// Replace the whole initTeamsPage with this version
async function initTeamsPage() {
  try {
    // Uses the new preloaded + cached fetchers from base.js
    const [teams, players] = await Promise.all([fetchTeams(), fetchPlayers()]);

    const playersBySlug = indexBy(players, "slug");
    renderTeamGrids(teams, playersBySlug);
  } catch (err) {
    console.error("[initTeamsPage] Failed:", err);
  }
}

// =============================================================================
// RENDER
// =============================================================================

function renderTeamGrids(teams, playersBySlug) {
  if (!Array.isArray(teams) || !teams.length) {
    console.warn("[renderTeamGrids] No teams.");
    return;
  }

  // Group teams by group letter ("a", "b", etc.)
  var teamsByGroup = groupBy(teams, function (t) {
    return (t.group || "").toLowerCase();
  });

  // For each .teamgrid block in the DOM (group-a, group-b, ...)
  $(".teamgrid").each(function () {
    var $grid = $(this);

    // Example: data-base="group-a" or "group-b"
    var groupAttr = $grid.attr("data-base") || "";
    // Extract the letter after "group-"
    // "group-a" -> "a"
    var match = groupAttr.match(/^group-(.+)$/);
    if (!match) {
      console.warn(
        "[renderTeamGrids] ignoring .teamgrid without data-base='group-x'",
        groupAttr
      );
      return;
    }
    var groupLetter = (match[1] || "").toLowerCase();

    var listForGroup = teamsByGroup[groupLetter] || [];

    // Find the first <a class="team ...> card inside THIS grid as template
    // (the one with data-base="link-to-team")
    var $template = $grid.find("a.team[data-base='link-to-team']").first();
    if ($template.length === 0) {
      console.warn(
        "[renderTeamGrids] No template card found in group",
        groupLetter
      );
      return;
    }

    // We'll clone this template, so keep a reference *before* we wipe the grid.
    var $templateCloneRef = $template.clone(true, true);

    // Clear the grid so we can append clean clones
    $grid.empty();

    // Build a card for each team in this group
    listForGroup.forEach(function (team) {
      // Create "view model" for this team
      // (uses global helper from script.js)
      var vm = buildTeamViewModel(team, playersBySlug);

      // Fresh clone
      var $card = $templateCloneRef.clone(true, true);

      // -----------------------------------------------------------------
      // LINK TO TEAM PAGE
      // -----------------------------------------------------------------
      // The clickable root is <a data-base="link-to-team" ...>
      // We update its href with buildTeamUrl(slug)
      var teamHref = buildTeamUrl(vm.slug || "");
      $card.attr("href", teamHref || "#").attr("data-team-slug", vm.slug || "");

      // -----------------------------------------------------------------
      // PLAYER HEADSHOTS
      // -----------------------------------------------------------------
      // These are <img data-base="p1-150"> and <img data-base="p2-150">
      // Use PLAYER slugs, not team slug.
      var p1Slug = team.p1_slug || "";
      var p2Slug = team.p2_slug || "";

      var p1src = buildAssetUrl("players", team.p1_slug, "p1-150", team.slug);
      var p2src = buildAssetUrl("players", team.p2_slug, "p2-150", team.slug);

      $card
        .find("[data-base='p1-150']")
        .attr("src", p1src || "")
        .attr("alt", p1Slug || "");

      $card
        .find("[data-base='p2-150']")
        .attr("src", p2src || "")
        .attr("alt", p2Slug || "");

      // -----------------------------------------------------------------
      // TEAM LOGO (72-flat)
      // -----------------------------------------------------------------
      // <div data-base="logo-72-flat" class="team_avatar"></div>
      // We set it as background-image.
      var logo72 = vm.logo72 || "";
      $card
        .find("[data-base='logo-72-flat']")
        .css("background-image", logo72 ? 'url("' + logo72 + '")' : "none")
        .css("background-size", "cover")
        .css("background-position", "center center")
        .css("background-repeat", "no-repeat");

      // -----------------------------------------------------------------
      // TEAM NAME + TAG
      // -----------------------------------------------------------------
      // <div data-base="tname" class="team_name">Team</div>
      // <div data-base="tag" class="team_tag">...</div>
      $card.find("[data-base='tname']").text(vm.tname || "Team");
      $card.find("[data-base='tag']").text(vm.tag || "");

      // We are *not* currently writing vm.playerLine anywhere because
      // your provided HTML does not include data-base="lineup".
      // If you add e.g. <div data-base="lineup"></div>, you can do:
      // $card.find("[data-base='lineup']").text(vm.playerLine || "");

      // Append the finished card into this .teamgrid
      $grid.append($card);
    });
  });
}
