// [PAGE ESSENTIALS]
// =============================================================================

// VARIABLES -------------------------------------------------------------------
const MAX_GROUP_SIZE = 5;

// RUN ON PAGE LOAD ------------------------------------------------------------
$(document).ready(function () {
  prepareResultsPage();
});

// [PAGE WIDE FUNCTIONS]
// =============================================================================

// TIMING WRAPPER FUNCTION -----------------------------------------------------
function prepareResultsPage() {
  fetchResults()
    .then(function () {
      prepareGroups();
      getSpielScores();
      preparePlayerStats();
    })
    .catch(function (error) {
      console.error("Error in prepareResultsPage:", error);
    });
}
// FETCH RESULTS FROM SUPABASE -------------------------------------------------
function fetchResults() {
  return new Promise(function (resolve, reject) {
    // Collect all team IDs
    var teamIds = [];

    $("#tabelle-alpha .statrow, #tabelle-beta .statrow").each(function () {
      var teamId = $(this).attr("data-team-id");
      teamIds.push(teamId);
    });

    if (teamIds.length === 0) {
      console.warn("No teams found.");
      resolve();
      return;
    }

    console.log("Fetching team data for IDs: " + teamIds.join(", "));

    fetchDataForIdsWithCache({
      ids: teamIds,
      storageKeyPrefix: "teamData_",
      fetchFunction: function (idsToFetch) {
        return supabaseClient
          .from("teams")
          .select("*")
          .in("id_url", idsToFetch)
          .then(function (response) {
            if (response.error) {
              console.error("Error fetching team data:", response.error);
              throw response.error;
            }
            return response.data;
          });
      },
      processDataFunction: function (allTeamData) {
        insertDataIntoTeamElements(allTeamData);
        calculateStatbarWidths();
        animateStatbar();
        resolve();
      },
    }).catch(function (error) {
      reject(error);
    });
  });
}

// UTILITY: DATA INSERTION -----------------------------------------------------
function insertDataIntoTeamElements(teamData) {
  // Loop over the team data and dynamically set the corresponding values
  teamData.forEach(function (teamDataItem) {
    var teamElement = $("[data-team-id='" + teamDataItem.id_url + "']");

    // Find all child elements with the attribute "data-team"
    teamElement.find("[data-team]").each(function () {
      var dataKey = $(this).attr("data-team"); // Get the value of the data-team attribute

      // Match the dataKey with the corresponding entry in teamData
      if (teamDataItem.hasOwnProperty(dataKey)) {
        $(this).text(teamDataItem[dataKey]); // Replace the content with the matching teamData value
      }
    });
  });
}

// UTILITY: SORTING FUNCTION -----------------------------------------------------
function sortTables(wrapper, criteria) {
  // Get all .statrow elements inside the provided wrapper
  var statRows = wrapper.find(".statrow");

  // Create an array of objects containing the element and its criteria values
  var statRowData = statRows
    .map(function () {
      var row = $(this);
      var data = {
        element: row,
        criteriaValues: [],
      };

      // Get the criteria values for this row
      for (var i = 0; i < criteria.length; i++) {
        var criterium = criteria[i].criterium;
        var value =
          parseFloat(row.find('[data-team="' + criterium + '"]').text()) || 0;
        data.criteriaValues.push(value);
      }

      return data;
    })
    .get(); // Convert the jQuery object into a plain array

  // Sort the statRowData based on the criteria
  statRowData.sort(function (a, b) {
    for (var i = 0; i < criteria.length; i++) {
      var order = criteria[i].order || "desc";
      var aValue = a.criteriaValues[i];
      var bValue = b.criteriaValues[i];

      if (aValue !== bValue) {
        return order === "asc" ? aValue - bValue : bValue - aValue;
      }
    }
    return 0; // All criteria are equal
  });

  // Apply the new order using the flex order property
  for (var i = 0; i < statRowData.length; i++) {
    statRowData[i].element.css("order", i + 1); // Set the flex order starting from 1
  }

  console.log("Table sorted by:", criteria);

  // Return the sorted data for further processing
  return statRowData;
}

// UTILITY: RENUMBERING PLACEMENTS ------------------------------------------------
function renumberPlacements(sortedData) {
  let rank = 1;
  let tiedRank = rank;
  let previousCriteriaValues = null;

  sortedData.forEach((playerData) => {
    const { element, criteriaValues } = playerData;

    const isTie = previousCriteriaValues
      ? criteriaValues.every(
          (value, index) => value === previousCriteriaValues[index]
        )
      : false;

    if (!isTie) {
      tiedRank = rank;
    }

    element.find(".statrow_placement div").text(`${tiedRank}.`);
    previousCriteriaValues = criteriaValues;
    rank++;
  });
}

// UTILITY: HIGHLIGHTING A DEFINED NUMBER OF ROWS --------------------------------
function highlightTables(sortedData, highlightCount) {
  for (var i = 0; i < sortedData.length; i++) {
    var data = sortedData[i];
    var element = data.element;
    var placementText = element.find(".statrow_placement div").text();

    // Remove the dot at the end and convert to number
    var placementNumber = parseInt(placementText);

    // Check if placementNumber is within the range of highlightCount
    if (placementNumber > 0 && placementNumber <= highlightCount) {
      element.addClass("is--highlight");
    } else {
      element.removeClass("is--highlight");
    }
  }

  console.log(`Highlighted top ${highlightCount} rows`);
}

// [PREPARE GROUPS]
// =============================================================================
// WRAPPER FUNCTION FOR GROUPS -------------------------------------------------
function prepareGroups() {
  // Sort both tables after fetching the data
  var sortedDataAlpha = sortTables($("#tabelle-alpha"), [
    { criterium: "team_wins", order: "desc" },
    { criterium: "team_losses", order: "asc" },
    { criterium: "team_runden", order: "desc" },
  ]);
  var sortedDataBeta = sortTables($("#tabelle-beta"), [
    { criterium: "team_wins", order: "desc" },
    { criterium: "team_losses", order: "asc" },
    { criterium: "team_runden", order: "desc" },
  ]);

  // Renumber the rows for both tables
  renumberPlacements(sortedDataAlpha);
  renumberPlacements(sortedDataBeta);

  // Highlight top 1st and 2nd place in both tables
  highlightTables(sortedDataAlpha, 2);
  highlightTables(sortedDataBeta, 2);
}

// [PREPARE PLAYERSTATS]
// =============================================================================

// WRAPPER FUNCTION FOR PLAYERSTATS --------------------------------------------
function preparePlayerStats() {
  const statRows = collectAndSortStatRows();
  const sortedData = createSortedData(statRows);
  renumberPlacements(sortedData);
  highlightTables(sortedData, 3); // Assuming this function exists
  const groups = splitIntoGroups(sortedData, MAX_GROUP_SIZE);
  insertGroupsIntoTables(groups);
  $("#playerstats-content").remove();
}

// COLLECT AND SORT STATROWS FROM CMS CONTENT -----------------------------------
function collectAndSortStatRows() {
  const statRows = $("#playerstats-content .statrow").get();
  return statRows.sort((rowA, rowB) => {
    const scoreA = getHLTVScore(rowA);
    const scoreB = getHLTVScore(rowB);
    return scoreB - scoreA; // Sort in descending order
  });
}

// HELPER FUNCTION TO GET HLTV SCORE -------------------------------------------
function getHLTVScore(row) {
  const score =
    parseFloat($(row).find("[data-team='s1_hltv']").text()) ||
    parseFloat($(row).find("[data-team='s2_hltv']").text()) ||
    0;
  return score;
}

// CREATE SORTED DATA WITH CRITERIA VALUES ---------------------------------------
function createSortedData(statRows) {
  return statRows.map((row) => ({
    element: $(row),
    criteriaValues: [getHLTVScore(row)],
  }));
}

// SPLIT DATA INTO GROUPS --------------------------------------------------------
function splitIntoGroups(sortedData, groupSize) {
  const groups = [];
  for (let i = 0; i < sortedData.length; i += groupSize) {
    groups.push(sortedData.slice(i, i + groupSize));
  }
  return groups;
}

// INSERT DATA INTO DOM ----------------------------------------------------------
function insertGroupsIntoTables(groups) {
  const tableInserts = $("#playerstats-insert .tabelle_inner");

  groups.forEach((group, index) => {
    if (index < tableInserts.length) {
      const tableInner = tableInserts.eq(index);
      group.forEach((playerData, rowIndex) => {
        const { element } = playerData;
        tableInner.append(element);
        element.css("order", rowIndex + 1);
      });
    } else {
      console.warn("Not enough .tabelle_inner elements to insert all groups.");
    }
  });
}
