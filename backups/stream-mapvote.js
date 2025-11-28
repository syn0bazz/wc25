// [PAGE ESSENTIALS]
// =============================================================================

// VARIABLES -------------------------------------------------------------------
let selectedGame;
let isFinale = false;
let logoTrans1;
let logoTrans2;
let logoFill1;
let logoFill2;
let selectedTeam1;
let selectedTeam2;
let startingTeam;
let voteStep = 1;
let voteHistory = []; // To keep track of each vote action
let shouldWarnBeforeLeave = false;

// RUN ON PAGE LOAD ------------------------------------------------------------
$(document).ready(function () {
  clickModalButton();
  handleGroupSelection();
  handleGameSelection();
  clickBeginnerButton();
  clickNextButton();
  clickMapSelector();
  clickRevert();
  initializeVoteForm();
  clickSubmit();
  warnBeforeLeave();
  $("#votemodal").removeClass("is--hidden");
});

// [GEMERAL]
// =============================================================================

// FILL HIDDEN FORM DATA -------------------------------------------------------
function fillFormData(field, value) {
  $("#" + field).val(value);
}
function clearFormData(field) {
  $("#" + field).val("");
}

// WARN USER BEFORE LEAVING THE PAGE WITH UNSUBMITTED DATA ----------------------
function warnBeforeLeave() {
  $(window).on("beforeunload", function (e) {
    if (shouldWarnBeforeLeave) {
      // Customize the message for modern browsers
      var message =
        "Bist du sicher? Die Daten wurden noch nicht zur Webseite übermittelt.";

      // Some browsers may not show the custom message but still ask for confirmation
      e.preventDefault(); // For modern browsers
      e.returnValue = message; // For older browsers
      return message;
    }
  });
}

// [00 - VOTEMDOAL]
// =============================================================================

// CLICK HANDLER FOR MODAL BUTTON ---------------------------------------------
function clickModalButton() {
  $("#votemodal-button").on("click", function () {
    let $inputToCopy = $("#password-to-copy");
    let $inputToPaste = $("#vote_password");
    let passwordToCopy = $inputToCopy.val();

    $inputToPaste.val(passwordToCopy);

    $("#votemodal").addClass("is--hidden");
  });
}

// [01 - GAME SELECTION]
// =============================================================================

// CLICK HANDLER FOR GROUP SELECTION -------------------------------------------
function handleGroupSelection() {
  // Cache the selectors for buttons and tabs
  var $buttons = $(
    "#gameselect-button-alpha, #gameselect-button-beta, #gameselect-button-ko"
  );
  var $tabs = $(
    "#gameselect-tab-alpha, #gameselect-tab-beta, #gameselect-tab-ko"
  );

  // Add click event listeners to the buttons
  $buttons.on("click", function () {
    // Remove the 'is--active' class from all buttons and tabs
    $buttons.removeClass("is--active");
    $tabs.removeClass("is--active");

    // Add 'is--active' class to the clicked button and the corresponding tab
    var targetTab = "#gameselect-tab-" + $(this).attr("id").split("-").pop();
    $(this).addClass("is--active");
    $(targetTab).addClass("is--active");
  });
}

// CLICK HANDLER FOR GAME SELECTION ---------------------------------------------
function handleGameSelection() {
  console.log("=== handleGameSelection() initialisiert ===");

  // Add click event listener to all elements with class .votegame
  $(".votegame").on("click", function () {
    console.log("Klick auf .votegame Element erkannt.");

    // Update selectedGame with the value of the data-game-id attribute
    selectedGame = $(this).attr("data-game-id");
    console.log("selectedGame gesetzt auf:", selectedGame);

    if (selectedGame === "gf") {
      isFinale = true;
      console.log("isFinale gesetzt auf: true");
    } else {
      isFinale = false;
      console.log("isFinale gesetzt auf: false");
    }

    // Find the images inside the child .votegame_to-clone
    var $logosTrans = $(this).find(".votegame_to-clone .votegame_logo-trans");
    var $logosFill = $(this).find(".votegame_to-clone .votegame_logo-fill");

    console.log("$logosTrans gefunden:", $logosTrans.length);
    console.log("$logosFill gefunden:", $logosFill.length);

    // Loggen der gefundenen Logo-Elemente
    $logosTrans.each(function (index, element) {
      console.log("LogoTrans Element " + index + ":", $(element));
    });
    $logosFill.each(function (index, element) {
      console.log("LogoFill Element " + index + ":", $(element));
    });

    // Update the global variables logoTrans1 and logoTrans2 with the two team logos
    logoTrans1 = $logosTrans.eq(0); // First logo
    logoTrans2 = $logosTrans.eq(1); // Second logo
    logoFill1 = $logosFill.eq(0); // First logo
    logoFill2 = $logosFill.eq(1); // Second logo

    console.log("logoTrans1 gesetzt auf:", logoTrans1);
    console.log("logoTrans2 gesetzt auf:", logoTrans2);
    console.log("logoFill1 gesetzt auf:", logoFill1);
    console.log("logoFill2 gesetzt auf:", logoFill2);

    // Überprüfen, ob die Logos korrekt ausgewählt wurden
    if (!logoTrans1.length) {
      console.error("logoTrans1 wurde nicht gefunden.");
    }
    if (!logoTrans2.length) {
      console.error("logoTrans2 wurde nicht gefunden.");
    }
    if (!logoFill1.length) {
      console.error("logoFill1 wurde nicht gefunden.");
    }
    if (!logoFill2.length) {
      console.error("logoFill2 wurde nicht gefunden.");
    }

    // Update global Team variables
    selectedTeam1 = logoTrans1.attr("data-team-id");
    selectedTeam2 = logoTrans2.attr("data-team-id");

    console.log("selectedTeam1 gesetzt auf:", selectedTeam1);
    console.log("selectedTeam2 gesetzt auf:", selectedTeam2);

    // Überprüfen, ob die Team-IDs korrekt gesetzt wurden
    if (!selectedTeam1) {
      console.warn("selectedTeam1 ist leer oder nicht definiert.");
    }
    if (!selectedTeam2) {
      console.warn("selectedTeam2 ist leer oder nicht definiert.");
    }

    // Füllen der Formular-Daten
    fillFormData("id_url", selectedGame);
    console.log("fillFormData aufgerufen mit:", "id_url", selectedGame);

    // Resets Beginners tabs
    switchBeginnerTab(false);
    console.log("switchBeginnerTab(false) aufgerufen.");

    // Switches to next step
    $("#tab-button-2").trigger("click");
    console.log("#tab-button-2 Klick-Event ausgelöst.");
  });

  console.log("=== handleGameSelection() abgeschlossen ===");
}

// [02 - WHO HAS THE FIRST VOTE]
// =============================================================================

// CLICK HANDLER FOR BEGINNER BUTTON -------------------------------------------
function clickBeginnerButton() {
  // Add click event listener to #beginner-button
  $("#beginner-button").on("click", function () {
    // Run insertTeamLogosTrans and animateRandomSelection
    insertTeamLogosTrans();
    switchBeginnerTab(true);
    animateRandomSelection();
    shouldWarnBeforeLeave = true;
  });
}

// SWITCH BEGINNERS TABS -------------------------------------------------------
function switchBeginnerTab(switchState) {
  // Remove 'is--active' from both tabs
  $("#beginner-tab-1, #beginner-tab-2").removeClass("is--active");

  // Conditionally add 'is--active' based on the switchState
  if (!switchState) {
    $("#beginner-tab-1").addClass("is--active"); // Activate tab1
  } else {
    $("#beginner-tab-2").addClass("is--active"); // Activate tab2
  }
}

// INSERT TEAM LOGOS INTO DOM --------------------------------------------------
function insertTeamLogosTrans() {
  // Check if logoTrans1 and logoTrans2 are defined
  if (logoTrans1 && logoTrans2) {
    // Ensure the wrapper elements exist
    if ($("#beginner-logo-1").length && $("#beginner-logo-2").length) {
      // Clear any previous content and append the cloned logos
      $("#beginner-logo-1").empty().append(logoTrans1.clone());
      $("#beginner-logo-2").empty().append(logoTrans2.clone());
    } else {
      console.error("Wrapper elements for logos do not exist.");
    }
  } else {
    console.error("Team logos are not set. Ensure a votegame is selected.");
  }
}

// ANIMATE RANDOM SELECTION ----------------------------------------------------
function animateRandomSelection() {
  var $logo1 = $("#beginner-logo-1 img");
  var $logo2 = $("#beginner-logo-2 img");

  // Set the initial scale of both logos to 0.8
  $logo1.css("transform", "scale(0.8)");
  $logo2.css("transform", "scale(0.8)");

  // Random duration settings
  var minDuration = 5000; // minimum duration in milliseconds
  var maxDuration = 7000; // maximum duration in milliseconds
  var totalDuration = Math.random() * (maxDuration - minDuration) + minDuration;

  var startTime = Date.now();
  var duration = totalDuration;

  function crossFade() {
    var elapsedTime = Date.now() - startTime;

    // Calculate the progress (from 0 to 1)
    var progress = elapsedTime / duration;
    if (progress > 1) progress = 1;

    // Calculate current interval (increasing over time)
    var initialInterval = 50; // starting interval (fast)
    var maxInterval = 300; // ending interval (slow)
    var currentInterval =
      initialInterval + (maxInterval - initialInterval) * progress;

    // Randomly hide one logo and show the other
    var showFirstLogo = Math.random() < 0.5;

    if (showFirstLogo) {
      $logo1.removeClass("is--hidden").css({
        transform: "scale(0.8)",
      });
      $logo2.addClass("is--hidden");
    } else {
      $logo1.addClass("is--hidden");
      $logo2.removeClass("is--hidden").css({
        transform: "scale(0.8)",
      });
    }

    // Check if total duration has been reached
    if (elapsedTime < duration) {
      setTimeout(crossFade, currentInterval);
    } else {
      // Animation over, select one logo
      var selectedLogo = showFirstLogo ? $logo1 : $logo2;

      // Ensure only the selected logo is visible
      selectedLogo.removeClass("is--hidden");
      var otherLogo = showFirstLogo ? $logo2 : $logo1;
      otherLogo.addClass("is--hidden");

      // Reset the transform and transition before starting the animation
      selectedLogo.css({
        transform: "scale(0.8)",
      });

      // Force reflow to ensure the browser registers the change
      selectedLogo[0].offsetHeight; // Trigger a reflow

      // Animate the selected logo to scale to 1 with an in-out ease
      selectedLogo.css({
        transform: "scale(1)",
      });

      // Reveal Next button and update starting team variable
      $("#next-mask").addClass("is--active");
      updateStartingTeam(selectedLogo);
    }
  }

  crossFade();
}

// UPDATE STARTING TEAM VARIABLE -----------------------------------------------
function updateStartingTeam(selectedLogo) {
  startingTeam = selectedLogo.attr("data-team-id");
  fillFormData("vote_start", startingTeam);
}

// UPDATE STARTING TEAM VARIABLE -----------------------------------------------
function insertTeamsIntoMapvote() {
  // Determine which team is the starting team
  var isTeam1Starting = startingTeam === selectedTeam1;

  // Define the order of logos based on the starting team
  var logoOrder;
  if (isTeam1Starting) {
    logoOrder = [
      logoFill1,
      logoFill2,
      logoFill2,
      logoFill1,
      logoFill1,
      logoFill2,
    ];

    // Update team names in the step info
    $("[data-team-id='stepinfo-first-teamname']").text(
      selectedTeam1.toUpperCase()
    );
    $("[data-team-id='stepinfo-second-teamname']").text(
      selectedTeam2.toUpperCase()
    );
  } else {
    logoOrder = [
      logoFill2,
      logoFill1,
      logoFill1,
      logoFill2,
      logoFill2,
      logoFill1,
    ];

    // Update team names in the step info (inverted)
    $("[data-team-id='stepinfo-first-teamname']").text(
      selectedTeam2.toUpperCase()
    );
    $("[data-team-id='stepinfo-second-teamname']").text(
      selectedTeam1.toUpperCase()
    );
  }

  // Loop through each team avatar and insert the corresponding logo
  for (var i = 1; i <= 6; i++) {
    $("#teamavatar-" + i)
      .empty()
      .append(logoOrder[i - 1].clone());
  }
}

function toggleFinale(isFinale) {
  // Update step info content based on whether it's a finale or not
  const finaleOrder = ["Wahl", "Wahl", "Wahl", "Wahl", "Wahl", "Wahl"];
  const defaultOrder = ["Bann", "Bann", "Wahl", "Wahl", "Bann", "Bann"];

  for (let i = 1; i <= 6; i++) {
    $("#stepinfo-type-" + i).text(
      isFinale ? finaleOrder[i - 1] : defaultOrder[i - 1]
    );
  }

  // Remove .is--up and .is--down classes from the first 6 .mapvote elements
  $(".mapvote").slice(0, 6).removeClass("is--up is--down");

  // Apply new class order based on whether it's a finale or not
  const classOrderFinale = [
    "is--up",
    "is--up",
    "is--up",
    "is--up",
    "is--up",
    "is--up",
  ];
  const classOrderDefault = [
    "is--down",
    "is--down",
    "is--up",
    "is--up",
    "is--down",
    "is--down",
  ];

  const newClassOrder = isFinale ? classOrderFinale : classOrderDefault;

  // Apply the new class order to the .mapvote elements
  $(".mapvote")
    .slice(0, 6)
    .each(function (index) {
      $(this).addClass(newClassOrder[index]);
    });
}

// CLICK HANDLER FOR NEXT BUTTON -----------------------------------------------
function clickNextButton() {
  $("#next-button").on("click", function () {
    insertTeamsIntoMapvote();
    toggleFinale(isFinale);
    $("#tab-button-3").trigger("click");
  });
}

// [03 - MAP VOTING]
// =============================================================================

// CLICK HANDLER FOR MAP SELECTORS ---------------------------------------------
function clickMapSelector() {
  $(".mapselect.is--active").on("click", function () {
    let selectedMap = $(this).attr("data-map-id");
    let formField = "vote_" + voteStep;
    let activeMapVote = $(".mapvote").eq(voteStep - 1);
    let nextMapVote = $(".mapvote").eq(voteStep);

    // Set this item inactive
    $(this).removeClass("is--active");

    // Send data to form
    fillFormData(formField, selectedMap);

    // Reveal Map Content
    activeMapVote
      .find("[data-map-id='" + selectedMap + "']")
      .addClass("is--active");
    activeMapVote.removeClass("is--current").addClass("is--set");
    nextMapVote.addClass("is--current");

    // Increment vote step
    voteStep++;

    // Push the current action to history for potential revert
    voteHistory.push({
      selectedMap: selectedMap,
      formField: formField,
      activeMapVote: activeMapVote,
      nextMapVote: nextMapVote,
    });

    // If voteStep reaches 7 finalize
    if (voteStep === 7) {
      finalizeMapSelection();
    }
  });
}

function finalizeMapSelection() {
  // trigger a click on the last remaining active map selector
  $(".mapselect.is--active").eq(0).trigger("click");
  // Reveal Submit button
  $("#submit-mask").addClass("is--active");
}

function clickSubmit() {
  $("#submit-button").on("click", function () {
    $("#voteform-submit").trigger("click");
  });
}

// CLICK HANDLER FOR REVERT BUTTON -----------------------------------------------
function clickRevert() {
  $("#revert-button").on("click", function () {
    if (voteHistory.length === 0) {
      alert("Keine Aktion zum Rückgängig machen gefunden.");
      return;
    }

    // Get the last action from history
    let lastAction = voteHistory.pop();
    let { selectedMap, formField, activeMapVote, nextMapVote } = lastAction;

    // Revert form data
    clearFormData(formField); // Assume this function clears the specified form field

    // Remove the active class from the previously active map in the vote section
    activeMapVote
      .find("[data-map-id='" + selectedMap + "']")
      .removeClass("is--active");

    // Reactivate the map selector that was previously deactivated
    $(".mapselect")
      .filter("[data-map-id='" + selectedMap + "']")
      .addClass("is--active");

    // Update classes to revert the UI state
    activeMapVote.removeClass("is--set").addClass("is--current");
    nextMapVote.removeClass("is--current");

    // Decrement the vote step
    voteStep--;

    // Optionally, handle any additional UI updates or logic here
  });
}

/**
 * initializeVoteForm Funktion
 * Enthält alle notwendigen Initialisierungen und Event-Handler
 */
function initializeVoteForm() {
  // Gespeicherter Passwort-Hash (ersetze ihn mit deinem eigenen Hash)
  const storedPasswordHash =
    "815c69604cf3ba06618d4b25782b5d51e67866b97ab50d3b029b419bde214942"; // Beispiel-Hash

  let attemptCount = 0;
  const maxAttempts = 5;

  /**
   * Authentifizierungsfunktion
   * Überprüft das eingegebene Passwort mit dem gespeicherten Passwort-Hash.
   * @param {string} password - Das eingegebene Passwort
   * @returns {boolean} - Gibt true zurück, wenn das Passwort korrekt ist
   */
  function authenticate(password) {
    // Hash das eingegebene Passwort
    const enteredPasswordHash = CryptoJS.SHA256(password).toString();

    // Vergleiche die Hashes
    return enteredPasswordHash === storedPasswordHash;
  }

  /**
   * Formular-Submit-Handler
   * Verarbeitet das Formular, überprüft das Passwort und aktualisiert die Daten in Supabase.
   */
  function handleFormSubmit(event) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    console.log("Form submission started");

    const id_url = $("#id_url").val().trim();
    const vote_start = $("#vote_start").val().trim();
    const votes = {
      vote_1: $("#vote_1").val().trim(),
      vote_2: $("#vote_2").val().trim(),
      vote_3: $("#vote_3").val().trim(),
      vote_4: $("#vote_4").val().trim(),
      vote_5: $("#vote_5").val().trim(),
      vote_6: $("#vote_6").val().trim(),
      vote_7: $("#vote_7").val().trim(),
    };
    const vote_password = $("#vote_password").val();

    // Überprüfe die Anzahl der Versuche
    if (attemptCount >= maxAttempts) {
      console.log("Max attempts reached");
      alert("Zu viele falsche Versuche. Bitte versuche es später erneut.");
      return false;
    }

    // Authentifiziere den Benutzer
    if (!authenticate(vote_password)) {
      attemptCount++;
      console.log("Authentication failed");
      alert("Falsches Passwort!");
      $("#votemodal").removeClass("is--hidden");
      return false;
    }

    console.log("Authentication successful");

    // Setze den Versuchszähler zurück nach erfolgreicher Authentifizierung
    attemptCount = 0;

    // Validierung: Stelle sicher, dass id_url nicht leer ist
    if (!id_url) {
      console.log("ID URL is empty");
      alert("ID URL darf nicht leer sein.");
      return false;
    }

    console.log("Updating Supabase...");

    // Aktualisiere die Daten in Supabase
    window.supabaseClient
      .from("spiele")
      .update({
        vote_start: vote_start,
        ...votes,
      })
      .eq("id_url", id_url)
      .then((response) => {
        if (response.error) {
          console.error("Supabase error:", response.error);
          alert("Supabase error:", response.error);
        } else {
          alert("Hat geklappt!");
          console.log("Supabase updated.");
          $("#vote_form")[0].reset();
          $("#submit-mask").removeClass("is--active");
          $("#revert-button").addClass("is--hidden");
          shouldWarnBeforeLeave = false;
        }
      })
      .catch((error) => {
        console.error("Supabase error:", response.error);
        alert("Supabase error:", response.error);
      });

    return false;
  }

  // Hänge den Submit-Handler an das Formular
  $("#vote_form").on("submit", handleFormSubmit);
}
