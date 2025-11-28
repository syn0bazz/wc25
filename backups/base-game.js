// [PAGE ESSENTIALS]
// =============================================================================

// VARIABLES -------------------------------------------------------------------

// RUN ON PAGE LOAD ------------------------------------------------------------
$(document).ready(function () {
  getBaseGame();
});

// [SUPABASE INTEGRATION]
// =============================================================================

// FETCH DATA FROM SUPABASE WITH CACHING ---------------------------------------
function getBaseGame() {
  var idUrl = getidUrl();

  var localStorageKey = "gameData_" + idUrl;
  var cachedData = localStorage.getItem(localStorageKey);
  var cachedDataTimestamp = localStorage.getItem(
    localStorageKey + "_timestamp"
  );
  var now = new Date().getTime();

  if (cachedData && cachedDataTimestamp) {
    var cacheAge = now - cachedDataTimestamp;
    var cacheLifetime = 3 * 60 * 60 * 1000; // milliseconds
    if (cacheAge < cacheLifetime) {
      // Use cached data
      console.log("Using cached data for " + idUrl);
      var gameData = JSON.parse(cachedData);
      processGameData(gameData);
      return;
    }
  }

  // No cached data or cache expired, fetch from Supabase
  console.log("Fetching data from Supabase for " + idUrl);

  supabaseClient
    .from("spiele")
    .select("*")
    .eq("id_url", idUrl)
    .then(function (response) {
      console.log(response);
      if (response.error) {
        console.error("Error fetching data:", response.error);
      } else if (response.data.length === 0) {
        console.warn("No matching game found for URL ID:", idUrl);
      } else {
        var gameData = response.data[0]; // First matching result

        // Save to localStorage
        localStorage.setItem(localStorageKey, JSON.stringify(gameData));
        localStorage.setItem(localStorageKey + "_timestamp", now);

        processGameData(gameData);
      }
    });
}

// PROCESS AND INSERT DATA INTO PAGE -------------------------------------------
function processGameData(gameData) {
  insertGlobalGameData(gameData);
  highlightWinner(
    $(".gameh"),
    gameData.score_total_t1,
    gameData.score_total_t2
  );
  handleGameMaps(gameData);
  var overallWinner = determineOverallWinner(gameData);
  highlightMapWinner(gameData, overallWinner);
  insertVodLink(gameData.vod_link);
  highlightWinnerInStats(overallWinner);
  calculateStatbarWidths();
  animateStatbar();
  applyVoteClasses(gameData);
  setTeamAvatars(gameData);
  setVotingText(gameData);
}

// INSERT DATA INTO PAGE --------------------------------------------------------
function insertGlobalGameData(data) {
  // Elemente mit dem Attribut data-base suchen
  $("[data-game]").each(function () {
    var key = $(this).data("game"); // Holt den Wert von data-base
    if (data[key] !== undefined) {
      $(this).text(data[key]);
    } else {
      console.warn('Schlüssel "' + key + '" nicht in den Daten gefunden.');
    }
  });
}

// HANDLE MAPS LOGIC -----------------------------------------------------------
function handleGameMaps(gameData) {
  var mapPool = getMapPool(gameData); // Get array of map names in play

  var maps = $(".spielmap");

  maps.each(function (index, mapElement) {
    var mapName = $(mapElement).data("map-id"); // Use the data-map-id attribute

    var mapIndex = mapPool.indexOf(mapName);

    if (mapIndex === -1) {
      $(mapElement).remove(); // Remove irrelevant maps
    } else {
      $(mapElement).css("order", mapIndex + 1); // Apply correct order
      fillMapScores(mapElement, gameData, mapIndex + 1, mapName); // Fill scores
      insertMapWinner(mapElement, gameData, mapIndex + 1, mapName); // Highlight winner
    }
  });

  $(".spielmap_grid").removeClass("is--hidden"); // Reveal map grid
}

// DETERMINE MAP POOL ----------------------------------------------------------
function getMapPool(gameData) {
  var mapPool = [];

  if (gameData.id_url === "gf") {
    // Grand Finale with 5 maps
    mapPool.push(
      gameData.vote_1.toLowerCase().trim(),
      gameData.vote_2.toLowerCase().trim(),
      gameData.vote_5.toLowerCase().trim(),
      gameData.vote_6.toLowerCase().trim(),
      gameData.vote_7.toLowerCase().trim()
    );
  } else {
    // Regular game with 3 maps
    mapPool.push(
      gameData.vote_3.toLowerCase().trim(),
      gameData.vote_4.toLowerCase().trim(),
      gameData.vote_7.toLowerCase().trim()
    );
  }

  return mapPool;
}

// FILL MAP SCORES -------------------------------------------------------------
function fillMapScores(mapElement, gameData, mapNumber, mapName) {
  var scoreT1 = gameData["score_map" + mapNumber + "_t1"];
  var scoreT2 = gameData["score_map" + mapNumber + "_t2"];
  var halftimeScoreT1 = gameData["score_map" + mapNumber + "_ht_t1"];
  var halftimeScoreT2 = gameData["score_map" + mapNumber + "_ht_t2"];

  var capitalizedMapName = capitalizeFirstLetter(mapName);

  $(mapElement)
    .find("[data-game-calc='scoreEndT1" + capitalizedMapName + "']")
    .text(scoreT1);
  $(mapElement)
    .find("[data-game-calc='scoreEndT2" + capitalizedMapName + "']")
    .text(scoreT2);
  $(mapElement)
    .find("[data-game-calc='scoreHalftimeT1" + capitalizedMapName + "']")
    .text(halftimeScoreT1);
  $(mapElement)
    .find("[data-game-calc='scoreHalftimeT2" + capitalizedMapName + "']")
    .text(halftimeScoreT2);
}

// INSERT MAP WINNER TAG --------------------------------------------------------
function insertMapWinner(mapElement, gameData, mapNumber, mapName) {
  var scoreT1 = gameData["score_map" + mapNumber + "_t1"];
  var scoreT2 = gameData["score_map" + mapNumber + "_t2"];
  var winnerTeam =
    scoreT1 > scoreT2
      ? gameData.id_t1
      : scoreT1 < scoreT2
      ? gameData.id_t2
      : "Unentschieden"; // Handle draw

  $(mapElement)
    .find("[data-game-calc='mapWinner']")
    .text(winnerTeam.toUpperCase());
}

// DETERMINE OVERALL WINNER -----------------------------------------------------
function determineOverallWinner(gameData) {
  if (gameData.score_total_t1 > gameData.score_total_t2) {
    return gameData.id_t1;
  } else if (gameData.score_total_t1 < gameData.score_total_t2) {
    return gameData.id_t2;
  } else {
    return "Unentschieden";
  }
}

// HIGHLIGHT MAP WINNER --------------------------------------------------------
function highlightMapWinner(gameData, overallWinner) {
  $(".spielmap").each(function (index, mapElement) {
    var mapWinner = $(mapElement).find("[data-game-calc='mapWinner']").text();
    if (mapWinner === overallWinner.toUpperCase()) {
      $(mapElement).addClass("is--highlight");
    }
  });
}

// HIGHLIGHT WINNER IN STATS ----------------------------------------------------
function highlightWinnerInStats(overallWinner) {
  $("#stats .statrow[data-team-id='" + overallWinner + "']").addClass(
    "is--highlight"
  );
}

// INSERT VOD LINK INTO EMBED ---------------------------------------------------
function insertVodLink(vodLinkId) {
  var vodLink = "https://www.youtube-nocookie.com/embed/" + vodLinkId;
  var $iframe = $("#game-vod iframe");

  if ($iframe.length > 0) {
    $iframe.attr("src", vodLink); // Set the src attribute with the vod link
  } else {
    return;
  }
}

// APPLY VOTE CLASSES BASED ON gameData ----------------------------------------
function applyVoteClasses(gameData) {
  var voteMappings = {
    vote_1: gameData.vote_1,
    vote_2: gameData.vote_2,
    vote_3: gameData.vote_3,
    vote_4: gameData.vote_4,
    vote_5: gameData.vote_5,
    vote_6: gameData.vote_6,
    vote_7: gameData.vote_7,
  };

  // Define the vote order based on id_url
  var voteOrder;
  if (gameData.id_url === "gf") {
    voteOrder = ["down", "down", "up", "up", "up", "up", "up"];
  } else {
    voteOrder = ["down", "down", "up", "up", "down", "down", "up"];
  }

  $.each(voteMappings, function (voteKey, mapName) {
    // Find the .kartenwahl element with the matching data-map-id
    var mapElement = $("#mapvote .kartenwahl[data-map-id='" + mapName + "']");

    // Apply the corresponding vote class (e.g., .is--vote1)
    if (mapElement.length) {
      var voteClass = "is--" + voteKey;
      mapElement.addClass(voteClass);

      // Determine the index of the voteKey (e.g., vote_1 -> 0, vote_2 -> 1, etc.)
      var voteIndex = parseInt(voteKey.split("_")[1]) - 1;

      // Get the corresponding direction (up or down) from the voteOrder
      var directionClass = "is--" + voteOrder[voteIndex];
      mapElement.addClass(directionClass);
    }
  });
}

// SET TEAM AVATARS ------------------------------------------------------------
function setTeamAvatars(gameData) {
  var voteOrder = getVoteOrder(gameData.vote_start, gameData); // Pass gameData explicitly
  var avatarT1 = $('[data-mapvote-content="avatar_t1"]').first().clone();
  var avatarT2 = $('[data-mapvote-content="avatar_t2"]').first().clone();

  // Iteriere über die voteOrder anstatt über die DOM-Reihenfolge
  voteOrder.forEach(function (currentVoteTeam, index) {
    var mapName = gameData["vote_" + (index + 1)];
    var mapElement = $("#mapvote .kartenwahl[data-map-id='" + mapName + "']");

    var avatar = currentVoteTeam === "A" ? avatarT1 : avatarT2;
    // Replace the current avatar with the cloned team avatar
    mapElement.find(".kartenwahl_avatar").replaceWith(avatar.clone());
  });
}

// GET VOTING ORDER BASED ON STARTING TEAM -------------------------------------
function getVoteOrder(startingTeam, gameData) {
  var voteOrder;
  if (startingTeam === gameData.id_t1) {
    voteOrder = ["A", "B", "B", "A", "A", "B"];
  } else {
    voteOrder = ["B", "A", "A", "B", "B", "A"];
  }
  return voteOrder;
}

function setVotingText(gameData) {
  var voteOrder = getVoteOrder(gameData.vote_start, gameData); // Pass gameData explicitly

  // Iteriere über die voteOrder anstatt über die DOM-Reihenfolge
  voteOrder.forEach(function (currentVoteTeam, index) {
    var mapName = gameData["vote_" + (index + 1)];
    var mapElement = $("#mapvote .kartenwahl[data-map-id='" + mapName + "']");

    var teamName = currentVoteTeam === "A" ? gameData.id_t1 : gameData.id_t2;

    // Replace the text inside .kartenwahl_team
    mapElement.find(".kartenwahl_team").text("von " + teamName.toUpperCase());
  });
}

// HELPER FUNCTION TO CAPITALIZE FIRST LETTER -----------------------------------
function capitalizeFirstLetter(string) {
  return string.charAt(0).toUpperCase() + string.slice(1);
}
