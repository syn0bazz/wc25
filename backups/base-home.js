// [PAGE ESSENTIALS]
// =============================================================================

// VARIABLES -------------------------------------------------------------------

// RUN ON PAGE LOAD ------------------------------------------------------------
$(document).ready(function () {
  // getBaseHome();
});

// [PAGE WIDE FUNCTIONS]
// =============================================================================

// == GET LINKS FOR VOD SECTION ==============================================
function getBaseHome() {
  var urlIds = [];
  var elementMap = {};

  $("[data-base-vodid]").each(function () {
    var element = $(this);
    var urlId = element.attr("data-base-vodid");
    urlIds.push(urlId);
    elementMap[urlId] = element;
  });

  if (urlIds.length === 0) {
    console.warn("No VOD elements found.");
    return;
  }

  console.log("Fetching VOD links for IDs: " + urlIds.join(", "));

  fetchDataForIdsWithCache({
    ids: urlIds,
    storageKeyPrefix: "vodData_",
    fetchFunction: function (idsToFetch) {
      return supabaseClient
        .from("spiele")
        .select("id_url, vod_link")
        .in("id_url", idsToFetch)
        .then(function (response) {
          if (response.error) {
            console.error("Error fetching VOD data:", response.error);
            throw response.error;
          }
          return response.data;
        });
    },
    processDataFunction: function (allVodData) {
      allVodData.forEach(function (vodData) {
        var urlId = vodData.id_url;
        var vodLinkId = vodData.vod_link;
        var vodLink = "https://www.youtube-nocookie.com/embed/" + vodLinkId;

        var element = elementMap[urlId];
        if (element) {
          var iframe = element.find(".video-embed iframe");
          if (iframe.length > 0) {
            iframe.attr("src", vodLink);
            console.log("VOD link added to iframe for " + urlId);
          } else {
            console.warn("No iframe found for URL ID:", urlId);
          }
        }
      });
    },
  });
}
