// RUN ON PAGE LOAD ----------------------------------------------------------
$(document).ready(function () {
  prepareResultsPage();
});

// == GET DATA FOR ERGEBNISSE ======================================================
function prepareResultsPage() {
  fetchResults()
    .then(function () {
      prepareGroups();
      getSpielScores();
      preparePlayerstats();
    })
    .catch(function (error) {
      console.error("Error in prepareResultsPage:", error);
    });
}

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
  renumberTables(sortedDataAlpha);
  renumberTables(sortedDataBeta);

  // Highlight top 1st and 2nd place in both tables
  highlightTables(sortedDataAlpha, 2);
  highlightTables(sortedDataBeta, 2);
}

// QUERY
function fetchResults() {
  return new Promise(function (resolve, reject) {
    // Collect all team IDs from the table #tabelle-alpha
    var teamIds = [];

    $("#tabelle-alpha .statrow, #tabelle-beta .statrow").each(function () {
      var teamId = $(this).attr("data-team-id");
      teamIds.push(teamId); // Add the ID to the array
    });

    if (teamIds.length === 0) {
      console.warn("No teams found.");
      resolve(); // Resolve even if no teams were found
      return;
    }

    console.log("Query started for Team IDs: " + teamIds.join(", "));

    // Query the Supabase "teams" table for all collected team IDs
    supabaseClient
      .from("teams")
      .select("*")
      .in("id_url", teamIds) // Use "in" to query multiple IDs
      .then(function (response) {
        console.log(response);

        if (response.error) {
          console.error("Error fetching team data:", response.error);
          reject(response.error); // Reject in case of error
        } else {
          // Insert the data into the page
          insertDataIntoTeamElements(response.data);
          resolve(); // Resolve once the data is set
        }
      });
  });
}

// Function to insert team data into the corresponding elements
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

function renumberTables(sortedData, globalRankCounter) {
  var tiedRank = globalRankCounter;
  var previousCriteriaValues = null;

  for (var i = 0; i < sortedData.length; i++) {
    var data = sortedData[i];
    var element = data.element;
    var criteriaValues = data.criteriaValues;

    // Check for ties
    var isTie = false;
    if (previousCriteriaValues) {
      isTie = criteriaValues.every(function (value, index) {
        return value === previousCriteriaValues[index];
      });
    }

    if (isTie) {
      // It's a tie, use the same rank
      element.find(".statrow_placement div").text(tiedRank + ".");
    } else {
      // Not a tie, assign new rank
      tiedRank = globalRankCounter;
      element.find(".statrow_placement div").text(globalRankCounter + ".");
    }

    globalRankCounter++; // Increment the global rank counter
    previousCriteriaValues = criteriaValues;
  }

  console.log(
    "Renumbered tables with global rank counter starting from:",
    globalRankCounter
  );

  return globalRankCounter; // Return the updated rank counter to continue numbering
}

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

function preparePlayerstats() {
  // Step 1: Add all statrow elements to an array (#playerstats_list .statrow)
  var statRows = $("#playerstats-content .statrow")
    .map(function () {
      console.log("Found statrow:", $(this)); // Log each statrow found
      return $(this);
    })
    .get(); // Convert jQuery object to plain array

  console.log("Total statRows found:", statRows.length);

  // Step 2: Sort the array by HLTV score (either s1_hltv or s2_hltv, whichever exists)
  statRows.sort(function (a, b) {
    // Get the score from either s1_hltv or s2_hltv
    var aScore =
      parseFloat(a.find("[data-team='s1_hltv']").text()) ||
      parseFloat(a.find("[data-team='s2_hltv']").text()) ||
      0;
    var bScore =
      parseFloat(b.find("[data-team='s1_hltv']").text()) ||
      parseFloat(b.find("[data-team='s2_hltv']").text()) ||
      0;

    console.log("Comparing scores:", aScore, bScore); // Log scores being compared

    return bScore - aScore; // Sort in descending order
  });

  // Create sortedData
  var sortedData = statRows.map(function (row) {
    return {
      element: row,
      criteriaValues: [
        parseFloat(row.find("[data-team='s1_hltv']").text()) ||
          parseFloat(row.find("[data-team='s2_hltv']").text()) ||
          0,
      ],
    };
  });

  // Step 5: Initialize a rank counter that will carry across all groups
  var globalRankCounter = 1;

  // Step 6: Adjust the placement numbers using renumberTables
  globalRankCounter = renumberTables(sortedData, globalRankCounter);
  highlightTables(sortedData, 3);

  // Step 3: Split them into groups of max 5 respecting the determined order
  var maxGroupSize = 5;
  var groups = [];
  for (var i = 0; i < sortedData.length; i += maxGroupSize) {
    var group = sortedData.slice(i, i + maxGroupSize);
    console.log("Group created:", group); // Log each group
    groups.push(group);
  }

  // Step 4: Insert groups into existing .table_inner elements
  var tableInserts = $("#playerstats-insert .tabelle_inner");

  console.log("Total .table_inner elements:", tableInserts.length);

  groups.forEach(function (group, index) {
    if (index < tableInserts.length) {
      var tableInner = tableInserts.eq(index); // Get the respective .table_inner for the group
      console.log("Inserting group into tableInner:", tableInner); // Log the table_inner being used

      group.forEach(function (data, rowIndex) {
        var row = data.element;
        // Insert the statrow into the current .table_inner
        tableInner.append(row);
        console.log("Appended row to tableInner:", row); // Log the row being appended

        // Set the correct flex order via CSS
        row.css("order", rowIndex + 1);
        console.log("Set flex order for row:", rowIndex + 1); // Log the order being set
      });
    } else {
      console.warn("Not enough .table_inner elements to insert all groups.");
    }
  });

  // Step 7: Remove the original statrow elements from #playerstats_content
  $("#playerstats-content").remove();
  console.log("Removed original statrow elements.");
}

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
  renumberTables(sortedDataAlpha, 1);
  renumberTables(sortedDataBeta, 1);

  // Highlight top 1st and 2nd place in both tables
  highlightTables(sortedDataAlpha, 2);
  highlightTables(sortedDataBeta, 2);
}
