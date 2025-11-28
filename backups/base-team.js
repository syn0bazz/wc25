// [PAGE ESSENTIALS]
// =============================================================================

// VARIABLES -------------------------------------------------------------------
const MAX_GROUP_SIZE = 5;

// RUN ON PAGE LOAD ------------------------------------------------------------
$(document).ready(function () {
  getBaseTeam();
  getSpielScores();
  setTimeout(adjustSpieleHeight, 100);
});

// RUN ON WINDOW RESIZE ------------------------------------------------------
$(window).resize(
  debounce(function () {
    setTimeout(adjustSpieleHeight, 100);
  }, 250)
);

// [SUPABASE INTEGRATION]
// =============================================================================

// FETCH DATA FROM SUPABASE ----------------------------------------------------
function getBaseTeam() {
  var idUrl = getidUrl();

  console.log("Fetching data for team " + idUrl);

  fetchDataWithCache({
    storageKey: "teamData_" + idUrl,
    fetchFunction: function () {
      return supabaseClient
        .from("teams")
        .select("*")
        .eq("id_url", idUrl)
        .then(function (response) {
          if (response.error) {
            console.error("Error fetching team data:", response.error);
            throw response.error;
          } else if (response.data.length === 0) {
            console.warn("No matching team found for URL ID:", idUrl);
            return null;
          } else {
            return response.data[0];
          }
        });
    },
    processDataFunction: function (teamData) {
      if (teamData) {
        insertGlobalTeamData(teamData);
        var percentageArray = calculateKartenStatsHeights(teamData);
        sortKartenStats(teamData);
        animateKartenStats(percentageArray);
        calculateStatbarWidths(teamData);
        animateStatbar();
      }
    },
  });
}

// INSERT DATA INTO PAGE --------------------------------------------------------
function insertGlobalTeamData(data) {
  // Elemente mit dem Attribut data-base suchen
  $("[data-team]").each(function () {
    var key = $(this).data("team"); // Holt den Wert von data-base
    if (data[key] !== undefined) {
      $(this).text(data[key]);
    } else {
      console.warn('Schlüssel "' + key + '" nicht in den Daten gefunden.');
    }
  });
}

// [MAP STATS SECTION]
// =============================================================================

// CALCULATE HEIGHT AND ORDER ---------------------------------------------------
function calculateKartenStatsHeights(teamData) {
  // Collect game counts for each map
  var spieleArray = [
    teamData.m1_games,
    teamData.m2_games,
    teamData.m3_games,
    teamData.m4_games,
    teamData.m5_games,
    teamData.m6_games,
    teamData.m7_games,
  ];

  // Find the highest number of games played for any map
  var maxSpiele = Math.max(...spieleArray);

  // Calculate relative height for each map, where the most played map gets 100%
  var percentageArray = spieleArray.map(function (spiele) {
    var percentageSpiele = (spiele / maxSpiele) * 100;
    // Recalculate the percentage height (10% at min, 100% at max)
    var percentageHeight =
      percentageSpiele === 0 ? 10 : Math.max(percentageSpiele, 10);
    return percentageHeight;
  });

  return percentageArray;
}

// SORT MAP STAT ELEMENTS BY NUMBER OF GAMES ------------------------------------
function sortKartenStats(teamData) {
  // Create an array to hold the map stats with their corresponding map ID and game count (spiele)
  var mapStats = [
    { id: 1, spiele: teamData.m1_games },
    { id: 2, spiele: teamData.m2_games },
    { id: 3, spiele: teamData.m3_games },
    { id: 4, spiele: teamData.m4_games },
    { id: 5, spiele: teamData.m5_games },
    { id: 6, spiele: teamData.m6_games },
    { id: 7, spiele: teamData.m7_games },
  ];

  // Sort the mapStats array by the number of games (spiele) in descending order
  mapStats.sort(function (a, b) {
    return a.spiele - b.spiele;
  });

  // Loop through each .kartenstat element
  $(".kartenstat").each(function () {
    var $kartenstatElement = $(this);

    // Find the child .kartenstat_bar element with the data-base-mapid attribute
    var $kartenstatBar = $kartenstatElement.find(".kartenstat_bar");
    if ($kartenstatBar.length > 0) {
      // Get the map ID from the data-base-mapid attribute
      var mapId = parseInt($kartenstatBar.attr("data-base-mapid"), 10);

      // Find the corresponding map stat from the sorted mapStats array
      var mapStat = mapStats.find(function (stat) {
        return stat.id === mapId;
      });

      // If a match is found, update the CSS order property to sort the elements
      if (mapStat) {
        $kartenstatElement.css("order", mapStat.spiele);
      }
    }
  });
}
